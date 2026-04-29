import { join } from "path";

const SERVERS_PATH = join(
  process.env["APPDATA"] || process.env["HOME"] || ".",
  "mc-launcher",
  "servers.json"
);

export type ModConfig = {
  name: string;
  url: string;
  filename: string;
  sha1: string;
};

export type FileConfig = {
  url: string;
  filename: string;
  sha1: string;
  path: string;        // game 폴더 기준 설치 경로 (예: "shaderpacks/BSL.zip")
  overwrite: boolean;  // true: sha1 다르면 덮어쓰기, false: 없을 때만 설치
  extract?: boolean;   // true: 확장자 보고 zip/.tar.gz 압축 해제
};

export type ServerConfig = {
  id: string;
  name: string;
  mcVersion: string;
  modLoader: "fabric" | "forge" | "neoforge" | "vanilla";
  loaderVersion?: string; // 생략 시 최신 버전 자동 사용
  ip: string;
  port?: number;
  mods?: ModConfig[];
  files?: FileConfig[];
};

export type ServersFile = {
  servers: ServerConfig[];
};

export function getRequiredJavaVersion(mcVersion: string): 8 | 17 | 21 {
  const [major, minor] = mcVersion.split(".").map(Number);
  if (major === 1) {
    if (minor >= 21) return 21;
    if (minor >= 17) return 17;
  }
  return 8;
}

export async function loadServers(): Promise<ServersFile> {
  try {
    const text = await Bun.file(SERVERS_PATH).text();
    return JSON.parse(text) as ServersFile;
  } catch {
    return { servers: [] };
  }
}

export async function saveServers(data: ServersFile): Promise<void> {
  await Bun.write(SERVERS_PATH, JSON.stringify(data, null, 2));
}
