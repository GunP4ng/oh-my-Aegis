import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { OrchestratorConfig } from "../config/schema";
import { triageFile } from "../orchestration/auto-triage";
import { scanForFlags, getCandidates, buildFlagAlert, setCustomFlagPattern } from "../orchestration/flag-detector";
import { matchPatterns, buildPatternSummary } from "../orchestration/pattern-matcher";
import { recommendedTools, checksecCommand, parseChecksecOutput } from "../orchestration/tool-integration";
import { planReconPipeline } from "../orchestration/recon-pipeline";
import { saveScanSnapshot, buildDeltaSummary, shouldRescan, getLatestSnapshot, computeDelta, type ScanSnapshot } from "../orchestration/delta-scan";
import { localLookup, buildLibcSummary, computeLibcBase, buildLibcRipUrl, type LibcLookupRequest } from "../orchestration/libc-database";
import { buildParityReport, buildParitySummary, parseDockerfile, parseLddOutput, localEnvCommands, type EnvInfo } from "../orchestration/env-parity";
import { runParityRunner } from "../orchestration/parity-runner";
import { runContradictionRunner } from "../orchestration/contradiction-runner";
import { appendEvidenceLedger, scoreEvidence, type EvidenceEntry } from "../orchestration/evidence-ledger";
import { generateReport, formatReportMarkdown } from "../orchestration/report-generator";
import { planExploreDispatch, planLibrarianDispatch, detectSubagentType } from "../orchestration/subagent-dispatch";
import { getExploitTemplate, listExploitTemplates } from "../orchestration/exploit-templates";
import { detectRevLoaderVm, shouldForceRelocPatchDump } from "../orchestration/auto-triage";
import { checkForDecoy, isReplayUnsafe, getCandidates as getDetectorCandidates } from "../orchestration/flag-detector";
import {
  parseRelaEntries,
  generateRelaPatchScript,
  generateSyscallTrampoline,
  generateEntryPatchScript,
  base255Encode,
  base255Decode,
  modInverse,
  recoverLinear,
  generateLinearRecoveryScript,
} from "../orchestration/rev-toolkit";
import { HypothesisRegistry } from "../orchestration/hypothesis-registry";
import type { NotesStore } from "../state/notes-store";
import type { SessionStore } from "../state/session-store";
import { randomUUID } from "node:crypto";

const schema = tool.schema;

