import { useState, useEffect } from "react";
import { electroview } from "./electroview";
import type { ServerConfig, JavaState, McStatus, McInstallProgress, ModLoaderProgress, ModsProgress, FilesProgress } from "../shared/rpcSchema";

const rpcRequest = (electroview.rpc as any)?.request;
const rpcSend = (electroview.rpc as any)?.send;
const rpcListen = (electroview.rpc as any)?.addMessageListener?.bind(electroview.rpc);

type AuthState =
	| { status: "loading" }
	| { status: "loggedOut" }
	| { status: "loggedIn"; username: string }
	| { status: "error"; message: string };

function App() {
	const [auth, setAuth] = useState<AuthState>({ status: "loading" });
	const [version, setVersion] = useState("");
	const [servers, setServers] = useState<ServerConfig[]>([]);
	const [selectedServer, setSelectedServer] = useState<ServerConfig | null>(null);
	const [javaStates, setJavaStates] = useState<Record<number, JavaState>>({});
	const [mcStatus, setMcStatus] = useState<McStatus>({ status: "idle" });
	const [modLoaderStatus, setModLoaderStatus] = useState<ModLoaderProgress | null>(null);
	const [modsStatus, setModsStatus] = useState<ModsProgress | null>(null);
	const [filesStatus, setFilesStatus] = useState<FilesProgress | null>(null);

	useEffect(() => {
		rpcRequest?.getAppVersion()
			.then((info: { version: string }) => setVersion(info.version))
			.catch(() => {});

		rpcRequest?.getAuthStatus()
			.then((res: { loggedIn: boolean; username: string | null }) => {
				setAuth(
					res.loggedIn && res.username
						? { status: "loggedIn", username: res.username }
						: { status: "loggedOut" }
				);
			})
			.catch(() => setAuth({ status: "loggedOut" }));

		rpcRequest?.getServers()
			.then((res: { servers: ServerConfig[] }) => {
				setServers(res.servers);
				if (res.servers.length > 0) setSelectedServer(res.servers[0]);
			})
			.catch(() => {});

		rpcListen?.("loginResult", (payload: { success: boolean; username?: string; error?: string }) => {
			if (payload.success && payload.username) {
				setAuth({ status: "loggedIn", username: payload.username });
			} else {
				setAuth({ status: "error", message: payload.error ?? "로그인 실패" });
			}
		});

		rpcListen?.("mcStatus", (payload: McStatus) => {
			setMcStatus(payload);
		});

		rpcListen?.("modLoaderStatus", (payload: ModLoaderProgress) => {
			setModLoaderStatus(payload.stage === "done" ? null : payload);
		});

		rpcListen?.("modsStatus", (payload: ModsProgress) => {
			setModsStatus(payload.stage === "done" ? null : payload);
		});

		rpcListen?.("filesStatus", (payload: FilesProgress) => {
			setFilesStatus(payload.stage === "done" ? null : payload);
		});

		rpcListen?.("javaStatus", (payload: JavaState) => {
			if (payload.status === "ready" || payload.status === "downloading" || payload.status === "extracting") {
				setJavaStates(prev => ({ ...prev, [payload.version]: payload }));
			} else if (payload.status === "error") {
				// 에러는 모든 버전에 표시
				setJavaStates(prev => {
					const next = { ...prev };
					Object.keys(next).forEach(k => {
						next[Number(k)] = payload;
					});
					return next;
				});
			}
		});
	}, []);

	function handleLogin() {
		setAuth({ status: "loading" });
		rpcSend?.startLogin({});
	}

	async function handleLogout() {
		await rpcRequest?.logout().catch(() => {});
		setAuth({ status: "loggedOut" });
	}

	const requiredJavaVersion = selectedServer
		? getRequiredJavaVersion(selectedServer.mcVersion)
		: null;

	const javaState = requiredJavaVersion ? javaStates[requiredJavaVersion] : undefined;
	const javaReady = javaState?.status === "ready";
	const isBusy = mcStatus.status === "installing" || mcStatus.status === "launching" || mcStatus.status === "running" || modLoaderStatus !== null || modsStatus !== null || filesStatus !== null;
	const canPlay = auth.status === "loggedIn" && javaReady && !isBusy;

	function handlePlay() {
		if (!selectedServer || !canPlay) return;
		setMcStatus({ status: "launching" });
		rpcSend?.launch({ serverId: selectedServer.id });
	}

	return (
		<div className="h-screen bg-[#1a1a2e] text-white flex flex-col select-none">
			{/* 헤더 */}
			<header className="flex items-center justify-between px-6 py-4 bg-[#16213e] border-b border-white/10">
				<div className="flex items-center gap-3">
					<div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center font-bold text-sm">
						M
					</div>
					<span className="font-semibold text-lg tracking-wide">MC Launcher</span>
				</div>
				<div className="flex items-center gap-3">
					{auth.status === "loggedIn" && (
						<>
							<span className="text-sm text-white/60">{auth.username}</span>
							<button
								onClick={handleLogout}
								className="text-xs text-white/40 hover:text-white/70 transition-colors"
							>
								로그아웃
							</button>
						</>
					)}
					{version && <span className="text-xs text-white/30">v{version}</span>}
				</div>
			</header>

			<main className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
				{/* 서버 선택 */}
				{servers.length > 1 && (
					<div className="flex gap-2">
						{servers.map(s => (
							<button
								key={s.id}
								onClick={() => setSelectedServer(s)}
								className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
									selectedServer?.id === s.id
										? "bg-green-500 text-white"
										: "bg-white/10 text-white/60 hover:bg-white/20"
								}`}
							>
								{s.name}
							</button>
						))}
					</div>
				)}

				{/* 서버 정보 */}
				{selectedServer ? (
					<>
						<div className="text-center">
							<h1 className="text-4xl font-bold mb-2 text-green-400">{selectedServer.name}</h1>
							<p className="text-white/50 text-sm">
								{selectedServer.modLoader.toUpperCase()} {selectedServer.mcVersion}
							</p>
						</div>

						<div className="w-full max-w-md bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
							<div className="flex items-center justify-between text-sm">
								<span className="text-white/50">서버</span>
								<span className="text-white/80 font-mono">
									{selectedServer.ip}{selectedServer.port ? `:${selectedServer.port}` : ""}
								</span>
							</div>
							<div className="flex items-center justify-between text-sm">
								<span className="text-white/50">버전</span>
								<span className="text-white/80">{selectedServer.mcVersion}</span>
							</div>
							<div className="flex items-center justify-between text-sm">
								<span className="text-white/50">모드 로더</span>
								<span className="text-white/80 capitalize">{selectedServer.modLoader}</span>
							</div>
							<div className="flex items-center justify-between text-sm">
								<span className="text-white/50">Java</span>
								<JavaStatusBadge state={javaState} version={requiredJavaVersion!} />
							</div>
						</div>
					</>
				) : (
					<div className="text-center text-white/30 text-sm">등록된 서버가 없습니다.</div>
				)}

				{/* 인증 영역 */}
				{auth.status === "loading" && (
					<div className="flex gap-2 items-center text-white/40">
						<div className="w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
						<span className="text-sm">확인 중...</span>
					</div>
				)}

				{auth.status === "loggedOut" && (
					<div className="flex flex-col items-center gap-3 w-full max-w-md">
						<p className="text-white/50 text-sm">플레이하려면 Microsoft 계정으로 로그인하세요.</p>
						<button
							onClick={handleLogin}
							className="w-full py-3 bg-[#107c10] hover:bg-[#0e6b0e] active:bg-[#0a5a0a] rounded-xl font-semibold text-base transition-colors"
						>
							Microsoft로 로그인
						</button>
					</div>
				)}

				{auth.status === "loggedIn" && (
					<>
						<button
							onClick={handlePlay}
							disabled={!canPlay}
							className={`w-full max-w-md py-4 rounded-xl font-bold text-lg transition-colors shadow-lg ${
								canPlay
									? "bg-green-500 hover:bg-green-400 active:bg-green-600 shadow-green-900/40"
									: "bg-white/10 text-white/30 cursor-not-allowed"
							}`}
						>
							{mcStatus.status === "installing"
								? getMcInstallText(mcStatus.progress)
								: mcStatus.status === "launching"
								? "실행 중..."
								: mcStatus.status === "running"
								? "게임 실행됨"
								: modLoaderStatus !== null
								? getModLoaderText(modLoaderStatus)
								: modsStatus !== null
								? getModsText(modsStatus)
								: filesStatus !== null
								? getFilesText(filesStatus)
								: javaReady
								? "플레이"
								: javaState?.status === "downloading"
								? `Java ${requiredJavaVersion} 다운로드 중... ${(javaState as any).progress}%`
								: javaState?.status === "extracting"
								? `Java ${requiredJavaVersion} 압축 해제 중...`
								: `Java ${requiredJavaVersion} 준비 중...`}
						</button>
						{mcStatus.status === "error" && (
							<p className="text-red-400 text-sm w-full max-w-md text-center">{(mcStatus as any).message}</p>
						)}
					</>
				)}

				{auth.status === "error" && (
					<div className="flex flex-col items-center gap-3 w-full max-w-md">
						<p className="text-red-400 text-sm">{auth.message}</p>
						<button
							onClick={handleLogin}
							className="w-full py-3 bg-[#107c10] hover:bg-[#0e6b0e] rounded-xl font-semibold transition-colors"
						>
							다시 시도
						</button>
					</div>
				)}
			</main>

			<footer className="px-6 py-3 bg-[#16213e] border-t border-white/10 flex justify-between items-center">
				<span className="text-xs text-white/30">
					{selectedServer ? `서버: ${selectedServer.ip}` : "서버 미선택"}
				</span>
				<span className="text-xs text-white/30">
					{javaState?.status === "ready"
						? `Java ${requiredJavaVersion} ✓`
						: javaState?.status === "downloading"
						? `Java 다운로드 중 ${(javaState as any).progress}%`
						: javaState?.status === "extracting"
						? `Java 압축 해제 중...`
						: requiredJavaVersion
						? `Java ${requiredJavaVersion} 확인 중`
						: ""}
				</span>
			</footer>
		</div>
	);
}

function JavaStatusBadge({ state, version }: { state: JavaState | undefined; version: number }) {
	if (!state) {
		return <span className="text-white/40 text-xs">Java {version} 확인 중...</span>;
	}
	if (state.status === "checking") {
		return <span className="text-white/40 text-xs">확인 중...</span>;
	}
	if (state.status === "ready") {
		return <span className="text-green-400 text-xs">Java {version} ✓</span>;
	}
	if (state.status === "downloading") {
		return <span className="text-yellow-400 text-xs">다운로드 중 {state.progress}%</span>;
	}
	if (state.status === "extracting") {
		return <span className="text-yellow-400 text-xs">압축 해제 중...</span>;
	}
	return <span className="text-red-400 text-xs">오류</span>;
}

function getFilesText(progress: FilesProgress): string {
	switch (progress.stage) {
		case "checking": return `파일 확인 중... ${progress.current}/${progress.total}`;
		case "downloading": return `파일 다운로드 중... ${progress.current}/${progress.total} (${progress.progress}%)`;
		case "extracting": return `압축 해제 중... ${progress.current}/${progress.total}`;
		case "done": return "플레이";
	}
}

function getModsText(progress: ModsProgress): string {
	switch (progress.stage) {
		case "checking": return `모드 확인 중... ${progress.current}/${progress.total}`;
		case "downloading": return `모드 다운로드 중... ${progress.current}/${progress.total} (${progress.progress}%)`;
		case "done": return "플레이";
	}
}

function getModLoaderText(progress: ModLoaderProgress): string {
	switch (progress.stage) {
		case "checking": return "모드 로더 확인 중...";
		case "downloading_installer": return `모드 로더 다운로드 중... ${progress.progress}%`;
		case "installing": return "모드 로더 설치 중...";
		case "downloading_libraries": return `모드 로더 라이브러리 ${progress.current}/${progress.total}`;
		case "done": return "플레이";
	}
}

function getMcInstallText(progress: McInstallProgress): string {
	switch (progress.stage) {
		case "meta": return "버전 정보 로드 중...";
		case "client": return `게임 다운로드 중... ${progress.progress}%`;
		case "libraries": return `라이브러리 설치 중... ${progress.current}/${progress.total}`;
		case "assets": return `에셋 다운로드 중... ${progress.current}/${progress.total}`;
		case "done": return "설치 완료";
	}
}

function getRequiredJavaVersion(mcVersion: string): number {
	const [, minor] = mcVersion.split(".").map(Number);
	if (minor >= 21) return 21;
	if (minor >= 17) return 17;
	return 8;
}

export default App;
