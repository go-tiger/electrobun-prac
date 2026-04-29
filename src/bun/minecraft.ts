import { join } from "path";
import { existsSync, mkdirSync } from "fs";

const MC_BASE = join(
  process.env["APPDATA"] || process.env["HOME"] || ".",
  "mc-launcher",
  "minecraft"
);

// ── 타입 ─────────────────────────────────────────────────────────────────────

type VersionManifest = {
  versions: { id: string; type: string; url: string }[];
};

type OsRule = { action: "allow" | "disallow"; os?: { name?: string; arch?: string }; features?: Record<string, boolean> };

type Library = {
  name: string;
  downloads?: {
    artifact?: { path: string; url: string; sha1: string; size: number };
    classifiers?: Record<string, { path: string; url: string; sha1: string; size: number }>;
  };
  rules?: OsRule[];
  natives?: Record<string, string>;
};

type VersionMeta = {
  id: string;
  mainClass: string;
  downloads: {
    client: { url: string; sha1: string; size: number };
  };
  libraries: Library[];
  arguments?: {
    game: (string | { rules: OsRule[]; value: string | string[] })[];
    jvm: (string | { rules: OsRule[]; value: string | string[] })[];
  };
  minecraftArguments?: string;
  assetIndex: { id: string; url: string; sha1: string; size: number };
};

type AssetIndex = {
  objects: Record<string, { hash: string; size: number }>;
};

export type McInstallProgress =
  | { stage: "meta" }
  | { stage: "client"; progress: number }
  | { stage: "libraries"; current: number; total: number }
  | { stage: "assets"; current: number; total: number }
  | { stage: "done" };

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

