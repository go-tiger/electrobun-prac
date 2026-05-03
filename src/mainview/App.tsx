import { useState, useEffect } from "react";
import { electroview } from "./electroview";
import LandingScreen from "./screens/LandingScreen";
import type { ServerConfig, JavaState, McStatus, ModLoaderProgress, ModsProgress, FilesProgress } from "../shared/rpcSchema";

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

	// 로그인 상태일 때만 LandingScreen 표시
	if (auth.status === "loggedIn") {
		return (
			<LandingScreen
				auth={auth}
				version={version}
				servers={servers}
				selectedServer={selectedServer}
				javaStates={javaStates}
				mcStatus={mcStatus}
				modLoaderStatus={modLoaderStatus}
				modsStatus={modsStatus}
				filesStatus={filesStatus}
				onServerChange={setSelectedServer}
				onPlay={handlePlay}
				onLogout={handleLogout}
				onSettings={() => {}} // 나중에 설정 화면으로
			/>
		);
	}

	// 로그인 전 화면
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
				{version && <span className="text-xs text-white/30">v{version}</span>}
			</header>

			<main className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
				{/* 로딩 상태 */}
				{auth.status === "loading" && (
					<div className="flex gap-2 items-center text-white/40">
						<div className="w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
						<span className="text-sm">확인 중...</span>
					</div>
				)}

				{/* 로그아웃 상태 */}
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

				{/* 에러 상태 */}
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
		</div>
	);
}

function getRequiredJavaVersion(mcVersion: string): number {
	const [, minor] = mcVersion.split(".").map(Number);
	if (minor >= 21) return 21;
	if (minor >= 17) return 17;
	return 8;
}

export default App;
