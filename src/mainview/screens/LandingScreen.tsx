import { useState } from "react";
import type { ServerConfig, JavaState, McStatus, ModLoaderProgress, ModsProgress, FilesProgress } from "../../shared/rpcSchema";

interface LandingScreenProps {
  auth: { status: "loggedIn"; username: string };
  version: string;
  servers: ServerConfig[];
  selectedServer: ServerConfig | null;
  javaStates: Record<number, JavaState>;
  mcStatus: McStatus;
  modLoaderStatus: ModLoaderProgress | null;
  modsStatus: ModsProgress | null;
  filesStatus: FilesProgress | null;
  onServerChange: (server: ServerConfig) => void;
  onPlay: () => void;
  onLogout: () => void;
  onSettings: () => void;
}

function getRequiredJavaVersion(mcVersion: string): number {
  const [, minor] = mcVersion.split(".").map(Number);
  if (minor >= 21) return 21;
  if (minor >= 17) return 17;
  return 8;
}

function getMcInstallText(progress: any): string {
  switch (progress.stage) {
    case "meta": return "버전 정보 로드 중...";
    case "client": return `게임 다운로드 중... ${progress.progress}%`;
    case "libraries": return `라이브러리 설치 중... ${progress.current}/${progress.total}`;
    case "assets": return `에셋 다운로드 중... ${progress.current}/${progress.total}`;
    case "done": return "설치 완료";
    default: return "설치 중...";
  }
}

function getModLoaderText(progress: ModLoaderProgress): string {
  switch (progress.stage) {
    case "checking": return "모드 로더 확인 중...";
    case "downloading_installer": return `모드 로더 다운로드 중... ${progress.progress}%`;
    case "installing": return "모드 로더 설치 중...";
    case "downloading_libraries": return `모드 로더 라이브러리 ${progress.current}/${progress.total}`;
    case "done": return "플레이";
    default: return "설치 중...";
  }
}

function getModsText(progress: ModsProgress): string {
  switch (progress.stage) {
    case "checking": return `모드 확인 중... ${progress.current}/${progress.total}`;
    case "downloading": return `모드 다운로드 중... ${progress.current}/${progress.total} (${progress.progress}%)`;
    case "done": return "플레이";
    default: return "설치 중...";
  }
}

function getFilesText(progress: FilesProgress): string {
  switch (progress.stage) {
    case "checking": return `파일 확인 중... ${progress.current}/${progress.total}`;
    case "downloading": return `파일 다운로드 중... ${progress.current}/${progress.total} (${progress.progress}%)`;
    case "extracting": return `압축 해제 중... ${progress.current}/${progress.total}`;
    case "done": return "플레이";
    default: return "설치 중...";
  }
}

