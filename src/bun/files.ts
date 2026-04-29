import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import { unzipSync } from "fflate";
import type { FileConfig } from "./servers";

const MC_BASE = join(
  process.env["APPDATA"] || process.env["HOME"] || ".",
  "mc-launcher",
  "minecraft"
);

export type FilesProgress =
  | { stage: "checking"; current: number; total: number }
  | { stage: "downloading"; name: string; current: number; total: number; progress: number }
  | { stage: "extracting"; name: string; current: number; total: number }
  | { stage: "done" };

async function sha1File(path: string): Promise<string> {
  const data = await Bun.file(path).arrayBuffer();
  return createHash("sha1").update(new Uint8Array(data)).digest("hex");
}

async function downloadFile(url: string, dest: string, onProgress: (p: number) => void): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`파일 다운로드 실패 ${url}: ${res.status}`);
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

async function extractZip(srcPath: string, destDir: string): Promise<void> {
  const data = new Uint8Array(await Bun.file(srcPath).arrayBuffer());
  const files = unzipSync(data);
  for (const [filename, content] of Object.entries(files)) {
    if (filename.endsWith("/")) continue; // 디렉토리 엔트리 스킵
    const outPath = join(destDir, filename);
    const outDir = outPath.substring(0, Math.max(outPath.lastIndexOf("\\"), outPath.lastIndexOf("/")));
    mkdirSync(outDir, { recursive: true });
    await Bun.write(outPath, content);
  }
}

async function extractTarGz(srcPath: string, destDir: string): Promise<void> {
  const gz = new Uint8Array(await Bun.file(srcPath).arrayBuffer());
  const tar = Bun.gunzipSync(gz);

  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.slice(offset, offset + 512);
    const filename = new TextDecoder().decode(header.slice(0, 100)).replace(/\0/g, "").trim();
    if (!filename) break;

    const sizeStr = new TextDecoder().decode(header.slice(124, 136)).replace(/\0/g, "").trim();
    const size = parseInt(sizeStr, 8) || 0;
    const typeFlag = String.fromCharCode(header[156]);

    offset += 512;

    if (typeFlag !== "5" && size > 0 && filename) {
      const outPath = join(destDir, filename);
      const outDir = outPath.substring(0, Math.max(outPath.lastIndexOf("\\"), outPath.lastIndexOf("/")));
      mkdirSync(outDir, { recursive: true });
      await Bun.write(outPath, tar.slice(offset, offset + size));
    }

    offset += Math.ceil(size / 512) * 512;
  }
}

export async function installFiles(
  files: FileConfig[],
  onProgress: (p: FilesProgress) => void
): Promise<void> {
  if (files.length === 0) {
    onProgress({ stage: "done" });
    return;
  }

  const gameDir = join(MC_BASE, "game");

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress({ stage: "checking", current: i + 1, total: files.length });

    const destPath = join(gameDir, file.path);
    const destDir = destPath.substring(0, Math.max(destPath.lastIndexOf("\\"), destPath.lastIndexOf("/")));
    mkdirSync(destDir, { recursive: true });

    let needsDownload = true;

    if (existsSync(destPath)) {
      if (!file.overwrite) {
        needsDownload = false; // once: 있으면 스킵
      } else {
        const hash = await sha1File(destPath);
        needsDownload = hash !== file.sha1;
      }
    }

    if (!needsDownload) continue;

    // extract 모드면 임시 경로에 다운로드
    const downloadDest = file.extract ? destPath : destPath;
    await downloadFile(file.url, downloadDest, (progress) => {
      onProgress({ stage: "downloading", name: file.filename, current: i + 1, total: files.length, progress });
    });

    // 다운로드 후 sha1 검증
    const hash = await sha1File(downloadDest);
    if (hash !== file.sha1) {
      throw new Error(`파일 해시 불일치: ${file.filename}`);
    }

    // 압축 해제
    if (file.extract) {
      onProgress({ stage: "extracting", name: file.filename, current: i + 1, total: files.length });
      const ext = file.filename.toLowerCase();
      const extractDir = join(gameDir, file.path.replace(/[/\\][^/\\]+$/, "")); // path의 상위 디렉토리
      if (ext.endsWith(".tar.gz") || ext.endsWith(".tgz")) {
        await extractTarGz(downloadDest, extractDir);
      } else {
        await extractZip(downloadDest, extractDir);
      }
    }
  }

  onProgress({ stage: "done" });
}
