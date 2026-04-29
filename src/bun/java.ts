import { join } from "path";
import { existsSync, mkdirSync } from "fs";

const LAUNCHER_JAVA_BASE = join(
  process.env["APPDATA"] || process.env["HOME"] || ".",
  "mc-launcher",
  "java"
);

export type JavaStatus =
  | { status: "found"; path: string; version: number; source: "system" | "launcher" }
  | { status: "downloading"; version: number; progress: number }
  | { status: "ready"; path: string; version: number }
  | { status: "error"; message: string };

// ── 버전 감지 ─────────────────────────────────────────────────────────────────

function parseJavaMajorVersion(output: string): number | null {
  // "java version "1.8.0_392"" 또는 "openjdk version "21.0.1""
  const match = output.match(/version "(?:1\.)?(\d+)/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

async function checkJavaAtPath(javaBin: string): Promise<number | null> {
  try {
    const proc = Bun.spawnSync([javaBin, "-version"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = new TextDecoder().decode(proc.stderr) + new TextDecoder().decode(proc.stdout);
    return parseJavaMajorVersion(output);
  } catch {
    return null;
  }
}

// ── 시스템 Java 탐색 ──────────────────────────────────────────────────────────

async function findSystemJava(requiredVersion: number): Promise<string | null> {
  // 1. PATH의 java
  const fromPath = await checkJavaAtPath("java");
  if (fromPath === requiredVersion) return "java";

  // 2. JAVA_HOME
  const javaHome = process.env["JAVA_HOME"];
  if (javaHome) {
    const bin = join(javaHome, "bin", "java.exe");
    if (existsSync(bin)) {
      const ver = await checkJavaAtPath(bin);
      if (ver === requiredVersion) return bin;
    }
  }

  // 3. 레지스트리 기반 일반 설치 경로
  const candidates = [
    `C:\\Program Files\\Java\\jre${requiredVersion}`,
    `C:\\Program Files\\Eclipse Adoptium\\jre-${requiredVersion}`,
    `C:\\Program Files\\Microsoft\\jdk-${requiredVersion}`,
    `C:\\Program Files\\Eclipse Adoptium\\jdk-${requiredVersion}`,
  ];
  for (const base of candidates) {
    const bin = join(base, "bin", "java.exe");
    if (existsSync(bin)) {
      const ver = await checkJavaAtPath(bin);
      if (ver === requiredVersion) return bin;
    }
  }

  // 4. Program Files 하위 전체 스캔 (Adoptium, Microsoft, Zulu 등)
  for (const root of ["C:\\Program Files\\Java", "C:\\Program Files\\Eclipse Adoptium", "C:\\Program Files\\Microsoft"]) {
    if (!existsSync(root)) continue;
    const proc = Bun.spawnSync(["cmd", "/c", `dir /b "${root}"`], { stdio: ["ignore", "pipe", "ignore"] });
    const dirs = new TextDecoder().decode(proc.stdout).trim().split("\r\n");
    for (const dir of dirs) {
      const bin = join(root, dir, "bin", "java.exe");
      if (existsSync(bin)) {
        const ver = await checkJavaAtPath(bin);
        if (ver === requiredVersion) return bin;
      }
    }
  }

  return null;
}

// ── 런처 내부 Java 탐색 ───────────────────────────────────────────────────────

async function findLauncherJava(requiredVersion: number): Promise<string | null> {
  const bin = join(LAUNCHER_JAVA_BASE, String(requiredVersion), "bin", "java.exe");
  if (!existsSync(bin)) return null;
  const ver = await checkJavaAtPath(bin);
  return ver === requiredVersion ? bin : null;
}

// ── Adoptium 다운로드 ─────────────────────────────────────────────────────────

async function getAdoptiumDownloadUrl(version: number): Promise<{ url: string; name: string }> {
  const res = await fetch(
    `https://api.adoptium.net/v3/assets/latest/${version}/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse`
  );
  if (!res.ok) throw new Error(`Adoptium API error: ${res.status}`);
  const data = (await res.json()) as { binary: { package: { link: string; name: string } } }[];
  if (!data[0]) throw new Error("No JRE found from Adoptium");
  return { url: data[0].binary.package.link, name: data[0].binary.package.name };
}

async function downloadAndExtract(
  version: number,
  onProgress: (progress: number) => void,
  onExtracting: () => void
): Promise<string> {
  const { url, name } = await getAdoptiumDownloadUrl(version);
  const destDir = join(LAUNCHER_JAVA_BASE, String(version));
  const zipPath = join(LAUNCHER_JAVA_BASE, name);

  // 디렉토리 생성
  mkdirSync(LAUNCHER_JAVA_BASE, { recursive: true });

  // 다운로드
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download error: ${res.status}`);

  const total = parseInt(res.headers.get("content-length") ?? "0", 10);
  let downloaded = 0;
  const reader = res.body!.getReader();
  const writer = Bun.file(zipPath).writer();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    await writer.write(value);
    downloaded += value.length;
    if (total) onProgress(Math.round((downloaded / total) * 90));
  }
  await writer.flush();
  writer.end();

  onExtracting();

  // 압축 해제 (Windows 기본 tar 사용 — zip 지원)
  Bun.spawnSync(
    ["powershell", "-Command", `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`],
    { stdio: ["ignore", "ignore", "ignore"] }
  );

  // zip 삭제
  await Bun.file(zipPath).exists() && Bun.spawnSync(["cmd", "/c", `del "${zipPath}"`]);

  // Adoptium zip 내부에 jre-버전 폴더가 하나 있음 → 그 안의 bin/java.exe
  const proc = Bun.spawnSync(["cmd", "/c", `dir /b "${destDir}"`], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const subDir = new TextDecoder().decode(proc.stdout).trim().split("\r\n")[0];
  const javaExe = join(destDir, subDir, "bin", "java.exe");

  onProgress(100);
  return javaExe;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function findJava(requiredVersion: number): Promise<string | null> {
  // 1. 시스템 Java
  const systemJava = await findSystemJava(requiredVersion);
  if (systemJava) return systemJava;

  // 2. 런처 내부 Java
  const launcherJava = await findLauncherJava(requiredVersion);
  if (launcherJava) return launcherJava;

  return null;
}

export async function ensureJava(
  requiredVersion: number,
  onProgress: (progress: number) => void,
  onExtracting: () => void
): Promise<string> {
  const existing = await findJava(requiredVersion);
  if (existing) return existing;

  return downloadAndExtract(requiredVersion, onProgress, onExtracting);
}
