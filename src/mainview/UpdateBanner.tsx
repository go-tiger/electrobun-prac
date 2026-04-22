import { useState, useEffect } from "react";
import { electroview, updateEvents, type UpdateStatusEntry } from "./electroview";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (electroview.rpc as any)?.request;

type UpdateStatus =
	| "idle"
	| "checking"
	| "no-update"
	| "update-available"
	| "downloading"
	| "download-complete"
	| "error";

type AppVersion = { version: string; hash: string; channel: string };

export default function UpdateBanner() {
	const [appVersion, setAppVersion] = useState<AppVersion | null>(null);
	const [status, setStatus] = useState<UpdateStatus>("idle");
	const [message, setMessage] = useState("");
	const [progress, setProgress] = useState<number | undefined>(undefined);
	const [updateReady, setUpdateReady] = useState(false);

	useEffect(() => {
		rpc.getAppVersion().then(setAppVersion).catch(() => {});

		return updateEvents.subscribe((entry: UpdateStatusEntry) => {
			setMessage(entry.message);
			if (entry.details?.progress !== undefined) {
				setProgress(entry.details.progress);
			}

			switch (entry.status) {
				case "checking":
					setStatus("checking");
					break;
				case "no-update":
					setStatus("no-update");
					setTimeout(() => setStatus("idle"), 3000);
					break;
				case "update-available":
					setStatus("update-available");
					break;
				case "downloading":
				case "download-starting":
				case "downloading-full-bundle":
				case "download-progress":
				case "decompressing":
				case "fetching-patch":
				case "downloading-patch":
				case "applying-patch":
					setStatus("downloading");
					break;
				case "download-complete":
				case "patch-chain-complete":
					setStatus("download-complete");
					setUpdateReady(true);
					setProgress(undefined);
					break;
				case "error":
					setStatus("error");
					setProgress(undefined);
					break;
			}
		});
	}, []);

	async function handleCheck() {
		setStatus("checking");
		setMessage("업데이트 확인 중...");
		try {
			const info = await rpc.checkForUpdate();
			if (info?.updateAvailable) {
				setStatus("update-available");
				setMessage(`새 버전 발견${info.version ? `: ${info.version}` : ""}`);
			} else if (!info?.error) {
				setStatus("no-update");
				setMessage("최신 버전입니다");
				setTimeout(() => setStatus("idle"), 3000);
			} else {
				setStatus("error");
				setMessage(info.error);
			}
		} catch {
			setStatus("error");
			setMessage("업데이트 확인 실패");
		}
	}

	async function handleDownload() {
		setStatus("downloading");
		setProgress(0);
		try {
			await rpc.downloadUpdate();
		} catch {
			setStatus("error");
			setMessage("다운로드 실패");
		}
	}

	async function handleApply() {
		await rpc.applyUpdate();
	}

	const isDev = appVersion?.channel === "dev";

	return (
		<div className="bg-white rounded-xl shadow-xl p-6 mb-8">
			<div className="flex items-center justify-between mb-4">
				<h2 className="text-2xl font-semibold text-indigo-600">자동 업데이트</h2>
				{appVersion && (
					<span className="text-sm text-gray-400 font-mono">
						v{appVersion.version} ({appVersion.hash})
						{appVersion.channel !== "release" && (
							<span className="ml-2 bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded text-xs">
								{appVersion.channel}
							</span>
						)}
					</span>
				)}
			</div>

			{isDev ? (
				<p className="text-gray-500 text-sm">
					개발 채널에서는 자동 업데이트가 비활성화됩니다.
				</p>
			) : (
				<>
					<div className="flex items-center gap-3 flex-wrap">
						{(status === "idle" || status === "no-update" || status === "error") && (
							<button
								onClick={handleCheck}
								className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
							>
								업데이트 확인
							</button>
						)}

						{status === "update-available" && (
							<button
								onClick={handleDownload}
								className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
							>
								다운로드
							</button>
						)}

						{(status === "download-complete" || updateReady) && (
							<button
								onClick={handleApply}
								className="px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 transition-colors"
							>
								재시작하여 업데이트 적용
							</button>
						)}

						{message && (
							<span
								className={`text-sm ${
									status === "error"
										? "text-red-500"
										: status === "no-update"
											? "text-green-600"
											: "text-gray-600"
								}`}
							>
								{message}
							</span>
						)}
					</div>

					{status === "downloading" && progress !== undefined && (
						<div className="mt-3">
							<div className="flex justify-between text-xs text-gray-500 mb-1">
								<span>다운로드 중...</span>
								<span>{progress}%</span>
							</div>
							<div className="w-full bg-gray-200 rounded-full h-2">
								<div
									className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
									style={{ width: `${progress}%` }}
								/>
							</div>
						</div>
					)}

					{status === "downloading" && progress === undefined && (
						<div className="mt-3 flex items-center gap-2 text-sm text-gray-500">
							<div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
							<span>{message}</span>
						</div>
					)}
				</>
			)}
		</div>
	);
}