async function downloadFile(url: string, dest: string, onProgress?: (p: number) => void): Promise<void> {
  mkdirSync(dest.substring(0, dest.lastIndexOf("\\") || dest.lastIndexOf("/")), { recursive: true });
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

function isLibraryAllowed(lib: Library): boolean {
  if (!lib.rules) return true;
  let allowed = false;
  for (const rule of lib.rules) {
    const osMatch = !rule.os || rule.os.name === "windows";
    if (osMatch) {
      allowed = rule.action === "allow";
    }
  }
  return allowed;
}

// ── 버전 메타 ─────────────────────────────────────────────────────────────────

async function getVersionUrl(mcVersion: string): Promise<string> {
  const res = await fetch("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json");
  const manifest = await res.json() as VersionManifest;
  const found = manifest.versions.find(v => v.id === mcVersion);
  if (!found) throw new Error(`Minecraft version ${mcVersion} not found`);
  return found.url;
}

async function getVersionMeta(mcVersion: string): Promise<VersionMeta> {
  const metaPath = join(MC_BASE, "versions", mcVersion, `${mcVersion}.json`);
  if (existsSync(metaPath)) {
    return JSON.parse(await Bun.file(metaPath).text()) as VersionMeta;
  }
  const url = await getVersionUrl(mcVersion);
  const res = await fetch(url);
  const meta = await res.json() as VersionMeta;
  mkdirSync(join(MC_BASE, "versions", mcVersion), { recursive: true });
  await Bun.write(metaPath, JSON.stringify(meta, null, 2));
  return meta;
}

// ── 설치 확인 ─────────────────────────────────────────────────────────────────

export function isMinecraftInstalled(mcVersion: string): boolean {
  return existsSync(join(MC_BASE, "versions", mcVersion, `${mcVersion}.jar`));
}

// ── 설치 ─────────────────────────────────────────────────────────────────────

export async function installMinecraft(
  mcVersion: string,
  onProgress: (p: McInstallProgress) => void
): Promise<void> {
  onProgress({ stage: "meta" });
  const meta = await getVersionMeta(mcVersion);

  // 1. client.jar
  const clientPath = join(MC_BASE, "versions", mcVersion, `${mcVersion}.jar`);
  if (!existsSync(clientPath)) {
    await downloadFile(meta.downloads.client.url, clientPath, (p) =>
      onProgress({ stage: "client", progress: p })
    );
  }

  // 2. libraries
  const libs = meta.libraries.filter(isLibraryAllowed).filter(l => l.downloads?.artifact);
  let libDone = 0;
  for (const lib of libs) {
    const artifact = lib.downloads!.artifact!;
    const dest = join(MC_BASE, "libraries", artifact.path.replace(/\//g, "\\"));
    if (!existsSync(dest)) {
      await downloadFile(artifact.url, dest);
    }
    libDone++;
    onProgress({ stage: "libraries", current: libDone, total: libs.length });
  }

  // 3. assets
  const assetIndexPath = join(MC_BASE, "assets", "indexes", `${meta.assetIndex.id}.json`);
  if (!existsSync(assetIndexPath)) {
    await downloadFile(meta.assetIndex.url, assetIndexPath);
  }
  const assetIndex = JSON.parse(await Bun.file(assetIndexPath).text()) as AssetIndex;
  const assetEntries = Object.entries(assetIndex.objects);
  let assetDone = 0;
  for (const [, { hash }] of assetEntries) {
    const prefix = hash.slice(0, 2);
    const dest = join(MC_BASE, "assets", "objects", prefix, hash);
    if (!existsSync(dest)) {
      await downloadFile(`https://resources.download.minecraft.net/${prefix}/${hash}`, dest);
    }
    assetDone++;
    if (assetDone % 50 === 0 || assetDone === assetEntries.length) {
      onProgress({ stage: "assets", current: assetDone, total: assetEntries.length });
    }
  }

  onProgress({ stage: "done" });
}

// ── 실행 인수 조립 ─────────────────────────────────────────────────────────────

export async function buildLaunchArgs(params: {
  mcVersion: string;
  javaPath: string;
  username: string;
  uuid: string;
  accessToken: string;
  serverIp?: string;
  serverPort?: number;
  memoryMb?: number;
}): Promise<string[]> {
  const { mcVersion, javaPath, username, uuid, accessToken, serverIp, serverPort, memoryMb = 2048 } = params;
  const meta = await getVersionMeta(mcVersion);

  const gameDir = join(MC_BASE, "game");
  const nativesDir = join(MC_BASE, "versions", mcVersion, "natives");
  mkdirSync(gameDir, { recursive: true });
  mkdirSync(nativesDir, { recursive: true });

  // classpath 조립
  const libs = meta.libraries.filter(isLibraryAllowed).filter(l => l.downloads?.artifact);
  const classpathEntries = [
    ...libs.map(l => join(MC_BASE, "libraries", l.downloads!.artifact!.path.replace(/\//g, "\\"))),
    join(MC_BASE, "versions", mcVersion, `${mcVersion}.jar`),
  ];
  const classpath = classpathEntries.join(";");

  const vars: Record<string, string> = {
    "${auth_player_name}": username,
    "${version_name}": mcVersion,
    "${game_directory}": gameDir,
    "${assets_root}": join(MC_BASE, "assets"),
    "${assets_index_name}": meta.assetIndex.id,
    "${auth_uuid}": uuid,
    "${auth_access_token}": accessToken,
    "${user_type}": "msa",
    "${version_type}": "release",
    "${natives_directory}": nativesDir,
    "${launcher_name}": "mc-launcher",
    "${launcher_version}": "1.0",
    "${classpath}": classpath,
  };

  const UNRESOLVED = "\x00UNRESOLVED\x00";

  function resolveArg(arg: string): string {
    return arg.replace(/\$\{[^}]+\}/g, (m) => vars[m] ?? UNRESOLVED);
  }

  function filterArgs(
    args: (string | { rules: OsRule[]; value: string | string[] })[]
  ): string[] {
    const result: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (typeof arg === "string") {
        const resolved = resolveArg(arg);
        if (resolved.includes(UNRESOLVED)) continue;
        // --flag 다음 값이 미치환이면 플래그도 건너뜀
        if (resolved.startsWith("--") && i + 1 < args.length) {
          const nextArg = args[i + 1];
          if (typeof nextArg === "string" && resolveArg(nextArg).includes(UNRESOLVED)) {
            i++;
            continue;
          }
        }
        result.push(resolved);
      } else {
        const allowed = arg.rules.every(r => {
          if (r.features) return false;
          const osMatch = !r.os || r.os.name === "windows";
          return r.action === "allow" ? osMatch : !osMatch;
        });
        if (allowed) {
          const vals = Array.isArray(arg.value) ? arg.value : [arg.value];
          const resolved = vals.map(resolveArg);
          // 값 중 하나라도 미치환이면 전체 인수 그룹 제거
          if (!resolved.some(v => v.includes(UNRESOLVED))) {
            result.push(...resolved);
          }
        }
      }
    }
    return result;
  }

  const jvmArgs: string[] = [];
  const gameArgs: string[] = [];

  if (meta.arguments) {
    jvmArgs.push(...filterArgs(meta.arguments.jvm));
    gameArgs.push(...filterArgs(meta.arguments.game));
  } else if (meta.minecraftArguments) {
    gameArgs.push(...meta.minecraftArguments.split(" ").map(resolveArg).filter(v => v !== ""));
  }

  const args = [
    javaPath,
    `-Xmx${memoryMb}m`,
    `-Xms${Math.min(512, memoryMb)}m`,
    ...jvmArgs,
    meta.mainClass,
    ...gameArgs,
  ];

  if (serverIp) {
    args.push("--server", serverIp);
    if (serverPort) args.push("--port", String(serverPort));
  }

  return args;
}
