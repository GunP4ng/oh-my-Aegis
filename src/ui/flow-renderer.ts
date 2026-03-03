/**
 * flow-renderer.ts
 *
 * ANSI 트리 형태로 서브에이전트 워크플로우를 렌더링합니다.
 * - renderFlowToStderr(): 즉시 stderr에 ANSI 트리 출력
 * - writeFlowJson():      .Aegis/FLOW.json에 스냅샷 저장 (tmux 패널용)
 * - buildFlowLines():     ANSI 라인 배열 반환 (watch 루프에서 재사용)
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { FlowGroupSnapshot } from "../orchestration/parallel";

// ── 타입 ──

export interface FlowSnapshot {
    at: string;
    sessionID: string;
    mode: string;
    phase: string;
    target: string;
    nextRoute: string;
    nextReason: string;
    oraclePassCount: number;
    oracleTotalTests: number;
    noNewEvidenceLoops: number;
    groups: FlowGroupSnapshot[];
}

// ── ANSI 색상 헬퍼 ──

const C = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
    blue: "\x1b[34m",
    white: "\x1b[97m",
} as const;

function c(color: keyof typeof C, text: string): string {
    return `${C[color]}${text}${C.reset}`;
}

// ── 포맷 헬퍼 ──

function fmtDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}초`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem > 0 ? `${m}분 ${rem}초` : `${m}분`;
}

function fmtTime(iso: string): string {
    return iso.slice(11, 19); // HH:MM:SS
}

function statusIcon(status: string, isWinner: boolean): string {
    if (isWinner) return c("yellow", "⭐");
    switch (status) {
        case "running": return c("cyan", "⟳ ");
        case "completed": return c("green", "✅");
        case "failed": return c("red", "✗ ");
        case "aborted": return c("dim", "⊘ ");
        default: return c("dim", "◯ ");
    }
}

function statusLabel(status: string, isWinner: boolean): string {
    if (isWinner) return c("yellow", "승자");
    switch (status) {
        case "running": return c("cyan", "실행중");
        case "completed": return c("green", "완료");
        case "failed": return c("red", "실패");
        case "aborted": return c("dim", "중단");
        default: return c("dim", "대기");
    }
}

// ── 메인 렌더러 ──

export function buildFlowLines(snap: FlowSnapshot): string[] {
    const lines: string[] = [];

    // ── 헤더 ──
    const ts = fmtTime(snap.at);
    const modeStr = `${snap.mode} · ${snap.phase} · ${snap.target}`;
    const header = ` ${c("bold", "🎯 oh-my-Aegis")}  ${c("dim", modeStr)}  ${c("dim", ts)} `;
    const border = "─".repeat(60);

    lines.push(c("dim", `┌${border}┐`));
    lines.push(`│${header}${c("dim", "│")}`);
    lines.push(c("dim", `└${border}┘`));
    lines.push("");

    // ── 오케스트레이터 라우팅 ──
    lines.push(c("bold", " 오케스트레이터"));
    lines.push(
        ` └─► ${c("cyan", snap.nextRoute)}` +
        c("dim", `  (${snap.nextReason.slice(0, 60)})`)
    );
    lines.push("");

    // ── 병렬 그룹 ──
    for (const group of snap.groups) {
        const progress = `${group.completedCount}/${group.totalCount} 완료`;
        lines.push(
            ` ${c("bold", `[병렬 그룹: ${group.label}]`)}  ${c("dim", progress)}`
        );

        const tracks = group.tracks;
        for (let i = 0; i < tracks.length; i++) {
            const t = tracks[i];
            const isLast = i === tracks.length - 1;
            const prefix = isLast ? " └─" : " ├─";
            const icon = statusIcon(t.status, t.isWinner);
            const dur = fmtDuration(t.durationMs);
            const statusStr = statusLabel(t.status, t.isWinner);

            // 첫 번째 줄: 아이콘 + 에이전트명 + purpose + 상태 + 시간
            const mainLine =
                `${prefix} ${icon} ${c("white", t.agent.padEnd(14))}` +
                `${c("dim", t.purpose.slice(0, 30).padEnd(32))}` +
                `${statusStr}  ${c("dim", dur)}`;
            lines.push(mainLine);

            // 두 번째 줄: 현재 작업 설명 (lastActivity)
            if (t.lastActivity) {
                const indent = isLast ? "    " : " │  ";
                lines.push(
                    `${indent}   ${c("dim", "↳")} ${t.lastActivity.slice(0, 70)}`
                );
            }
        }
        lines.push("");
    }

    // ── 통계 ──
    const oracleStr =
        snap.oracleTotalTests > 0
            ? `oracle: ${snap.oraclePassCount}/${snap.oracleTotalTests}`
            : "oracle: -";
    const stallStr = `stall: ${snap.noNewEvidenceLoops}`;
    lines.push(c("dim", ` ${oracleStr}  │  ${stallStr}`));
    lines.push("");

    return lines;
}

/** stderr에 ANSI 플로우 트리를 즉시 출력 */
export function renderFlowToStderr(snap: FlowSnapshot): void {
    if (typeof process.env.TMUX !== "string" || process.env.TMUX.trim() === "") {
        return;
    }
    const output = "\n" + buildFlowLines(snap).join("\n") + "\n";
    process.stderr.write(output);
}

/** .Aegis/FLOW.json 갱신 (tmux watch 패널용) */
export function writeFlowJson(rootDir: string, snap: FlowSnapshot): void {
    try {
        const path = join(rootDir, "FLOW.json");
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(snap, null, 2), "utf-8");
    } catch {
        // 파일 쓰기 실패 시 무시 (기능 저하 없음)
    }
}
