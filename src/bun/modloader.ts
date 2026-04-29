import { join } from "path";
import { existsSync, mkdirSync } from "fs";

const MC_BASE = join(
  process.env["APPDATA"] || process.env["HOME"] || ".",
  "mc-launcher",
  "minecraft"
);

export type ModLoaderType = "fabric" | "forge" | "neoforge" | "vanilla";

export type ModLoaderProgress =
  | { stage: "checking" }
  | { stage: "downloading_installer"; progress: number }
  | { stage: "installing" }
  | { stage: "downloading_libraries"; current: number; total: number }
  | { stage: "done" };

// ── 공통 헬퍼 ─────────────────────────────────────────────────────────────────

function mavenToPath(name: string): string {
  const [group, artifact, version] = name.split(":");
  const groupPath = group.replace(/\./g, "/");
  return `${groupPath}/${artifact}/${version}/${artifact}-${version}.jar`;
}

function mavenToLocalPath(name: string): string {
  return join(MC_BASE, "libraries", mavenToPath(name).replace(/\//g, "\\"));
}

async function downloadFile(url: string, dest: string, onProgress?: (p: number) => void): Promise<void> {
  const dir = dest.substring(0, Math.max(dest.lastIndexOf("\\"), dest.lastIndexOf("/")));
  mkdirSync(dir, { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${url}: ${res.status}`);
  const total = parseInt(res.headers.get("content-length") ?? "0", 10);
  let downloaded = 0;
  const reader = res.body!.getReader();
  const writer = Bun.file(dest).writer();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    await writer.write(value);
    downloaded += value.length;
    if (total && onProgress) onProgress(Math.round((downloaded / total) * 100));
  }
  await writer.flush();
  writer.end();
}

// ── 설치 확인 ─────────────────────────────────────────────────────────────────

export function isModLoaderInstalled(mcVersion: string, loader: ModLoaderType, loaderVersion: string): boolean {
  if (loader === "vanilla") return true;
  if (loader === "fabric") {
    return existsSync(join(MC_BASE, "versions", `fabric-loader-${loaderVersion}-${mcVersion}`, `fabric-loader-${loaderVersion}-${mcVersion}.json`));
  }
  if (loader === "forge") {
    return existsSync(join(MC_BASE, "versions", `${mcVersion}-forge-${loaderVersion}`, `${mcVersion}-forge-${loaderVersion}.json`));
  }
  if (loader === "neoforge") {
    return existsSync(join(MC_BASE, "versions", `neoforge-${loaderVersion}`, `neoforge-${loaderVersion}.json`));
  }
  return false;
}

// ── 최신 버전 조회 ────────────────────────────────────────────────────────────

export async function getLatestLoaderVersion(mcVersion: string, loader: ModLoaderType): Promise<string> {
  if (loader === "fabric") {
    const res = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`);
    if (!res.ok) throw new Error(`Fabric API error: ${res.status}`);
    const data = await res.json() as { loader: { version: string; stable: boolean } }[];
    const stable = data.find(d => d.loader.stable);
    if (!stable) throw new Error("No stable Fabric loader found");
    return stable.loader.version;
  }
  if (loader === "forge") {
    const res = await fetch("https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml");
    const xml = await res.text();
    const versions = [...xml.matchAll(/<version>([^<]*)<\/version>/g)]
      .map(m => m[1])
      .filter(v => v.startsWith(mcVersion + "-"));
    if (versions.length === 0) throw new Error(`No Forge version found for ${mcVersion}`);
    return versions[versions.length - 1].replace(`${mcVersion}-`, "");
  }
  if (loader === "neoforge") {
    // NeoForge 버전은 MC 1.20.1 → 20.1.x, 1.21.1 → 21.1.x 형식
    const parts = mcVersion.split(".");
    const prefix = parts.slice(1).join("."); // "21.1" for "1.21.1"
    const res = await fetch("https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml");
    const xml = await res.text();
    const versions = [...xml.matchAll(/<version>([^<]*)<\/version>/g)]
      .map(m => m[1])
      .filter(v => v.startsWith(`${prefix}.`) && !v.endsWith("-beta"));
    if (versions.length === 0) throw new Error(`No NeoForge version found for ${mcVersion}`);
    return versions[versions.length - 1];
  }
  throw new Error(`Unknown loader: ${loader}`);
}

// ── Fabric 설치 ───────────────────────────────────────────────────────────────

type FabricProfileLib = {
  name: string;
  url: string;
  sha1?: string;
  size?: number;
};

type FabricProfile = {
  id: string;
  inheritsFrom: string;
  mainClass: string;
  libraries: FabricProfileLib[];
  arguments?: { game?: string[]; jvm?: string[] };
};

async function installFabric(
  mcVersion: string,
  loaderVersion: string,
  onProgress: (p: ModLoaderProgress) => void
): Promise<void> {
  onProgress({ stage: "checking" });

  const profileRes = await fetch(
    `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${loaderVersion}/profile/json`
  );
  if (!profileRes.ok) throw new Error(`Fabric profile fetch failed: ${profileRes.status}`);
  const profile = await profileRes.json() as FabricProfile;

  // profile JSON 저장
  const versionDir = join(MC_BASE, "versions", profile.id);
  mkdirSync(versionDir, { recursive: true });
  await Bun.write(join(versionDir, `${profile.id}.json`), JSON.stringify(profile, null, 2));

  // 라이브러리 다운로드
  const libs = profile.libraries;
  let done = 0;
  for (const lib of libs) {
    const localPath = mavenToLocalPath(lib.name);
    if (!existsSync(localPath)) {
      const url = lib.url + mavenToPath(lib.name);
      await downloadFile(url, localPath);
    }
    done++;
    onProgress({ stage: "downloading_libraries", current: done, total: libs.length });
  }

  onProgress({ stage: "done" });
}

// ── Forge / NeoForge 설치 (installer jar headless) ────────────────────────────

async function installForgeFamily(
  mcVersion: string,
  loaderVersion: string,
  loader: "forge" | "neoforge",
  javaPath: string,
  onProgress: (p: ModLoaderProgress) => void
): Promise<void> {
  onProgress({ stage: "checking" });

  let installerUrl: string;
  if (loader === "forge") {
    const full = `${mcVersion}-${loaderVersion}`;
    installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`;
  } else {
    installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;
  }

  const tmpDir = join(MC_BASE, "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const installerPath = join(tmpDir, `${loader}-installer.jar`);

  // installer 다운로드
  await downloadFile(installerUrl, installerPath, (p) => {
    onProgress({ stage: "downloading_installer", progress: p });
  });

  onProgress({ stage: "installing" });

  // Forge installer가 launcher_profiles.json 존재를 요구함
  const profilesPath = join(MC_BASE, "launcher_profiles.json");
  if (!existsSync(profilesPath)) {
    await Bun.write(profilesPath, JSON.stringify({ profiles: {} }));
  }

  // headless 설치 실행
  const logPath = join(MC_BASE, "tmp", `${loader}-install.log`);
  await new Promise<void>((resolve, reject) => {
    const proc = Bun.spawn(
      [javaPath, "-jar", installerPath, "--installClient", MC_BASE],
      {
        stdio: ["ignore", Bun.file(logPath), Bun.file(logPath)],
        env: { ...process.env, JAVA_HOME: javaPath.replace(/[/\\]bin[/\\]java\.exe$/i, "") },
      }
    );
    proc.exited.then(async (code) => {
      if (code === 0 || code === 1) { resolve(); return; } // 1: 일부 경고 있어도 설치 완료로 처리
      const log = await Bun.file(logPath).text().catch(() => "(no log)");
      reject(new Error(`${loader} installer exited with code ${code}\n${log.slice(-2000)}`));
    }).catch(reject);
  });

  // installer jar 정리
  try {
    const proc = Bun.spawn(["cmd", "/c", `del "${installerPath.replace(/\//g, "\\")}"`], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    await proc.exited;
  } catch {}

  onProgress({ stage: "done" });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function installModLoader(
  mcVersion: string,
  loader: ModLoaderType,
  loaderVersion: string,
  javaPath: string,
  onProgress: (p: ModLoaderProgress) => void
): Promise<void> {
  if (loader === "vanilla") return;

  if (isModLoaderInstalled(mcVersion, loader, loaderVersion)) {
    onProgress({ stage: "done" });
    return;
  }

  if (loader === "fabric") {
    return installFabric(mcVersion, loaderVersion, onProgress);
  }
  if (loader === "forge" || loader === "neoforge") {
    return installForgeFamily(mcVersion, loaderVersion, loader, javaPath, onProgress);
  }
}

// ── 런치 인수 오버라이드 ──────────────────────────────────────────────────────

export type ModLoaderLaunchOverride = {
  mainClass: string;
  extraLibraries: string[];    // classpath 앞에 추가 (Fabric용)
  replaceClasspath?: string[]; // classpath 전체 대체 (Forge/NeoForge용)
  extraGameArgs: string[];
  extraJvmArgs: string[];
  versionId: string;
};

type ForgeVersionJson = {
  mainClass: string;
  inheritsFrom: string;
  libraries: { name: string; downloads?: { artifact?: { path: string; url: string } }; url?: string }[];
  arguments?: { game?: (string | object)[]; jvm?: (string | object)[] };
};

export async function getModLoaderLaunchOverride(
  mcVersion: string,
  loader: ModLoaderType,
  loaderVersion: string
): Promise<ModLoaderLaunchOverride | null> {
  if (loader === "vanilla") return null;

  if (loader === "fabric") {
    const versionId = `fabric-loader-${loaderVersion}-${mcVersion}`;
    const jsonPath = join(MC_BASE, "versions", versionId, `${versionId}.json`);
    if (!existsSync(jsonPath)) return null;
    const profile = JSON.parse(await Bun.file(jsonPath).text()) as FabricProfile;
    return {
      mainClass: profile.mainClass,
      extraLibraries: profile.libraries.map(l => mavenToLocalPath(l.name)),
      extraGameArgs: profile.arguments?.game ?? [],
      extraJvmArgs: profile.arguments?.jvm ?? [],
      versionId,
    };
  }

  if (loader === "forge" || loader === "neoforge") {
    const versionId = loader === "forge" ? `${mcVersion}-forge-${loaderVersion}` : `neoforge-${loaderVersion}`;
    const jsonPath = join(MC_BASE, "versions", versionId, `${versionId}.json`);
    if (!existsSync(jsonPath)) return null;
    const ver = JSON.parse(await Bun.file(jsonPath).text()) as ForgeVersionJson;

    const libraryDir = join(MC_BASE, "libraries");
    const forgeVars: Record<string, string> = {
      "${library_directory}": libraryDir,
      "${classpath_separator}": ";",
      "${version_name}": versionId,
    };
    const resolveForgeArg = (s: string) =>
      s.replace(/\$\{[^}]+\}/g, (m) => forgeVars[m] ?? m);

    // -p (module path)에 이미 포함된 jars 수집 → -cp에서 중복 제외
    const jvmArgStrings = (ver.arguments?.jvm ?? []).filter((a): a is string => typeof a === "string");
    // -p (module path)에 있는 jar 파일명 수집
    const modulePathFileNames = new Set<string>();
    for (let i = 0; i < jvmArgStrings.length; i++) {
      if (jvmArgStrings[i] === "-p" && i + 1 < jvmArgStrings.length) {
        resolveForgeArg(jvmArgStrings[i + 1]).split(";").forEach(p => {
          const name = p.split(/[/\\]/).pop();
          if (name) modulePathFileNames.add(name);
        });
        break;
      }
    }

    // Forge 라이브러리 → classpath (-p에 있는 jar 파일명 제외)
    const replaceClasspath = ver.libraries
      .filter(l => l.downloads?.artifact?.path)
      .map(l => join(MC_BASE, "libraries", l.downloads!.artifact!.path.replace(/\//g, "\\")))
      .filter(p => !modulePathFileNames.has(p.split("\\").pop()!));

    const gameArgs = (ver.arguments?.game ?? []).filter((a): a is string => typeof a === "string").map(resolveForgeArg);
    const jvmArgs = jvmArgStrings.map(resolveForgeArg);
    return { mainClass: ver.mainClass, extraLibraries: [], replaceClasspath, extraGameArgs: gameArgs, extraJvmArgs: jvmArgs, versionId };
  }

  return null;
}
