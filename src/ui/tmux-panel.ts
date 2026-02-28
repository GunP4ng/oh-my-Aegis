/**
 * tmux-panel.ts
 *
 * tmux 세션 내에서 Aegis Flow 패널을 생성하고 관리합니다.
 * tmux 외부 실행 시 조용히 스킵합니다.
 */

import { execSync, spawnSync } from "node:child_process";
import { join } from "node:path";

const PANEL_TITLE = "AegisFlow";

function isInsideTmux(): boolean {
    return typeof process.env.TMUX === "string" && process.env.TMUX.length > 0;
}

function isTmuxAvailable(): boolean {
    try {
        const result = spawnSync("tmux", ["-V"], { encoding: "utf-8" });
        return result.status === 0;
    } catch {
        return false;
    }
}

/** 현재 tmux 세션에 AegisFlow 패널이 이미 있으면 패널 ID 반환, 없으면 null */
function findExistingPanel(): string | null {
    try {
        const result = execSync(
            `tmux list-panes -a -F "#{pane_id}:#{pane_title}"`,
            { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
        );
        for (const line of result.trim().split("\n")) {
            const [paneId, title] = line.split(":");
            if (title === PANEL_TITLE && paneId) {
                return paneId;
            }
        }
        return null;
    } catch {
        return null;
    }
}

let panePid: string | null = null;

/**
 * tmux 세션 내에서 우측 분할 패널을 생성하고
 * `oh-my-aegis flow --watch <rootDir>` 를 실행합니다.
 */
export function spawnFlowPanel(rootDir: string): void {
    if (!isInsideTmux() || !isTmuxAvailable()) {
        return;
    }

    // 이미 패널이 있으면 재사용
    const existing = findExistingPanel();
    if (existing) {
        panePid = existing;
        return;
    }

    const flowJsonPath = join(rootDir, "FLOW.json");

    const cliBinCandidates: string[] = [];
    // 1. npm global install: resolve from 'oh-my-aegis' binary in PATH
    // 2. plugin context: walk from this file's dir upward to find dist/cli/index.js
    try {
        // since spawnFlowPanel is sync and this is CommonJS/ESM interop in bun,
        // we can use standard path/fs modules directly at top of file, but to keep
        // the impact small we can just replace the dist/index.js path.
        const currentBin = process.argv[1] || "";
        if (currentBin.endsWith("dist/index.js")) {
            cliBinCandidates.push(currentBin.replace("dist/index.js", "dist/cli/index.js"));
        } else if (currentBin.endsWith("dist/index-core.js")) {
            cliBinCandidates.push(currentBin.replace("dist/index-core.js", "dist/cli/index.js"));
        }
    } catch { /**/ }
    const selfBin = cliBinCandidates[0] ?? process.argv[1] ?? "oh-my-aegis";

    try {
        // 우측 30% 너비의 수직 분할 패널 생성
        const cmd = [
            "tmux", "split-window",
            "-h",           // 좌우 분할
            "-p", "35",     // 우측 35% 너비
            "-d",           // 포커스 이동 없음
            `${process.execPath} ${selfBin} flow --watch ${JSON.stringify(flowJsonPath)}`,
        ];


        execSync(cmd.join(" "), { stdio: "pipe" });

        // 패널 타이틀 설정
        const newPane = findExistingPanel() ?? "";
        if (newPane) {
            panePid = newPane;
            execSync(
                `tmux select-pane -t ${newPane} -T "${PANEL_TITLE}"`,
                { stdio: "pipe" }
            );
        }
    } catch {
        // tmux 명령 실패 시 무시 (기능 영향 없음)
    }
}

/** 플러그인 종료 시 Flow 패널 닫기 */
export function closeFlowPanel(): void {
    if (!panePid) return;
    try {
        execSync(`tmux kill-pane -t ${panePid}`, { stdio: "pipe" });
    } catch {
        // 이미 닫혀있으면 무시
    }
    panePid = null;
}
