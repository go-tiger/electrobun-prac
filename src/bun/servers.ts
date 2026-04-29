import { join } from "path";

const SERVERS_PATH = join(
  process.env["APPDATA"] || process.env["HOME"] || ".",
  "mc-launcher",
  "servers.json"
);

export type ServerConfig = {
  id: string;
  name: string;
  mcVersion: string;
  modLoader: "fabric" | "forge" | "quilt" | "neoforge" | "vanilla";
  ip: string;
  port?: number;
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
