import type { ElectrobunRPCSchema } from "electrobun/bun";
import type { ServerConfig } from "../bun/servers";
import type { McInstallProgress } from "../bun/minecraft";
import type { ModLoaderProgress } from "../bun/modloader";
import type { ModsProgress } from "../bun/mods";
import type { FilesProgress } from "../bun/files";

export type { ServerConfig, McInstallProgress, ModLoaderProgress, ModsProgress, FilesProgress };

export type McStatus =
  | { status: "idle" }
  | { status: "installing"; progress: McInstallProgress }
  | { status: "launching" }
  | { status: "running" }
  | { status: "error"; message: string };

export type JavaState =
  | { status: "checking" }
  | { status: "ready"; path: string; version: number }
  | { status: "downloading"; version: number; progress: number }
  | { status: "extracting"; version: number }
  | { status: "error"; message: string };

export type LauncherRPCSchema = ElectrobunRPCSchema & {
	bun: {
		requests: {
			getAppVersion: { params: void; response: { version: string; hash: string; channel: string } };
			getAuthStatus: { params: void; response: { loggedIn: boolean; username: string | null } };
			logout: { params: void; response: { loggedIn: boolean; username: string | null } };
			getServers: { params: void; response: { servers: ServerConfig[] } };
		};
		// bun이 수신하는 메시지 (webview → bun)
		messages: {
			startLogin: Record<string, never>;
			launch: { serverId: string };
		};
	};
	webview: {
		requests: Record<string, never>;
		// webview가 수신하는 메시지 (bun → webview)
		messages: {
			loginResult: { success: boolean; username?: string; error?: string };
			javaStatus: JavaState;
			mcStatus: McStatus;
			modLoaderStatus: ModLoaderProgress;
				modsStatus: ModsProgress;
				filesStatus: FilesProgress;
		};
	};
};