export default function LandingScreen({
  auth,
  version,
  servers,
  selectedServer,
  javaStates,
  mcStatus,
  modLoaderStatus,
  modsStatus,
  filesStatus,
  onServerChange,
  onPlay,
  onLogout,
  onSettings,
}: LandingScreenProps) {
  const requiredJavaVersion = selectedServer ? getRequiredJavaVersion(selectedServer.mcVersion) : null;
  const javaState = requiredJavaVersion ? javaStates[requiredJavaVersion] : undefined;
  const javaReady = javaState?.status === "ready";
  const isBusy = mcStatus.status === "installing" || mcStatus.status === "launching" || mcStatus.status === "running" || modLoaderStatus !== null || modsStatus !== null || filesStatus !== null;
  const canPlay = javaReady && !isBusy;

  const getPlayButtonText = () => {
    if (mcStatus.status === "installing") return getMcInstallText(mcStatus.progress);
    if (mcStatus.status === "launching") return "실행 중...";
    if (mcStatus.status === "running") return "게임 실행됨";
    if (modLoaderStatus) return getModLoaderText(modLoaderStatus);
    if (modsStatus) return getModsText(modsStatus);
    if (filesStatus) return getFilesText(filesStatus);
    if (javaReady) return "플레이";
    if (javaState?.status === "downloading") return `Java ${requiredJavaVersion} 다운로드 중... ${(javaState as any).progress}%`;
    if (javaState?.status === "extracting") return `Java ${requiredJavaVersion} 압축 해제 중...`;
    return `Java ${requiredJavaVersion} 준비 중...`;
  };

  return (
    <div className="w-screen h-screen relative overflow-hidden flex flex-col">
      {/* 배경 그라디언트 + 데코레이션 */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#1a2847] via-[#2d1b4e] to-[#1a2847] opacity-90" />

      {/* 데코레이션 블록들 */}
      <div className="absolute top-0 left-0 w-96 h-96 opacity-20 pointer-events-none">
        <div className="absolute w-20 h-20 bg-cyan-400 rounded-lg transform rotate-45 top-10 left-10" />
        <div className="absolute w-32 h-32 bg-emerald-400 rounded-lg transform -rotate-12 top-40 left-40 opacity-30" />
        <div className="absolute w-16 h-16 bg-yellow-300 rounded-lg top-60 left-20" />
      </div>

      {/* 컨텐츠 레이어 */}
      <div className="relative flex flex-col h-full">
        {/* 헤더 */}
        <header className="shrink-0 px-8 py-4 flex items-center justify-between border-b border-white/10 backdrop-blur-sm bg-black/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-lg flex items-center justify-center font-bold text-sm text-white">
              M
            </div>
            <span className="font-bold text-xl tracking-wider text-white">MC Launcher</span>
          </div>
          <div className="flex items-center gap-6">
            {version && <span className="text-xs text-white/50">v{version}</span>}
            <button
              onClick={onSettings}
              className="text-white/60 hover:text-white transition-colors text-lg"
              title="설정"
            >
              ⚙️
            </button>
            <button
              onClick={onLogout}
              className="text-xs text-white/60 hover:text-white transition-colors px-3 py-1 rounded hover:bg-white/10"
            >
              로그아웃
            </button>
          </div>
        </header>

        {/* 메인 콘텐츠 */}
        <main className="flex-1 flex flex-col items-center justify-start gap-3 px-8 py-6 overflow-y-auto">
          {selectedServer ? (
            <>
              {/* 서버 정보 */}
              <div className="text-center">
                <h1 className="text-5xl font-bold text-white mb-2">{selectedServer.name}</h1>
                <p className="text-white/50 text-sm">
                  {selectedServer.modLoader.toUpperCase()} • {selectedServer.mcVersion}
                </p>
              </div>

              {/* 서버 상세 정보 카드 */}
              <div className="w-full max-w-md bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 space-y-4">
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
                  <span className={javaReady ? "text-green-400" : "text-yellow-400"}>
                    {requiredJavaVersion} {javaReady ? "✓" : "..."}
                  </span>
                </div>
                {selectedServer.mods && selectedServer.mods.length > 0 && (
                  <>
                    <hr className="border-white/10" />
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-white/50">모드</span>
                      <span className="text-white/80">{selectedServer.mods.length}개</span>
                    </div>
                  </>
                )}
              </div>

              {/* 플레이 버튼 */}
              <button
                onClick={onPlay}
                disabled={!canPlay}
                className={`w-full max-w-md py-4 rounded-xl font-bold text-lg transition-all shadow-xl ${
                  canPlay
                    ? "bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 active:scale-95 text-white"
                    : "bg-white/10 text-white/40 cursor-not-allowed"
                }`}
              >
                ▶ {getPlayButtonText()}
              </button>

              {mcStatus.status === "error" && (
                <p className="text-red-400 text-sm w-full max-w-md text-center">{(mcStatus as any).message}</p>
              )}
            </>
          ) : (
            <div className="text-center text-white/50">등록된 서버가 없습니다.</div>
          )}
        </main>

        {/* 푸터 - 서버 탭 */}
        <footer className="shrink-0 px-8 py-6 border-t border-white/10 backdrop-blur-sm bg-black/20 h-32">
          {servers.length > 1 ? (
            <div className="flex gap-3 justify-center">
              {servers.map(s => (
                <button
                  key={s.id}
                  onClick={() => onServerChange(s)}
                  className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
                    selectedServer?.id === s.id
                      ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg"
                      : "bg-white/10 text-white/60 hover:bg-white/20"
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center text-xs text-white/40">
              {selectedServer?.ip}:{selectedServer?.port || 25565}
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
