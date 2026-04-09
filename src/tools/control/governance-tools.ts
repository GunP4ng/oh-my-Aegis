import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import type { OrchestratorConfig } from "../../config/schema";
import type { SessionStore } from "../../state/session-store";
import { stableToolResponse } from "../parallel-tools";
import {
  SHA256_HEX,
  hasPatchArtifactRefChain,
  digestFromPatchDiffRef as digestFromPatchDiffRefShared,
  evaluateApplyGovernancePrerequisites as evaluateApplyGovernancePrerequisitesShared,
} from "../../orchestration/apply-governance-helpers";
import { providerFamilyFromModel } from "../../orchestration/model-health";
import { bindIndependentReviewDecision, evaluateIndependentReviewGate } from "../../orchestration/review-gate";
import { evaluateCouncilPolicy } from "../../orchestration/council-policy";
import { SingleWriterApplyLock } from "../../orchestration/apply-lock";
import { appendUniqueRef } from "../../helpers/append-unique-ref";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const schema = tool.schema;

/* ------------------------------------------------------------------ */
/*  Deps interface                                                    */
/* ------------------------------------------------------------------ */

export interface GovernanceToolDeps {
  store: SessionStore;
  config: OrchestratorConfig;
  projectDir: string;
  /** Resolves a candidate path relative to the project, returning absolute path or error. */
  ensureInsideProject: (candidatePath: string) => { ok: true; abs: string } | { ok: false; reason: string };
  /** Builds proposal context (sandbox_cwd, run_id, manifest_ref, patch_diff_ref) for a session. */
  buildToolProposalContext: (sessionID: string) => {
    sandbox_cwd: string;
    run_id: string;
    manifest_ref: string;
    patch_diff_ref: string;
  };
}

/* ------------------------------------------------------------------ */
/*  Factory                                                           */
/* ------------------------------------------------------------------ */

