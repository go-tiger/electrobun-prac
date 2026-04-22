import { BrowserWindow, BrowserView, Updater } from 'electrobun/bun';
import { join } from 'path';
import { tmpdir } from 'os';

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === 'dev') {
    try {
      await fetch(DEV_SERVER_URL, { method: 'HEAD' });
      return DEV_SERVER_URL;
    } catch {
      // Vite dev server not running
    }
  }
  return 'views://mainview/index.html';
}

const rpc = BrowserView.defineRPC({
  handlers: {
    requests: {
      async getAppVersion() {
        const version = await Updater.localInfo.version();
        const hash = await Updater.localInfo.hash();
        const channel = await Updater.localInfo.channel();
        return { version, hash: hash.slice(0, 8), channel };
      },
    },
  },
});

function makeUpdateHtml(message: string, progress?: number): string {
  const bar =
    progress !== undefined
      ? `<div style="background:#e2e8f0;border-radius:9999px;height:8px;margin-top:16px;overflow:hidden">
			<div style="background:#6366f1;height:100%;width:${progress}%;transition:width 0.3s"></div>
		   </div>
		   <p style="margin-top:8px;font-size:13px;color:#94a3b8">${progress}%</p>`
      : `<div style="margin-top:16px;display:flex;gap:6px;justify-content:center">
			<div class="dot"></div><div class="dot"></div><div class="dot"></div>
		   </div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    height: 100vh; display: flex; align-items: center; justify-content: center;
    color: white; text-align: center; }
  .card { background: rgba(255,255,255,0.15); backdrop-filter: blur(10px);
    border-radius: 16px; padding: 40px 48px; width: 360px; }
  h1 { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
  p { font-size: 14px; color: rgba(255,255,255,0.8); }
  @keyframes bounce { 0%,80%,100%{transform:scale(0)} 40%{transform:scale(1)} }
  .dot { width:8px;height:8px;background:rgba(255,255,255,0.8);border-radius:50%;
    animation:bounce 1.4s infinite ease-in-out both; }
  .dot:nth-child(1){animation-delay:-0.32s}
  .dot:nth-child(2){animation-delay:-0.16s}
</style></head><body>
<div class="card">
  <h1>Updating...</h1>
  <p>${message}</p>
  ${bar}
</div>
</body></html>`;
}

async function checkForUpdateAndOpen() {
  const info = await Updater.checkForUpdate().catch(() => null);

  if (!info?.updateAvailable) {
    const url = await getMainViewUrl();
    new BrowserWindow({
      title: 'React + Tailwind + Vite',
      url,
      rpc,
      frame: { width: 900, height: 700, x: 200, y: 200 },
    });
    return;
  }

  // 업데이트 있으면 업데이트 창 먼저 열기
  const updateWindow = new BrowserWindow({
    title: 'Updating...',
    html: makeUpdateHtml('Downloading new version...'),
    frame: { width: 400, height: 280, x: 500, y: 300 },
  });

  try {
    const baseUrl = await Updater.localInfo.baseUrl();
    const installerUrl = `${baseUrl}/react-tailwind-vite-setup.exe`;
    const installerPath = join(tmpdir(), 'react-tailwind-vite-setup.exe');

    const res = await fetch(installerUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const contentLength = res.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : undefined;
    let downloaded = 0;

    const reader = res.body!.getReader();
    const writer = Bun.file(installerPath).writer();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await writer.write(value);
      downloaded += value.length;

      if (totalBytes) {
        const progress = Math.round((downloaded / totalBytes) * 100);
        updateWindow.webview.loadHTML(makeUpdateHtml('Downloading new version...', progress));
      }
    }
    await writer.flush();
    writer.end();

    updateWindow.webview.loadHTML(makeUpdateHtml('Installing...', 100));

    // 설치 완료 후 앱 자동 실행을 위한 배치 스크립트
    const installDir = join(process.env['LOCALAPPDATA'] || '', 'react-tailwind-vite');
    const launcherPath = join(installDir, 'bin', 'launcher.exe').replace(/\//g, '\\');
    const installerPathWin = installerPath.replace(/\//g, '\\');
    const scriptPath = join(tmpdir(), 'electrobun-update-launch.bat').replace(/\//g, '\\');

    await Bun.write(
      scriptPath,
      `@echo off
"${installerPathWin}" /S
start "" "${launcherPath}"
del "%~f0"
`,
    );

    // schtasks로 배치 스크립트 예약 실행 (앱 종료 후에도 독립적으로 실행됨)
    const taskName = `ElectrobunUpdate_${Date.now()}`;
    Bun.spawnSync([
      'schtasks', '/create', '/tn', taskName,
      '/tr', `cmd /c "${scriptPath}"`,
      '/sc', 'once', '/st', '00:00', '/f',
    ], { stdio: ['ignore', 'ignore', 'ignore'] });
    Bun.spawnSync(['schtasks', '/run', '/tn', taskName], { stdio: ['ignore', 'ignore', 'ignore'] });
    process.exit(0);
  } catch (e) {
    console.error('Update failed:', e);
    // 다운로드 실패 시 메인 창으로 fallback
    const url = await getMainViewUrl();
    new BrowserWindow({
      title: 'React + Tailwind + Vite',
      url,
      rpc,
      frame: { width: 900, height: 700, x: 200, y: 200 },
    });
  }
}

checkForUpdateAndOpen();

console.log('React Tailwind Vite app started!');
