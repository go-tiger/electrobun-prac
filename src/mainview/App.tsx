import { useState, useEffect } from "react";
import { electroview } from "./electroview";

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

		// bun에서 로그인 결과 수신
		rpcListen?.("loginResult", (payload: { success: boolean; username?: string; error?: string }) => {
			if (payload.success && payload.username) {
				setAuth({ status: "loggedIn", username: payload.username });
			} else {
				setAuth({ status: "error", message: payload.error ?? "로그인 실패" });
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

	return (
		<div className="h-screen bg-[#1a1a2e] text-white flex flex-col select-none">
			{/* 상단 헤더 */}
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
					{version && (
						<span className="text-xs text-white/30">v{version}</span>
					)}
				</div>
			</header>

			{/* 메인 콘텐츠 */}
			<main className="flex-1 flex flex-col items-center justify-center gap-8 px-8">
				<div className="text-center">
					<h1 className="text-4xl font-bold mb-2 text-green-400">우리 서버</h1>
					<p className="text-white/50 text-sm">Fabric 1.20.1 · 모드팩 v1.0</p>
				</div>

				<div className="w-full max-w-md bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
					<div className="flex items-center justify-between text-sm">
						<span className="text-white/50">서버</span>
						<span className="text-white/80 font-mono">play.example.com</span>
					</div>
					<div className="flex items-center justify-between text-sm">
						<span className="text-white/50">버전</span>
						<span className="text-white/80">1.20.1</span>
					</div>
					<div className="flex items-center justify-between text-sm">
						<span className="text-white/50">모드 로더</span>
						<span className="text-white/80">Fabric</span>
					</div>
					<div className="flex items-center justify-between text-sm">
						<span className="text-white/50">모드팩</span>
						<span className="text-white/80">v1.0.0</span>
					</div>
				</div>

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
					<button className="w-full max-w-md py-4 bg-green-500 hover:bg-green-400 active:bg-green-600 rounded-xl font-bold text-lg transition-colors shadow-lg shadow-green-900/40">
						플레이
					</button>
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
				<span className="text-xs text-white/20">모드 설치 상태: 미확인</span>
				<span className="text-xs text-white/20">Java: 미확인</span>
			</footer>
		</div>
	);
}

export default App;