export function createGovernanceTools(deps: GovernanceToolDeps): Record<string, ToolDefinition> {
  const { store, config, projectDir, ensureInsideProject } = deps;

  /* ---------- local helpers ---------- */

  const digestFromPatchDiffRef = (
    patchDiffRef: string,
  ): { ok: true; digest: string } | { ok: false; reason: string } => {
    return digestFromPatchDiffRefShared(patchDiffRef, {
      resolvePatchDiffRef: (candidatePatchDiffRef) => {
        const resolvedPath = ensureInsideProject(candidatePatchDiffRef);
        if (!resolvedPath.ok) {
          return { ok: false };
        }
        return { ok: true, absPath: resolvedPath.abs };
      },
      readPatchDiffBytes: (absPath) => readFileSync(absPath),
      sha256FromBytes: (bytes) => createHash("sha256").update(bytes).digest("hex"),
    });
  };

  const evaluateApplyGovernancePrerequisites = (sessionID: string): { ok: true } | { ok: false; reason: string } => {
    return evaluateApplyGovernancePrerequisitesShared({
      state: store.get(sessionID),
      config,
      digestFromPatchDiffRef,
      evaluateCouncilPolicy,
    });
  };

  const withApplyGovernanceLock = async <T>(
    sessionID: string,
    work: () => Promise<T> | T,
  ): Promise<{ ok: true; value: T } | { ok: false; reason: string }> => {
    if (!config.apply_lock.enabled || !config.apply_lock.fail_closed) {
      return { ok: true, value: await work() };
    }
    const lock = new SingleWriterApplyLock({
      projectDir,
      sessionID,
      staleAfterMs: config.apply_lock.stale_lock_recovery_ms,
    });
    const result = await lock.withLock(work);
    if (!result.ok) {
      if (result.reason === "denied") {
        return {
          ok: false,
          reason: `governance_apply_lock_denied:holder_session=${result.holder.sessionID}:holder_pid=${result.holder.pid}`,
        };
      }
      return { ok: false, reason: `governance_apply_lock_error:${result.message}` };
    }

    const state = store.get(sessionID);
    store.update(sessionID, {
      governance: {
        ...state.governance,
        applyLock: {
          lockID: `${result.holder.pid}:${result.holder.acquiredAtMs}`,
          ownerSessionID: result.holder.sessionID,
          ownerProviderFamily: state.governance.patch.authorProviderFamily,
          ownerSubagent: state.lastTaskSubagent,
          acquiredAt: result.holder.acquiredAtMs,
        },
      },
    });
    return { ok: true, value: result.value };
  };

  /* ---------- tool definitions ---------- */

  return {
    ctf_patch_propose: tool({
      description: "Record an explicit governance patch proposal artifact chain",
      args: {
        proposal_text: schema.string().min(1),
        run_id: schema.string().min(1),
        manifest_ref: schema.string().min(1),
        patch_diff_ref: schema.string().min(1),
        sandbox_cwd: schema.string().min(1),
        author_model: schema.string().optional(),
        file_count: schema.number().int().nonnegative().optional(),
        total_loc: schema.number().int().nonnegative().optional(),
        risk_score: schema.number().int().nonnegative().max(100).optional(),
        critical_paths_touched: schema.number().int().nonnegative().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const runID = args.run_id.trim();
        const manifestRef = args.manifest_ref.trim();
        const patchDiffRef = args.patch_diff_ref.trim();
        const sandboxCwd = args.sandbox_cwd.trim().replace(/\\/g, "/");
        const proposalText = args.proposal_text.trim();
        if (!proposalText) {
          return stableToolResponse({ ok: false, reason: "governance_proposal_text_empty", sessionID });
        }

        const refs = [
          `run_id=${runID}`,
          `manifest_ref=${manifestRef}`,
          `patch_diff_ref=${patchDiffRef}`,
          `sandbox_cwd=${sandboxCwd}`,
        ];
        if (!hasPatchArtifactRefChain(refs)) {
          return stableToolResponse({
            ok: false,
            reason: "governance_patch_artifact_chain_incomplete",
            sessionID,
            artifacts: {
              refs,
              paths: [manifestRef, patchDiffRef, sandboxCwd],
            },
          });
        }

        const patchDigestResult = digestFromPatchDiffRef(patchDiffRef);
        if (!patchDigestResult.ok) {
          return stableToolResponse({
            ok: false,
            reason: patchDigestResult.reason,
            sessionID,
            artifacts: {
              refs,
              paths: [manifestRef, patchDiffRef, sandboxCwd],
            },
          });
        }
        const patchDigest = patchDigestResult.digest;
        const authorModel =
          typeof args.author_model === "string" && args.author_model.trim().length > 0
            ? args.author_model.trim()
            : "unknown/unknown";
        const state = store.get(sessionID);
        let proposalRefs = [...state.governance.patch.proposalRefs];
        for (const ref of refs) {
          proposalRefs = appendUniqueRef(proposalRefs, ref);
        }
        if (typeof args.file_count === "number" && args.file_count > 0) {
          proposalRefs = appendUniqueRef(proposalRefs, `files=${Math.floor(args.file_count)}`);
        }
        if (typeof args.total_loc === "number" && args.total_loc > 0) {
          proposalRefs = appendUniqueRef(proposalRefs, `loc=${Math.floor(args.total_loc)}`);
        }
        if (typeof args.risk_score === "number" && args.risk_score > 0) {
          proposalRefs = appendUniqueRef(proposalRefs, `risk_score=${Math.floor(args.risk_score)}`);
        }
        if (typeof args.critical_paths_touched === "number" && args.critical_paths_touched > 0) {
          proposalRefs = appendUniqueRef(proposalRefs, `critical_paths_touched=${Math.floor(args.critical_paths_touched)}`);
        }

        store.update(sessionID, {
          governance: {
            ...state.governance,
            patch: {
              ...state.governance.patch,
              proposalRefs,
              digest: patchDigest,
              authorProviderFamily: providerFamilyFromModel(authorModel),
            },
          },
        });

        return stableToolResponse({
          ok: true,
          reason: "governance_patch_proposal_recorded",
          sessionID,
          governance: {
            patch_digest: patchDigest,
            author_provider_family: providerFamilyFromModel(authorModel),
          },
          artifacts: {
            refs,
            paths: [manifestRef, patchDiffRef, sandboxCwd],
          },
        });
      },
    }),

    ctf_patch_review: tool({
      description: "Record independent review decision for the active patch digest",
      args: {
        patch_sha256: schema.string().trim().regex(/^[a-fA-F0-9]{64}$/),
        author_model: schema.string().min(1),
        reviewer_model: schema.string().min(1),
        verdict: schema.enum(["pending", "approved", "rejected"]),
        reviewed_at: schema.number().int().nonnegative().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const state = store.get(sessionID);
        const decision = bindIndependentReviewDecision({
          patch_sha256: args.patch_sha256.toLowerCase(),
          author_model: args.author_model,
          reviewer_model: args.reviewer_model,
          verdict: args.verdict as "pending" | "approved" | "rejected",
          reviewed_at: typeof args.reviewed_at === "number" ? args.reviewed_at : Date.now(),
        });
        const maybeReview = evaluateIndependentReviewGate({
          decision,
          expected_patch_sha256: state.governance.patch.digest,
          config,
        });
        if (!maybeReview.ok) {
          return stableToolResponse({
            ok: false,
            reason: maybeReview.reason,
            sessionID,
            artifacts: {
              refs: [...state.governance.patch.proposalRefs],
            },
          });
        }

        store.update(sessionID, {
          governance: {
            ...state.governance,
            patch: {
              ...state.governance.patch,
              authorProviderFamily:
                maybeReview.author_provider_family as typeof state.governance.patch.authorProviderFamily,
              reviewerProviderFamily:
                maybeReview.reviewer_provider_family as typeof state.governance.patch.reviewerProviderFamily,
            },
            review: {
              verdict: maybeReview.decision.verdict,
              digest: maybeReview.decision.patch_sha256,
              reviewedAt: maybeReview.decision.reviewed_at,
            },
          },
        });

        return stableToolResponse({
          ok: true,
          reason: "governance_review_recorded",
          sessionID,
          decision: maybeReview.decision,
          artifacts: {
            refs: [...state.governance.patch.proposalRefs],
          },
        });
      },
    }),

    ctf_patch_apply: tool({
      description: "Run deterministic fail-closed governance preflight for patch apply",
      args: {
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const locked = await withApplyGovernanceLock(sessionID, async () => {
          const pre = evaluateApplyGovernancePrerequisites(sessionID);
          if (!pre.ok) {
            return stableToolResponse({
              ok: false,
              reason: pre.reason,
              sessionID,
              artifacts: {
                refs: [...store.get(sessionID).governance.patch.proposalRefs],
              },
            });
          }

          const state = store.get(sessionID);
          return stableToolResponse({
            ok: true,
            reason: "governance_apply_preflight_passed",
            sessionID,
            apply_lock: {
              lock_id: state.governance.applyLock.lockID,
              owner_session_id: state.governance.applyLock.ownerSessionID,
              acquired_at: state.governance.applyLock.acquiredAt,
            },
            artifacts: {
              refs: [...state.governance.patch.proposalRefs],
              paths: [state.governance.council.decisionArtifactRef].filter((v) => typeof v === "string" && v.length > 0),
            },
          });
        });

        if (!locked.ok) {
          return stableToolResponse({
            ok: false,
            reason: locked.reason,
            sessionID,
            artifacts: {
              refs: [...store.get(sessionID).governance.patch.proposalRefs],
            },
          });
        }

        return locked.value;
      },
    }),

    ctf_patch_audit: tool({
      description: "Audit governance lifecycle status for proposal/review/council/apply preconditions",
      args: {
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const state = store.get(sessionID);
        const patchDigest = state.governance.patch.digest.trim().toLowerCase();
        const patchReady =
          !config.patch_boundary.enabled
          || !config.patch_boundary.fail_closed
          || (SHA256_HEX.test(patchDigest) && hasPatchArtifactRefChain(state.governance.patch.proposalRefs));
        const reviewReady =
          !config.review_gate.enabled
          || !config.review_gate.fail_closed
          || (state.governance.review.verdict === "approved" && state.governance.review.digest === patchDigest);
        const council = evaluateCouncilPolicy(state, config);
        const pre = evaluateApplyGovernancePrerequisites(sessionID);

        return stableToolResponse({
          ok: pre.ok,
          reason: pre.ok ? "governance_apply_ready" : pre.reason,
          sessionID,
          checks: {
            patch_ready: patchReady,
            review_ready: reviewReady,
            council_required: council.required,
            council_blocked: council.blocked,
            council_reasons: council.contract.triggerReasons,
          },
          governance: {
            patch_digest: patchDigest,
            review_digest: state.governance.review.digest,
            review_verdict: state.governance.review.verdict,
            apply_lock_id: state.governance.applyLock.lockID,
          },
          artifacts: {
            refs: [...state.governance.patch.proposalRefs],
            paths: [state.governance.council.decisionArtifactRef].filter((v) => typeof v === "string" && v.length > 0),
          },
        });
      },
    }),
  };
}
