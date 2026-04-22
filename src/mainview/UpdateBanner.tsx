import { useState, useEffect } from "react";
import { electroview, updateEvents, type UpdateStatusEntry } from "./electroview";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (electroview.rpc as any)?.request;

type AppVersion = { version: string; hash: string; channel: string };

export default function UpdateBanner() {
	const [appVersion, setAppVersion] = useState<AppVersion | null>(null);
	const [updateReady, setUpdateReady] = useState(false);
	const [downloading, setDownloading] = useState(false);
	const [progress, setProgress] = useState<number | undefined>(undefined);
	const [errorMsg, setErrorMsg] = useState("");

	useEffect(() => {
		rpc?.getAppVersion().then(setAppVersion).catch(() => {});

		return updateEvents.subscribe((entry: UpdateStatusEntry) => {
			if (entry.details?.progress !== undefined) {
				setProgress(entry.details.progress);
			}

			switch (entry.status) {
				case "downloading":
				case "download-starting":
				case "downloading-full-bundle":
				case "download-progress":
				case "decompressing":
				case "fetching-patch":
				case "downloading-patch":
				case "applying-patch":
					setDownloading(true);
					setErrorMsg("");
					break;
				case "download-complete":
				case "patch-chain-complete":
					setDownloading(false);
					setUpdateReady(true);
					setProgress(undefined);
					break;
				case "error":
					setDownloading(false);
					setProgress(undefined);
					setErrorMsg(entry.details?.errorMessage ?? entry.message);
					break;
				default:
					break;
			}
		});
	}, []);

	async function handleApply() {
		await rpc?.applyUpdate();
	}

	const isDev = appVersion?.channel === "dev";

	if (isDev || (!updateReady && !downloading && !errorMsg)) return null;

	return (
		<div
			className={`rounded-xl shadow-xl p-4 mb-8 flex items-center justify-between gap-4 ${
				updateReady
					? "bg-green-50 border border-green-200"
					: errorMsg
						? "bg-red-50 border border-red-200"
						: "bg-blue-50 border border-blue-200"
			}`}
		>
			<div className="flex items-center gap-3 flex-1">
				{downloading && (
					<div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
				)}
				<div className="flex-1">
					{downloading && (
						<>
							<p className="text-sm font-medium text-blue-700">업데이트 다운로드 중...</p>
							{progress !== undefined && (
								<div className="mt-1 w-full bg-blue-200 rounded-full h-1.5">
									<div
										className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
										style={{ width: `${progress}%` }}
									/>
								</div>
							)}
						</>
					)}
					{updateReady && (
						<p className="text-sm font-medium text-green-700">
							새 버전이 준비됐습니다. 재시작하여 업데이트를 적용하세요.
						</p>
					)}
					{errorMsg && (
						<p className="text-sm font-medium text-red-600">
							업데이트 오류: {errorMsg}
						</p>
					)}
				</div>
			</div>

			{updateReady && (
				<button
					onClick={handleApply}
					className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors flex-shrink-0"
				>
					재시작
				</button>
			)}
		</div>
	);
}
