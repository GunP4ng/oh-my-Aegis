import type { SessionState, TargetType } from "../state/types";

const CTF_TARGET_RULES: Record<TargetType, string[]> = {
  WEB_API: [
    "Use OWASP-style hypothesis and verify with reproducible request/response evidence.",
    "Treat UI-only changes as candidate until server-side state change is confirmed.",
  ],
  WEB3: [
    "Validate on-chain effects against transaction/event evidence before claiming success.",
    "Assume web3-specific edge cases (reentrancy/allowance/oracle assumptions) and disconfirm cheaply first.",
  ],
  PWN: [
    "Prioritize deterministic local exploit loop and prove shell/primitive with reproducible command output.",
    "Capture crash/leak evidence and avoid one-shot ad-hoc payloads without repeatability.",
  ],
  REV: [
    "Prefer runtime-grounded evidence over static guesses when outputs mismatch checker behavior.",
    "Record disassembly/trace artifacts for each hypothesis pivot.",
  ],
  CRYPTO: [
    "Use smallest disconfirming test vectors first; do not proceed on intuition-only parameter choices.",
    "Track assumptions (padding/endianness/modulus/nonce) explicitly per loop.",
  ],
  FORENSICS: [
    "Confirm file/container types first and keep provenance for every extracted artifact.",
    "Treat OCR/strings-only findings as candidate until validated by structure or checker.",
  ],
  MISC: [
    "Use quick disconfirm tests and escalate only on new evidence.",
    "OSINT workflows are intentionally grouped under MISC and require source-citable evidence.",
  ],
  UNKNOWN: [
    "Start with broad scan, narrow to strongest hypothesis, and keep one TODO loop discipline.",
    "Do not claim solved status without verifier-aligned evidence.",
  ],
};

const BOUNTY_TARGET_RULES: Record<TargetType, string[]> = {
  WEB_API: [
    "Respect scope and use minimal-impact validation before any aggressive testing.",
    "Require reproducible request/response evidence and impact narrative.",
  ],
  WEB3: [
    "Confirm scope (contracts/chains) and use read-only/state-safe checks first.",
    "Prefer simulation or non-destructive validation before broadcasting impactful transactions.",
  ],
  PWN: [
    "Use controlled local reproduction and avoid destructive payloads.",
    "Demonstrate exploitability with least-impact proof aligned to program rules.",
  ],
  REV: [
    "Keep reverse-engineering artifacts reproducible and tie findings to real exploit surface.",
    "Avoid unverifiable theoretical claims without runtime evidence.",
  ],
  CRYPTO: [
    "Provide concrete break conditions and measurable security impact.",
    "Use conservative assumptions until validated by reproducible tests.",
  ],
  FORENSICS: [
    "Maintain chain-of-custody style artifact notes and avoid modifying originals.",
    "Report only verified timeline/fact claims with source references.",
  ],
  MISC: [
    "Stay scope-safe and impact-minimal; gather evidence before escalation.",
    "OSINT workflows are intentionally grouped under MISC and require source-citable evidence.",
  ],
  UNKNOWN: [
    "Use triage-first mode and do not run high-risk actions before scope confidence.",
    "Escalate to research when two low-impact checks are inconclusive.",
  ],
};

export function buildTaskPlaybook(state: SessionState): string {
  const header = "[oh-my-Aegis domain-playbook]";
  const rules = state.mode === "CTF" ? CTF_TARGET_RULES[state.targetType] : BOUNTY_TARGET_RULES[state.targetType];
  const lines = [
    header,
    `mode=${state.mode}`,
    `target=${state.targetType}`,
    "rules:",
    `- ${rules[0]}`,
    `- ${rules[1]}`,
    "- Execute one TODO loop at a time and attach verifier-aligned evidence.",
  ];
  return lines.join("\n");
}

export function hasPlaybookMarker(prompt: string): boolean {
  return prompt.includes("[oh-my-Aegis domain-playbook]");
}
