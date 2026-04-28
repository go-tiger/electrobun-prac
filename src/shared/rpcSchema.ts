import type { ElectrobunRPCSchema } from "electrobun/bun";

export type LauncherRPCSchema = ElectrobunRPCSchema & {
	bun: {
		requests: {
			getAppVersion: { params: void; response: { version: string; hash: string; channel: string } };
			getAuthStatus: { params: void; response: { loggedIn: boolean; username: string | null } };
			logout: { params: void; response: { loggedIn: boolean; username: string | null } };
		};
		// bun이 수신하는 메시지 (webview → bun)
		messages: {
			startLogin: Record<string, never>;
		};
	};
	webview: {
		requests: Record<string, never>;
		// webview가 수신하는 메시지 (bun → webview)
		messages: {
			loginResult: { success: boolean; username?: string; error?: string };
		};
	};
};
