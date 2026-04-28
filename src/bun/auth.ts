import { join } from "path";
import { randomBytes, createHash } from "crypto";

const CLIENT_ID = "8075f7ce-dec1-4dec-9925-3d15372b291d";
const REDIRECT_PORT = 9898;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const TOKEN_PATH = join(
  process.env["APPDATA"] || process.env["HOME"] || ".",
  "mc-launcher",
  "tokens.json"
);

export type AuthTokens = {
  msAccessToken: string;
  msRefreshToken: string;
  msExpiresAt: number; // epoch ms
  mcAccessToken: string;
  mcExpiresAt: number; // epoch ms
  mcUsername: string;
  mcUuid: string;
};

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generatePKCE() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(
    Buffer.from(createHash("sha256").update(verifier).digest("hex"), "hex")
  );
  return { verifier, challenge };
}

// ── Token persistence ─────────────────────────────────────────────────────────

export async function loadTokens(): Promise<AuthTokens | null> {
  try {
    const text = await Bun.file(TOKEN_PATH).text();
    return JSON.parse(text) as AuthTokens;
  } catch {
    return null;
  }
}

async function saveTokens(tokens: AuthTokens): Promise<void> {
  await Bun.write(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

// ── Microsoft OAuth ───────────────────────────────────────────────────────────

async function getMsTokenFromCode(code: string, verifier: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  const res = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
      scope: "XboxLive.signin offline_access",
    }),
  });
  if (!res.ok) throw new Error(`MS token error: ${await res.text()}`);
  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

async function refreshMsToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  const res = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "XboxLive.signin offline_access",
    }),
  });
  if (!res.ok) throw new Error(`MS refresh error: ${await res.text()}`);
  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

// ── Xbox Live ─────────────────────────────────────────────────────────────────

async function getXblToken(msAccessToken: string): Promise<{ token: string; userHash: string }> {
  const res = await fetch("https://user.auth.xboxlive.com/user/authenticate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: `d=${msAccessToken}` },
      RelyingParty: "http://auth.xboxlive.com",
      TokenType: "JWT",
    }),
  });
  if (!res.ok) throw new Error(`XBL error: ${await res.text()}`);
  const data = await res.json() as { Token: string; DisplayClaims: { xui: { uhs: string }[] } };
  return { token: data.Token, userHash: data.DisplayClaims.xui[0].uhs };
}

async function getXstsToken(xblToken: string): Promise<string> {
  const res = await fetch("https://xsts.auth.xboxlive.com/xsts/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      Properties: { SandboxId: "RETAIL", UserTokens: [xblToken] },
      RelyingParty: "rp://api.minecraftservices.com/",
      TokenType: "JWT",
    }),
  });
  if (!res.ok) throw new Error(`XSTS error: ${await res.text()}`);
  const data = await res.json() as { Token: string };
  return data.Token;
}

// ── Minecraft ─────────────────────────────────────────────────────────────────

