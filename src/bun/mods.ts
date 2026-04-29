import { join } from "path";
import { existsSync, mkdirSync, statSync } from "fs";
import { createHash } from "crypto";
import type { ModConfig } from "./servers";

const MC_BASE = join(
  process.env["APPDATA"] || process.env["HOME"] || ".",
  "mc-launcher",
  "minecraft"
);

export type ModsProgress =
  | { stage: "checking"; current: number; total: number }
  | { stage: "downloading"; name: string; current: number; total: number; progress: number }
  | { stage: "done" };

async function sha1File(path: string): Promise<string> {
  const data = await Bun.file(path).arrayBuffer();
  return createHash("sha1").update(new Uint8Array(data)).digest("hex");
}

async function downloadMod(mod: ModConfig, dest: string, onProgress: (p: number) => void): Promise<void> {
  const res = await fetch(mod.url);
  if (!res.ok) throw new Error(`모드 다운로드 실패 ${mod.filename}: ${res.status}`);
  const total = parseInt(res.headers.get("content-length") ?? "0", 10);
  let downloaded = 0;
  const reader = res.body!.getReader();
  const writer = Bun.file(dest).writer();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    await writer.write(value);
    downloaded += value.length;
    if (total) onProgress(Math.round((downloaded / total) * 100));
  }
  await writer.flush();
  writer.end();
}

export async function installMods(
  serverId: string,
  mods: ModConfig[],
  onProgress: (p: ModsProgress) => void
): Promise<void> {
  if (mods.length === 0) {
    onProgress({ stage: "done" });
    return;
  }

  const modsDir = join(MC_BASE, "game", "mods");
  mkdirSync(modsDir, { recursive: true });

  for (let i = 0; i < mods.length; i++) {
    const mod = mods[i];
    onProgress({ stage: "checking", current: i + 1, total: mods.length });

    const dest = join(modsDir, mod.filename);
    let needsDownload = true;

    if (existsSync(dest)) {
      const hash = await sha1File(dest);
      needsDownload = hash !== mod.sha1;
    }

    if (needsDownload) {
      await downloadMod(mod, dest, (progress) => {
        onProgress({ stage: "downloading", name: mod.name, current: i + 1, total: mods.length, progress });
      });

      // 다운로드 후 해시 검증
      const hash = await sha1File(dest);
      if (hash !== mod.sha1) {
        throw new Error(`모드 해시 불일치: ${mod.filename} (expected ${mod.sha1}, got ${hash})`);
      }
    }
  }

  onProgress({ stage: "done" });
}