export function createAnalysisTools(
  store: SessionStore,
  notesStore: NotesStore,
  config: OrchestratorConfig,
): Record<string, ToolDefinition> {
  return {
    ctf_orch_exploit_template_list: tool({
      description: "List built-in exploit templates by domain",
      args: {
        domain: schema.enum(["PWN", "CRYPTO", "WEB", "WEB3", "REV", "FORENSICS", "MISC"]).optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const domain = args.domain as
          | "PWN"
          | "CRYPTO"
          | "WEB"
          | "WEB3"
          | "REV"
          | "FORENSICS"
          | "MISC"
          | undefined;
        const templates = listExploitTemplates(domain);
        return JSON.stringify({ sessionID, domain: domain ?? "ALL", templates }, null, 2);
      },
    }),

    ctf_orch_exploit_template_get: tool({
      description: "Get a built-in exploit template by id",
      args: {
        domain: schema.enum(["PWN", "CRYPTO", "WEB", "WEB3", "REV", "FORENSICS", "MISC"]),
        id: schema.string().min(1),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const entry = getExploitTemplate(
          args.domain as "PWN" | "CRYPTO" | "WEB" | "WEB3" | "REV" | "FORENSICS" | "MISC",
          args.id,
        );
        if (!entry) {
          return JSON.stringify({ ok: false, reason: "template not found", sessionID, domain: args.domain, id: args.id }, null, 2);
        }
        return JSON.stringify({ ok: true, sessionID, template: entry }, null, 2);
      },
    }),

    ctf_auto_triage: tool({
      description: "Auto-triage a challenge file: detect type, suggest target, generate scan commands",
      args: {
        file_path: schema.string().min(1),
        file_output: schema.string().optional(),
      },
      execute: async (args) => {
        const result = triageFile(args.file_path, args.file_output);
        return JSON.stringify(result, null, 2);
      },
    }),

    ctf_flag_scan: tool({
      description: "Scan text for flag patterns and return candidates",
      args: {
        text: schema.string().min(1),
        source: schema.string().default("manual"),
        custom_pattern: schema.string().optional(),
      },
      execute: async (args) => {
        if (args.custom_pattern) {
          setCustomFlagPattern(args.custom_pattern);
        }
        const found = scanForFlags(args.text, args.source);
        return JSON.stringify({
          found,
          alert: found.length > 0 ? buildFlagAlert(found) : null,
          allCandidates: getCandidates(),
        }, null, 2);
      },
    }),

    ctf_pattern_match: tool({
      description: "Match known CTF/security patterns in text",
      args: {
        text: schema.string().min(1),
        target_type: schema.enum(["WEB_API", "WEB3", "PWN", "REV", "CRYPTO", "FORENSICS", "MISC", "UNKNOWN"]).optional(),
      },
      execute: async (args) => {
        const targetType = args.target_type as import("../state/types").TargetType | undefined;
        const matches = matchPatterns(args.text, targetType);
        return JSON.stringify({
          matches,
          summary: matches.length > 0 ? buildPatternSummary(matches) : "No patterns matched.",
        }, null, 2);
      },
    }),

    ctf_recon_pipeline: tool({
      description: "Plan a multi-phase BOUNTY recon pipeline for a target",
      args: {
        target: schema.string().min(1),
        scope: schema.array(schema.string()).optional(),
        templates: schema.string().optional(),
      },
      execute: async (args, context) => {
        const state = store.get(context.sessionID);
        const pipeline = planReconPipeline(state, config, args.target, { scope: args.scope });
        return JSON.stringify({ pipeline, templates: args.templates ?? null }, null, 2);
      },
    }),

    ctf_delta_scan: tool({
      description: "Save/query/compare scan snapshots for delta-aware scanning",
      args: {
        action: schema.enum(["save", "query", "should_rescan"]),
        target: schema.string().min(1),
        template_set: schema.string().default("default"),
        findings: schema.array(schema.string()).optional(),
        hosts: schema.array(schema.string()).optional(),
        ports: schema.array(schema.number()).optional(),
        max_age_ms: schema.number().optional(),
      },
      execute: async (args) => {
        if (args.action === "save") {
          const snapshot: ScanSnapshot = {
            id: randomUUID(),
            target: args.target,
            templateSet: args.template_set,
            timestamp: Date.now(),
            assets: [
              ...(args.hosts ?? []),
              ...((args.ports ?? []).map((p) => `port:${String(p)}`)),
            ],
            findings: args.findings ?? [],
          };
          saveScanSnapshot(snapshot);
          return JSON.stringify({ ok: true, saved: snapshot }, null, 2);
        }
        if (args.action === "query") {
          const current: ScanSnapshot = {
            id: randomUUID(),
            target: args.target,
            templateSet: args.template_set,
            timestamp: Date.now(),
            assets: [
              ...(args.hosts ?? []),
              ...((args.ports ?? []).map((p) => `port:${String(p)}`)),
            ],
            findings: args.findings ?? [],
          };
          const latest = getLatestSnapshot(args.target);
          const delta = latest ? computeDelta(latest, current) : null;
          const summary = buildDeltaSummary(args.target, {
            ...current,
          });
          return JSON.stringify({ ok: true, summary, latest, delta }, null, 2);
        }
        if (args.action === "should_rescan") {
          const rescan = shouldRescan(args.target, args.template_set, args.max_age_ms);
          return JSON.stringify({ ok: true, shouldRescan: rescan }, null, 2);
        }
        return JSON.stringify({ ok: false, reason: "unknown action" }, null, 2);
      },
    }),

    ctf_tool_recommend: tool({
      description: "Get recommended security tools for a target type",
      args: {
        target_type: schema.enum(["WEB_API", "WEB3", "PWN", "REV", "CRYPTO", "FORENSICS", "MISC", "UNKNOWN"]),
      },
      execute: async (args) => {
        const tools = recommendedTools(args.target_type as import("../state/types").TargetType);
        return JSON.stringify({ tools }, null, 2);
      },
    }),

    ctf_libc_lookup: tool({
      description: "Lookup libc versions from leaked function addresses",
      args: {
        lookups: schema.array(schema.object({
          symbol: schema.string().min(1),
          address: schema.string().min(1),
        })),
        compute_base_leaked_address: schema.string().optional(),
        compute_base_symbol_offset: schema.number().optional(),
      },
      execute: async (args) => {
        const requests: LibcLookupRequest[] = args.lookups.map(l => ({
          symbolName: l.symbol,
          address: l.address,
        }));
        const result = localLookup(requests);
        const summary = buildLibcSummary(result);
        const libcRipUrl = buildLibcRipUrl(requests);
        let base: string | null = null;
        if (args.compute_base_leaked_address && typeof args.compute_base_symbol_offset === "number") {
          base = computeLibcBase(args.compute_base_leaked_address, args.compute_base_symbol_offset);
        }
        return JSON.stringify({ result, summary, libcRipUrl, computedBase: base }, null, 2);
      },
    }),

    ctf_env_parity: tool({
      description: "Check environment parity between local and remote for PWN challenges",
      args: {
        dockerfile_content: schema.string().optional(),
        ldd_output: schema.string().optional(),
        binary_path: schema.string().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const hasRemote = typeof args.dockerfile_content === "string" && args.dockerfile_content.trim().length > 0;
        const hasLocal = typeof args.ldd_output === "string" && args.ldd_output.trim().length > 0;
        if (!hasRemote || !hasLocal) {
          store.setEnvParity(sessionID, false, "Parity baseline requires both remote (dockerfile) and local (ldd) evidence.");
          return JSON.stringify(
            {
              ok: false,
              sessionID,
              reason: "ctf_env_parity requires both dockerfile_content and ldd_output for enforceable parity baseline",
            },
            null,
            2,
          );
        }
        const remote: Partial<EnvInfo> = {};
        if (args.dockerfile_content) {
          Object.assign(remote, parseDockerfile(args.dockerfile_content));
        }
        const local: Partial<EnvInfo> = {};
        if (args.ldd_output) {
          const parsed = parseLddOutput(args.ldd_output);
          if (parsed) {
            local.libcVersion = parsed.version;
            local.libcPath = parsed.libcPath;
          }
        }
        const report = buildParityReport(local, remote);
        const summary = buildParitySummary(report);
        const localCommands = localEnvCommands();
        store.setEnvParity(sessionID, report.allMatch, summary);
        return JSON.stringify({ report, summary, localCommands }, null, 2);
      },
    }),

    ctf_parity_runner: tool({
      description: "Run local/docker/remote parity comparison on concrete outputs",
      args: {
        local_output: schema.string().optional(),
        docker_output: schema.string().optional(),
        remote_output: schema.string().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const result = runParityRunner({
          localOutput: args.local_output,
          dockerOutput: args.docker_output,
          remoteOutput: args.remote_output,
        });
        if (result.checkedPairs > 0) {
          store.setEnvParity(sessionID, result.ok, result.summary);
        }
        return JSON.stringify({ sessionID, ...result }, null, 2);
      },
    }),

    ctf_contradiction_runner: tool({
      description: "Compare expected hypothesis outcomes vs observed runtime output",
      args: {
        hypothesis: schema.string().default(""),
        expected: schema.array(schema.string()).default([]),
        observed_output: schema.string().default(""),
        expected_exit_code: schema.number().int().optional(),
        observed_exit_code: schema.number().int().optional(),
        apply_event: schema.boolean().default(true),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const result = runContradictionRunner({
          hypothesis: args.hypothesis,
          expected: args.expected,
          observedOutput: args.observed_output,
          expectedExitCode: args.expected_exit_code,
          observedExitCode: args.observed_exit_code,
        });
        if (result.contradictory && args.apply_event) {
          store.recordFailure(sessionID, "static_dynamic_contradiction", "ctf_contradiction_runner", result.summary);
          store.applyEvent(sessionID, "static_dynamic_contradiction");
        }
        return JSON.stringify({ sessionID, result }, null, 2);
      },
    }),

    ctf_evidence_ledger: tool({
      description: "Append/scoring evidence ledger entries with L0-L3 output",
      args: {
        event: schema.string().default("manual"),
        evidence_type: schema.enum([
          "string_pattern",
          "static_reverse",
          "dynamic_memory",
          "behavioral_runtime",
          "acceptance_oracle",
        ]),
        confidence: schema.number().min(0).max(1).default(0.8),
        summary: schema.string().default(""),
        source: schema.string().default("manual"),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const entry: EvidenceEntry = {
          at: new Date().toISOString(),
          sessionID,
          event: args.event,
          evidenceType: args.evidence_type,
          confidence: args.confidence,
          summary: args.summary.replace(/\s+/g, " ").trim().slice(0, 240),
          source: args.source,
        };
        const persisted = appendEvidenceLedger(notesStore.getRootDirectory(), entry);
        const scored = scoreEvidence([entry]);
        store.setCandidateLevel(sessionID, scored.level);
        return JSON.stringify({ ok: persisted.ok, sessionID, entry, scored, ...(persisted.ok ? {} : persisted) }, null, 2);
      },
    }),

    ctf_report_generate: tool({
      description: "Generate a CTF writeup or BOUNTY report from session notes",
      args: {
        mode: schema.enum(["CTF", "BOUNTY"]),
        challenge_name: schema.string().default("Challenge"),
        worklog: schema.string().default(""),
        evidence: schema.string().default(""),
        target_type: schema.string().optional(),
        flag: schema.string().optional(),
      },
      execute: async (args) => {
        const reportOptions: Record<string, string> = {
          challengeName: args.challenge_name,
          programName: args.challenge_name,
        };
        if (args.target_type) {
          reportOptions.category = args.target_type;
          reportOptions.endpoint = args.target_type;
        }
        if (args.flag) {
          reportOptions.flag = args.flag;
        }
        const report = generateReport(
          args.mode as "CTF" | "BOUNTY",
          args.worklog,
          args.evidence,
          reportOptions,
        );
        const markdown = formatReportMarkdown(report);
        return JSON.stringify({ report, markdown }, null, 2);
      },
    }),

    ctf_subagent_dispatch: tool({
      description: "Plan a dispatch for aegis-explore or aegis-librarian subagent",
      args: {
        query: schema.string().min(1),
        type: schema.enum(["explore", "librarian", "auto"]).default("auto"),
      },
      execute: async (args, context) => {
        const state = store.get(context.sessionID);
        const agentType = args.type === "auto" ? detectSubagentType(args.query) : args.type;
        const plan = agentType === "explore"
          ? planExploreDispatch(state, args.query)
          : planLibrarianDispatch(state, args.query);
        return JSON.stringify({ agentType, plan }, null, 2);
      },
    }),

    ctf_rev_loader_vm_detect: tool({
      description: "Detect REV Loader/VM patterns from readelf/strings output. Returns whether reloc patch-and-dump should be prioritized over static decryption.",
      args: {
        readelf_sections: schema.string().optional(),
        readelf_relocs: schema.string().optional(),
        strings_output: schema.string().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const indicator = detectRevLoaderVm(args.readelf_sections, args.readelf_relocs, args.strings_output);
        const forceRelocDump = shouldForceRelocPatchDump(indicator);

        if (forceRelocDump) {
          store.update(sessionID, {
            revLoaderVmDetected: true,
            revVmSuspected: true,
            revStaticTrust: 0,
          });
        }

        return JSON.stringify({
          sessionID,
          indicator,
          forceRelocPatchDump: forceRelocDump,
          recommendation: forceRelocDump
            ? "CRITICAL: Relocation-based VM detected. DO NOT use static decryption. Use reloc patch-and-dump to neutralize runtime clearing, then extract internal buffers via syscall trampoline."
            : "No strong relocation-VM indicators. Static analysis may be viable, but verify with dynamic runs.",
        }, null, 2);
      },
    }),

    ctf_decoy_guard: tool({
      description: "Evaluate flag candidates for decoy status. Auto-triggers DECOY_SUSPECT when flag-like strings are found but oracle fails.",
      args: {
        oracle_passed: schema.boolean(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const candidates = getDetectorCandidates();
        const result = checkForDecoy(candidates, args.oracle_passed);

        if (result.isDecoySuspect) {
          store.update(sessionID, {
            decoySuspect: true,
            decoySuspectReason: result.reason,
          });
        }

        return JSON.stringify({
          sessionID,
          ...result,
          action: result.isDecoySuspect
            ? "DECOY_SUSPECT set. Router will force runtime state extraction mode. Do NOT continue static reversal path."
            : "No decoy detected. Proceed normally.",
        }, null, 2);
      },
    }),

    ctf_replay_safety_check: tool({
      description: "Check if a binary uses memfd/relocation tricks that make standalone re-execution unreliable. Auto-tags results as low-trust.",
      args: {
        strings_output: schema.string().optional(),
        readelf_output: schema.string().optional(),
        binary_name: schema.string().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const result = isReplayUnsafe(args.strings_output, args.readelf_output);

        if (result.unsafe) {
          const state = store.get(sessionID);
          const currentList = state.replayLowTrustBinaries || [];
          const binaryName = args.binary_name || "unknown";
          if (!currentList.includes(binaryName)) {
            store.update(sessionID, {
              replayLowTrustBinaries: [...currentList, binaryName],
              revStaticTrust: Math.max(0, state.revStaticTrust - 0.3),
            });
          }
        }

        return JSON.stringify({
          sessionID,
          ...result,
          warning: result.unsafe
            ? "WARNING: This binary uses memfd/relocation patterns. Standalone re-execution results should be treated as LOW CONFIDENCE. Run inside original loader/main for accurate results."
            : "Binary appears safe for standalone re-execution.",
        }, null, 2);
      },
    }),

    ctf_rev_rela_patch: tool({
      description: "Generate a Python script to patch RELA entries in an ELF binary to neutralize relocation-based clearing.",
      args: {
        binary_path: schema.string().min(1),
        section_offset: schema.number(),
        entry_index: schema.number(),
        dummy_address: schema.number().optional(),
      },
      execute: async (args) => {
        const script = generateRelaPatchScript(
          args.binary_path,
          args.section_offset,
          args.entry_index,
          args.dummy_address,
        );
        return JSON.stringify({ script, usage: `python3 patch_rela.py` }, null, 2);
      },
    }),

    ctf_rev_syscall_trampoline: tool({
      description: "Generate x86_64 syscall trampoline assembly for extracting runtime buffers from patched binaries.",
      args: {
        write_addr1: schema.number(),
        write_len1: schema.number(),
        write_addr2: schema.number(),
        write_len2: schema.number(),
      },
      execute: async (args) => {
        const asm = generateSyscallTrampoline({
          writeAddr1: args.write_addr1,
          writeLen1: args.write_len1,
          writeAddr2: args.write_addr2,
          writeLen2: args.write_len2,
        });
        return JSON.stringify({ assembly: asm }, null, 2);
      },
    }),

    ctf_rev_entry_patch: tool({
      description: "Generate a pwntools-based Python script to overwrite an ELF entry point with a syscall trampoline for buffer extraction.",
      args: {
        binary_path: schema.string().min(1),
        entry_vaddr: schema.number(),
        write_addr1: schema.number(),
        write_len1: schema.number(),
        write_addr2: schema.number(),
        write_len2: schema.number(),
      },
      execute: async (args) => {
        const script = generateEntryPatchScript(
          args.binary_path,
          args.entry_vaddr,
          {
            writeAddr1: args.write_addr1,
            writeLen1: args.write_len1,
            writeAddr2: args.write_addr2,
            writeLen2: args.write_len2,
          },
        );
        return JSON.stringify({ script }, null, 2);
      },
    }),

    ctf_rev_base255_codec: tool({
      description: "Encode/decode data using base255 big-endian scheme (no null bytes).",
      args: {
        mode: schema.enum(["encode", "decode"]),
        data_hex: schema.string().min(1),
        chunk_size: schema.number().default(7),
      },
      execute: async (args) => {
        const input = new Uint8Array(
          (args.data_hex.match(/.{1,2}/g) || []).map((b) => parseInt(b, 16)),
        );
        const result = args.mode === "encode"
          ? base255Encode(input, args.chunk_size)
          : base255Decode(input, args.chunk_size);
        const resultHex = Array.from(result).map((b) => b.toString(16).padStart(2, "0")).join("");
        return JSON.stringify({
          mode: args.mode,
          inputLength: input.length,
          outputLength: result.length,
          resultHex,
        }, null, 2);
      },
    }),

    ctf_rev_linear_recovery: tool({
      description: "Generate a Python script for linear-equation recovery from dumped (out, expected) buffer pairs.",
      args: {
        dump_dir: schema.string().min(1),
        bin_count: schema.number(),
        multiplier: schema.number(),
        modulus: schema.number().default(256),
        chunk_size: schema.number().default(7),
      },
      execute: async (args) => {
        const script = generateLinearRecoveryScript(
          args.dump_dir,
          args.bin_count,
          args.multiplier,
          args.modulus,
          args.chunk_size,
        );
        return JSON.stringify({ script }, null, 2);
      },
    }),

    ctf_rev_mod_inverse: tool({
      description: "Compute modular multiplicative inverse.",
      args: {
        value: schema.number(),
        modulus: schema.number(),
      },
      execute: async (args) => {
        const inv = modInverse(args.value, args.modulus);
        return JSON.stringify({
          value: args.value,
          modulus: args.modulus,
          inverse: inv,
          verification: `${args.value} * ${inv} mod ${args.modulus} = ${(args.value * inv) % args.modulus}`,
        }, null, 2);
      },
    }),

    ctf_hypothesis_register: tool({
      description: "Register a new hypothesis for structured tracking and experiment management.",
      args: {
        hypothesis: schema.string().min(1),
        tags: schema.string().optional(),
      },
      execute: async (args, context) => {
        const rootDir = `${config.notes.root_dir}/memory`;
        const registry = new HypothesisRegistry(rootDir);
        const tags = args.tags ? args.tags.split(",").map((t) => t.trim()) : [];
        const record = registry.createHypothesis(args.hypothesis, tags);
        return JSON.stringify({ created: record, activeCount: registry.getActive().length }, null, 2);
      },
    }),

    ctf_hypothesis_experiment: tool({
      description: "Record an experiment result against a registered hypothesis. Prevents duplicate experiments.",
      args: {
        hypothesis_id: schema.string().min(1),
        description: schema.string().min(1),
        method: schema.string().min(1),
        artifact_paths: schema.string().optional(),
        verdict: schema.enum(["supports", "refutes", "inconclusive"]),
        evidence: schema.string().min(1),
      },
      execute: async (args) => {
        const rootDir = `${config.notes.root_dir}/memory`;
        const registry = new HypothesisRegistry(rootDir);
        const artifacts = args.artifact_paths ? args.artifact_paths.split(",").map((p) => p.trim()) : [];
        const exp = registry.addExperiment(
          args.hypothesis_id,
          args.description,
          args.method,
          artifacts,
          args.verdict,
          args.evidence,
        );
        if (!exp) return JSON.stringify({ error: `Hypothesis ${args.hypothesis_id} not found` });
        const record = registry.get(args.hypothesis_id);
        return JSON.stringify({ experiment: exp, hypothesis: record }, null, 2);
      },
    }),

    ctf_hypothesis_summary: tool({
      description: "Get a structured summary of all registered hypotheses and their experiments.",
      args: {},
      execute: async () => {
        const rootDir = `${config.notes.root_dir}/memory`;
        const registry = new HypothesisRegistry(rootDir);
        const summary = registry.summarize();
        const active = registry.getActive();
        return JSON.stringify({
          summary,
          totalHypotheses: registry.getAll().length,
          activeHypotheses: active.length,
          active: active.map((h) => ({
            id: h.id,
            hypothesis: h.hypothesis,
            experimentCount: h.experiments.length,
          })),
        }, null, 2);
      },
    }),

    ctf_unsat_gate_status: tool({
      description: "Check UNSAT claim gate status. Returns which conditions are met/missing for making an UNSAT claim.",
      args: {
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const state = store.get(sessionID);
        const conditions = {
          crossValidation: { met: state.unsatCrossValidationCount >= 2, count: state.unsatCrossValidationCount, required: 2 },
          unhookedOracle: { met: state.unsatUnhookedOracleRun },
          artifactDigest: { met: state.unsatArtifactDigestVerified },
          alternativeHypotheses: { met: state.alternatives.filter((a) => a.trim()).length >= 2, count: state.alternatives.filter((a) => a.trim()).length, required: 2 },
        };
        const allMet = Object.values(conditions).every((c) => c.met);
        return JSON.stringify({
          sessionID,
          gatePassed: allMet,
          conditions,
          action: allMet
            ? "All UNSAT gate conditions met. UNSAT claim is permitted."
            : "UNSAT gate BLOCKED. Satisfy all conditions before making an UNSAT claim.",
        }, null, 2);
      },
    }),

    ctf_unsat_record_validation: tool({
      description: "Record one of the 3 required UNSAT validation conditions: cross-validation, unhooked-oracle, or artifact-digest.",
      args: {
        condition: schema.enum(["cross_validation", "unhooked_oracle", "artifact_digest"]),
        evidence: schema.string().min(1),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const state = store.get(sessionID);
        const updates: Record<string, unknown> = {};

        if (args.condition === "cross_validation") {
          updates.unsatCrossValidationCount = state.unsatCrossValidationCount + 1;
        } else if (args.condition === "unhooked_oracle") {
          updates.unsatUnhookedOracleRun = true;
        } else if (args.condition === "artifact_digest") {
          updates.unsatArtifactDigestVerified = true;
        }

        store.update(sessionID, updates as Partial<typeof state>);
        notesStore.recordScan(`UNSAT validation [${args.condition}]: ${args.evidence}`);
        return JSON.stringify({
          sessionID,
          condition: args.condition,
          recorded: true,
          evidence: args.evidence,
        }, null, 2);
      },
    }),

    ctf_oracle_progress: tool({
      description: "Record oracle test progress (pass count, fail index, total tests). Used for Oracle-first scoring.",
      args: {
        pass_count: schema.number(),
        fail_index: schema.number(),
        total_tests: schema.number(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const state = store.get(sessionID);
        const previous = {
          passCount: state.oraclePassCount,
          failIndex: state.oracleFailIndex,
          totalTests: state.oracleTotalTests,
        };

        store.update(sessionID, {
          oraclePassCount: args.pass_count,
          oracleFailIndex: args.fail_index,
          oracleTotalTests: args.total_tests,
        });

        const { computeOracleProgress } = await import("../orchestration/evidence-ledger");
        const progress = computeOracleProgress(
          { passCount: args.pass_count, failIndex: args.fail_index, totalTests: args.total_tests },
          previous.totalTests > 0 ? previous : undefined,
        );

        return JSON.stringify({
          sessionID,
          progress,
          action: progress.improved
            ? `Oracle progress IMPROVED: ${(progress.passRate * 100).toFixed(1)}% pass rate. Keep this approach.`
            : `Oracle progress NOT improved: ${(progress.passRate * 100).toFixed(1)}% pass rate. Consider pivoting.`,
        }, null, 2);
      },
    }),
  };
}