async function getMcToken(xstsToken: string, userHash: string): Promise<{ accessToken: string; expiresAt: number }> {
  const res = await fetch("https://api.minecraftservices.com/authentication/login_with_xbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identityToken: `XBL3.0 x=${userHash};${xstsToken}` }),
  });
  if (!res.ok) throw new Error(`MC auth error: ${await res.text()}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

async function getMcProfile(mcAccessToken: string): Promise<{ username: string; uuid: string }> {
  const res = await fetch("https://api.minecraftservices.com/minecraft/profile", {
    headers: { Authorization: `Bearer ${mcAccessToken}` },
  });
  if (!res.ok) throw new Error(`MC profile error: ${await res.text()}`);
  const data = await res.json() as { name: string; id: string };
  return { username: data.name, uuid: data.id };
}

// ── Full chain ─────────────────────────────────────────────────────────────────

async function buildTokensFromMs(msAccessToken: string, msRefreshToken: string, msExpiresAt: number): Promise<AuthTokens> {
  const { token: xblToken, userHash } = await getXblToken(msAccessToken);
  const xstsToken = await getXstsToken(xblToken);
  const { accessToken: mcAccessToken, expiresAt: mcExpiresAt } = await getMcToken(xstsToken, userHash);
  const { username, uuid } = await getMcProfile(mcAccessToken);
  return { msAccessToken, msRefreshToken, msExpiresAt, mcAccessToken, mcExpiresAt, mcUsername: username, mcUuid: uuid };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * 런처 시작 시 호출. 저장된 토큰을 갱신하거나 null 반환 (재로그인 필요).
 */
export async function refreshTokensIfNeeded(): Promise<AuthTokens | null> {
  const saved = await loadTokens();
  if (!saved) return null;

  try {
    // MS 토큰이 5분 내 만료되면 갱신
    const needsMsRefresh = saved.msExpiresAt - Date.now() < 5 * 60 * 1000;
    let msAccessToken = saved.msAccessToken;
    let msRefreshToken = saved.msRefreshToken;
    let msExpiresAt = saved.msExpiresAt;

    if (needsMsRefresh) {
      const refreshed = await refreshMsToken(saved.msRefreshToken);
      msAccessToken = refreshed.accessToken;
      msRefreshToken = refreshed.refreshToken;
      msExpiresAt = refreshed.expiresAt;
    }

    // MC 토큰이 5분 내 만료되면 Xbox 체인 재실행
    const needsMcRefresh = saved.mcExpiresAt - Date.now() < 5 * 60 * 1000;
    if (!needsMsRefresh && !needsMcRefresh) return saved;

    const tokens = await buildTokensFromMs(msAccessToken, msRefreshToken, msExpiresAt);
    await saveTokens(tokens);
    return tokens;
  } catch {
    return null;
  }
}

/**
 * 브라우저 로그인 플로우 시작. 완료되면 AuthTokens 반환.
 */
export async function startLoginFlow(): Promise<AuthTokens> {
  const { verifier, challenge } = generatePKCE();
  const state = base64url(randomBytes(8));

  const authUrl =
    `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize` +
    `?client_id=${CLIENT_ID}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent("XboxLive.signin offline_access")}` +
    `&code_challenge=${challenge}` +
    `&code_challenge_method=S256` +
    `&state=${state}`;

  // 시스템 기본 브라우저로 열기 (PowerShell로 열어야 & 문자가 잘리지 않음)
  Bun.spawnSync(["powershell", "-Command", `Start-Process "${authUrl}"`], { stdio: ["ignore", "ignore", "ignore"] });

  // localhost 콜백 서버로 code 수신
  const code = await waitForCallback(state);

  const { accessToken: msAccessToken, refreshToken: msRefreshToken, expiresAt: msExpiresAt } =
    await getMsTokenFromCode(code, verifier);

  const tokens = await buildTokensFromMs(msAccessToken, msRefreshToken, msExpiresAt);
  await saveTokens(tokens);
  return tokens;
}

async function waitForCallback(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = Bun.serve({
      port: REDIRECT_PORT,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/callback") {
          return new Response("Not found", { status: 404 });
        }
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          server.stop();
          reject(new Error(`Login cancelled: ${error}`));
          return new Response(`<script>window.close()</script>`, { headers: { "Content-Type": "text/html" } });
        }
        if (!code || state !== expectedState) {
          server.stop();
          reject(new Error("Invalid callback"));
          return new Response(`<script>window.close()</script>`, { headers: { "Content-Type": "text/html" } });
        }

        server.stop();
        resolve(code);
        return new Response(
          `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;text-align:center;padding:60px">
           <h2>로그인 완료!</h2><p>이 창을 닫고 런처로 돌아가세요.</p>
           <script>setTimeout(()=>window.close(),2000)</script>
           </body></html>`,
          { headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      },
    });

    // 5분 타임아웃
    setTimeout(() => {
      server.stop();
      reject(new Error("Login timeout"));
    }, 5 * 60 * 1000);
  });
}
