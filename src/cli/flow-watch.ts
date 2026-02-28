/**
 * flow-watch.ts
 *
 * `oh-my-aegis flow --watch <flowJsonPath>` 서브커맨드.
 * tmux 패널 내부에서 실행되어 FLOW.json을 폴링하며 플로우차트를 갱신합니다.
 * `oh-my-aegis flow --once <flowJsonPath>` 는 현재 상태를 1회 출력합니다.
 */

import { readFileSync, statSync } from "node:fs";
import { buildFlowLines, type FlowSnapshot } from "../ui/flow-renderer";

const POLL_MS = 150;

/** ANSI 커서 초기화 + 화면 전체 재렌더 */
function renderScreen(snap: FlowSnapshot): void {
    const lines = buildFlowLines(snap);
    // 커서를 맨 위로 이동 후 화면 지우기
    process.stdout.write("\x1b[2J\x1b[H");
    process.stdout.write(lines.join("\n") + "\n");
}

function readSnapFromFile(path: string): FlowSnapshot | null {
    try {
        const raw = readFileSync(path, "utf-8");
        return JSON.parse(raw) as FlowSnapshot;
    } catch {
        return null;
    }
}

export async function runFlowWatch(args: string[]): Promise<number> {
    const watchFlag = args.includes("--watch");
    const onceFlag = args.includes("--once");
    const pathArg = args.find((a) => !a.startsWith("--"));

    if (!pathArg) {
        process.stderr.write("사용법: oh-my-aegis flow --watch <FLOW.json 경로>\n");
        return 1;
    }

    // --once: 현재 스냅샷 1회 출력
    if (onceFlag) {
        const snap = readSnapFromFile(pathArg);
        if (!snap) {
            process.stderr.write(`FLOW.json을 읽을 수 없습니다: ${pathArg}\n`);
            return 1;
        }
        process.stdout.write(buildFlowLines(snap).join("\n") + "\n");
        return 0;
    }

    // --watch: 폴링 루프
    if (!watchFlag) {
        process.stderr.write("--watch 또는 --once 플래그가 필요합니다.\n");
        return 1;
    }

    // 초기 화면 표시
    process.stdout.write("\x1b[2J\x1b[H");
    process.stdout.write(
        "\x1b[1m Aegis Flow\x1b[0m\x1b[2m  — 오케스트레이터 시작 대기 중...\x1b[0m\n"
    );

    let lastMtime = 0;

    process.on("SIGTERM", () => process.exit(0));
    process.on("SIGINT", () => process.exit(0));

    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            const stat = statSync(pathArg);
            const mtime = stat.mtimeMs;
            if (mtime !== lastMtime) {
                lastMtime = mtime;
                const snap = readSnapFromFile(pathArg);
                if (snap) {
                    renderScreen(snap);
                }
            }
        } catch {
            // FLOW.json이 아직 없으면 대기
        }
        await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS));
    }
}
