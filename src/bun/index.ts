import { BrowserWindow, BrowserView, Updater } from "electrobun/bun";
import type { UpdateStatusEntry } from "electrobun/bun";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
			return DEV_SERVER_URL;
		} catch {
			console.log(
				"Vite dev server not running. Run 'bun run dev:hmr' for HMR support.",
			);
		}
	}
	return "views://mainview/index.html";
}

// bun handles: checkForUpdate, downloadUpdate, applyUpdate, getUpdateInfo, getAppVersion
// webview handles: onUpdateStatus (called by bun to push status)
const rpc = BrowserView.defineRPC({
	handlers: {
		requests: {
			async checkForUpdate() {
				return await Updater.checkForUpdate();
			},
			async downloadUpdate() {
				await Updater.downloadUpdate();
				return Updater.updateInfo() ?? null;
			},
			async applyUpdate() {
				await Updater.applyUpdate();
			},
			async getUpdateInfo() {
				return Updater.updateInfo() ?? null;
			},
			async getAppVersion() {
				const version = await Updater.localInfo.version();
				const hash = await Updater.localInfo.hash();
				const channel = await Updater.localInfo.channel();
				return { version, hash: hash.slice(0, 8), channel };
			},
		},
	},
});

const url = await getMainViewUrl();

const mainWindow = new BrowserWindow({
	title: "React + Tailwind + Vite",
	url,
	rpc,
	frame: {
		width: 900,
		height: 700,
		x: 200,
		y: 200,
	},
});

// Push update status changes to the webview via request
Updater.onStatusChange((entry: UpdateStatusEntry) => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(mainWindow.webview.rpc?.request as any)
		?.onUpdateStatus?.(entry)
		?.catch?.(() => {});
});

async function checkAndApplyUpdate() {
	try {
		const info = await Updater.checkForUpdate();
		if (info.updateAvailable) {
			await Updater.downloadUpdate();
			await Updater.applyUpdate(); // 다운로드 완료 즉시 재시작
		}
	} catch {
		// ignore
	}
}

// 앱 시작 3초 후 자동 체크 (webview 로딩 완료 후)
setTimeout(checkAndApplyUpdate, 3000);

// 이후 1시간마다 반복 체크
const ONE_HOUR = 60 * 60 * 1000;
setInterval(checkAndApplyUpdate, ONE_HOUR);

console.log("React Tailwind Vite app started!");
