import { join } from "path";
import { PublicClientApplication, CryptoProvider } from "@azure/msal-node";

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
  msExpiresAt: number;
  mcAccessToken: string;
  mcExpiresAt: number;
  mcUsername: string;
  mcUuid: string;
};

// ── MSAL 클라이언트 ───────────────────────────────────────────────────────────

const msalClient = new PublicClientApplication({
  auth: {
    clientId: CLIENT_ID,
    authority: "https://login.microsoftonline.com/consumers",
  },
});

const cryptoProvider = new CryptoProvider();

// ── Token persistence ─────────────────────────────────────────────────────────

export async function loadTokens(): Promise<AuthTokens | null> {
  try {
    const text = await Bun.file(TOKEN_PATH).text();
    if (!text.trim()) return null;
    return JSON.parse(text) as AuthTokens;
  } catch {
    return null;
  }
}

async function saveTokens(tokens: AuthTokens): Promise<void> {
  await Bun.write(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

// ── Microsoft OAuth (MSAL) ────────────────────────────────────────────────────

async function getMsTokenFromCode(
  code: string,
  verifier: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  const result = await msalClient.acquireTokenByCode({
    code,
    redirectUri: REDIRECT_URI,
    scopes: ["XboxLive.signin", "offline_access"],
    codeVerifier: verifier,
  });

  if (!result) throw new Error("MS token error: empty response");

  return {
    accessToken: result.accessToken,
    refreshToken: (result as any).refreshToken ?? "",
    expiresAt: result.expiresOn?.getTime() ?? Date.now() + 3600 * 1000,
  };
}

async function refreshMsToken(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  // MSAL 캐시에 계정이 없으면 refresh token으로 직접 갱신
  const accounts = await msalClient.getTokenCache().getAllAccounts();

  if (accounts.length > 0) {
    const result = await msalClient.acquireTokenSilent({
      account: accounts[0],
      scopes: ["XboxLive.signin", "offline_access"],
    });
    return {
      accessToken: result.accessToken,
      refreshToken: (result as any).refreshToken ?? refreshToken,
      expiresAt: result.expiresOn?.getTime() ?? Date.now() + 3600 * 1000,
    };
  }

  // 캐시 없으면 refresh token으로 직접 요청
  const res = await fetch(
    "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: "XboxLive.signin offline_access",
      }),
    }
  );
  if (!res.ok) throw new Error(`MS refresh error: ${await res.text()}`);
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

// ── Xbox Live ─────────────────────────────────────────────────────────────────

async function getXblToken(
  msAccessToken: string
): Promise<{ token: string; userHash: string }> {
  const res = await fetch("https://user.auth.xboxlive.com/user/authenticate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      Properties: {
        AuthMethod: "RPS",
        SiteName: "user.auth.xboxlive.com",
        RpsTicket: `d=${msAccessToken}`,
      },
      RelyingParty: "http://auth.xboxlive.com",
      TokenType: "JWT",
    }),
  });
  if (!res.ok) throw new Error(`XBL error: ${await res.text()}`);
  const data = (await res.json()) as {
    Token: string;
    DisplayClaims: { xui: { uhs: string }[] };
  };
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
  const data = (await res.json()) as { Token: string };
  return data.Token;
}

// ── Minecraft ─────────────────────────────────────────────────────────────────

async function getMcToken(
  xstsToken: string,
  userHash: string
): Promise<{ accessToken: string; expiresAt: number }> {
  const res = await fetch(
    "https://api.minecraftservices.com/authentication/login_with_xbox",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identityToken: `XBL3.0 x=${userHash};${xstsToken}`,
      }),
    }
  );
  if (!res.ok) throw new Error(`MC auth error: ${await res.text()}`);
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

async function getMcProfile(
  mcAccessToken: string
): Promise<{ username: string; uuid: string }> {
  const res = await fetch("https://api.minecraftservices.com/minecraft/profile", {
    headers: { Authorization: `Bearer ${mcAccessToken}` },
  });
  if (!res.ok) throw new Error(`MC profile error: ${await res.text()}`);
  const data = (await res.json()) as { name: string; id: string };
  return { username: data.name, uuid: data.id };
}

// ── Full chain ────────────────────────────────────────────────────────────────

async function buildTokensFromMs(
  msAccessToken: string,
  msRefreshToken: string,
  msExpiresAt: number
): Promise<AuthTokens> {
  const { token: xblToken, userHash } = await getXblToken(msAccessToken);
  const xstsToken = await getXstsToken(xblToken);
  const { accessToken: mcAccessToken, expiresAt: mcExpiresAt } =
    await getMcToken(xstsToken, userHash);
  const { username, uuid } = await getMcProfile(mcAccessToken);
  return {
    msAccessToken,
    msRefreshToken,
    msExpiresAt,
    mcAccessToken,
    mcExpiresAt,
    mcUsername: username,
    mcUuid: uuid,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function refreshTokensIfNeeded(): Promise<AuthTokens | null> {
  const saved = await loadTokens();
  if (!saved) return null;

  try {
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

    const needsMcRefresh = saved.mcExpiresAt - Date.now() < 5 * 60 * 1000;
    if (!needsMsRefresh && !needsMcRefresh) return saved;

    const tokens = await buildTokensFromMs(msAccessToken, msRefreshToken, msExpiresAt);
    await saveTokens(tokens);
    return tokens;
  } catch {
    return saved;
  }
}

export async function startLoginFlow(): Promise<AuthTokens> {
  const { verifier, challenge } = await cryptoProvider.generatePkceCodes();

  const authUrl = await msalClient.getAuthCodeUrl({
    redirectUri: REDIRECT_URI,
    scopes: ["XboxLive.signin", "offline_access"],
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
  });

  // 시스템 기본 브라우저로 열기
  Bun.spawnSync(
    ["powershell", "-Command", `Start-Process "${authUrl}"`],
    { stdio: ["ignore", "ignore", "ignore"] }
  );

  const code = await waitForCallback();

  const { accessToken: msAccessToken, refreshToken: msRefreshToken, expiresAt: msExpiresAt } =
    await getMsTokenFromCode(code, verifier);

  const tokens = await buildTokensFromMs(msAccessToken, msRefreshToken, msExpiresAt);
  await saveTokens(tokens);
  return tokens;
}

async function waitForCallback(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = Bun.serve({
      port: REDIRECT_PORT,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/callback") {
          return new Response("Not found", { status: 404 });
        }

        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          server.stop();
          reject(new Error(`Login cancelled: ${error}`));
          return new Response(`<script>window.close()</script>`, {
            headers: { "Content-Type": "text/html" },
          });
        }
        if (!code) {
          server.stop();
          reject(new Error("Invalid callback: no code"));
          return new Response(`<script>window.close()</script>`, {
            headers: { "Content-Type": "text/html" },
          });
        }

        server.stop();
        resolve(code);
        return new Response(
          `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
           <body style="font-family:sans-serif;text-align:center;padding:60px">
           <h2>로그인 완료!</h2><p>이 창을 닫고 런처로 돌아가세요.</p>
           <script>setTimeout(()=>window.close(),2000)</script>
           </body></html>`,
          { headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      },
    });

    setTimeout(() => {
      server.stop();
      reject(new Error("Login timeout"));
    }, 5 * 60 * 1000);
  });
}
