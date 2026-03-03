import { afterEach, describe, expect, it } from "bun:test";
import { renderFlowToStderr, type FlowSnapshot } from "../src/ui/flow-renderer";

const originalTmux = process.env.TMUX;

const snap: FlowSnapshot = {
    at: "2026-03-02T12:00:00.000Z",
    sessionID: "session-test",
    mode: "CTF",
    phase: "EXECUTE",
    target: "PWN",
    nextRoute: "aegis-exec",
    nextReason: "test route",
    oraclePassCount: 0,
    oracleTotalTests: 0,
    noNewEvidenceLoops: 0,
    groups: [],
};

function captureStderr(run: () => void): string {
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    let stderr = "";

    process.stderr.write = ((chunk: string | Uint8Array) => {
        stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
        return true;
    }) as typeof process.stderr.write;

    try {
        run();
        return stderr;
    } finally {
        process.stderr.write = originalStderrWrite;
    }
}

afterEach(() => {
    if (typeof originalTmux === "string") {
        process.env.TMUX = originalTmux;
        return;
    }

    delete process.env.TMUX;
});

describe("renderFlowToStderr", () => {
    it("writes nothing to stderr when TMUX is unset", () => {
        delete process.env.TMUX;

        const stderr = captureStderr(() => {
            renderFlowToStderr(snap);
        });

        expect(stderr).toBe("");
    });

    it("writes flow output to stderr when TMUX is set", () => {
        process.env.TMUX = "/tmp/tmux-1000/default,123,0";

        const stderr = captureStderr(() => {
            renderFlowToStderr(snap);
        });

        expect(
            stderr.includes("🎯 oh-my-Aegis") || stderr.includes("오케스트레이터")
        ).toBe(true);
    });
});
