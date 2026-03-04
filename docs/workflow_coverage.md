# AGENTS.md 커버리지 매트릭스 (oh-my-Aegis)

정책 기준 문서: `~/.config/opencode/AGENTS.md`

이 문서는 CTF/BOUNTY 워크플로우 정책이 `oh-my-Aegis` 코드에 어떻게 반영되어 있는지 추적합니다.

## 코드로 커버되는 항목

- 모드 게이트(`CTF`/`BOUNTY`)와 기본 `BOUNTY` 폴백
- 페이즈 라우팅(`SCAN -> PLAN -> EXECUTE -> VERIFY -> SUBMIT`)과 stuck 에스컬레이션
- 거버넌스 단계(`EXECUTE-PROPOSE-PATCH -> REVIEW-INDEPENDENT -> APPLY -> AUDIT`)의 fail-closed 체인
- 후보 검증 게이트(`ctf-decoy-check -> ctf-verify`)
- Bounty scope-first 동작과 scope 확인 전 read-only bash 정책
- apply 전이 preflight 차단과 deterministic deny reason(`governance_apply_blocked:*`)
- `task` 디스패치에서 governance alias route의 non-overridable pinning
- 장애 대응 시그니처 매핑(`explore/librarian/oracle` -> `*-fallback`)
- 디스패치된 `task` 프롬프트에 타겟 인식형 도메인 플레이북 주입
- 프롬프트 인젝션 지표 감지 및 `.Aegis/SCAN.md`의 `INJECTION-ATTEMPT` 로깅
- `todowrite`의 `in_progress` 1개 제한 가드레일
- 저위험 후보용 CTF fast-verify 경로(위험/모호 조건에서는 decoy-check 강제 유지)
- 보안 이슈가 아닌 훅/런타임 실패는 best-effort 로그를 남기고 fail-open 처리
- 반복 미해결 상태를 위한 실패 원인 분류 및 적응형 라우팅 훅
- `.Aegis` 노트의 마크다운 예산 제어 및 아카이브 회전
- `WEB_API`, `WEB3`, `PWN`, `REV`, `CRYPTO`, `FORENSICS`, `MISC`, `UNKNOWN` 타겟 인식형 CTF 라우팅
- `OSINT`는 의도적으로 `MISC` 분류를 통해 라우팅
- OpenCode 플러그인/필수 서브에이전트를 한 번에 반영하는 apply 플로우(`bun run setup` / `bun run apply`)
- 최소 내장 MCP 베이스라인(`context7`, `grep_app`) + 런타임 설정 주입 + apply 시 보장
- readiness 리포트에 타겟별 누락 서브에이전트 커버리지(`coverageByTarget`) 포함
- readiness 리포트에 누락 내장 MCP 매핑 포함
- 벤치마크 품질 게이트는 증거 기반 실행을 강제(스킵이 아닌 항목은 증거 파일 필수)
- 도메인 픽스처 벤치마크 생성기가 재현 가능한 `results.json` 및 도메인별 증거 아티팩트 생성
- 픽스처 생성기는 듀얼 모드 커버리지 강제(모든 도메인이 CTF/BOUNTY 모두에 등장)
- 릴리즈 자동화에 semver bump, changelog 생성, git 태깅, GitHub 릴리즈 워크플로우 포함
- CI는 Linux/macOS/Windows 전부에서 OS별 apply smoke 검증 수행
- doctor 커맨드가 릴리즈 전 runtime/build/readiness/benchmark 상태 검증

## 거버넌스 artifact 계약 커버리지

아래 체인은 코드와 테스트에서 연결되어 있어야 APPLY 가능:

- `.Aegis/runs/<run_id>/sandbox`
- `.Aegis/runs/<run_id>/run-manifest.json`
- `.Aegis/runs/<run_id>/patches/*.diff`
- `.Aegis/runs/<run_id>/patches/*.manifest.json`
- `.Aegis/runs/locks/single-writer-apply.lock`

대표 deny reason:

- `governance_patch_missing_or_invalid_digest`
- `governance_patch_artifact_chain_incomplete`
- `governance_review_not_approved:*`
- `governance_review_digest_mismatch`
- `governance_review_provider_family_*`
- `governance_council_required_missing_artifact`
- `governance_apply_lock_denied:*`
- `governance_apply_lock_error:*`

## 주요 구현 위치

- `src/index-core.ts`
  - `tool.execute.before/after` 훅에서 거버넌스 preflight 차단, artifact 수집, 라우팅/정책 주입
- `src/tools/control-tools.ts`
  - `ctf_patch_propose`, `ctf_patch_review`, `ctf_patch_apply`, `ctf_patch_audit` 계약
- `src/orchestration/router.ts`
  - 거버넌스 block/apply-ready alias route 결정
- `src/orchestration/task-dispatch.ts`
  - governance alias route non-overridable pinning
- `src/orchestration/patch-boundary.ts`
  - patch digest/manifest materialization 및 `.Aegis/runs/<run_id>/patches` 계약
- `src/orchestration/sandbox.ts`
  - run sandbox lifecycle, `run-manifest.json` 기록
- `src/orchestration/review-gate.ts`
  - independent review digest binding 및 provider-family 독립성 검증
- `src/orchestration/council-policy.ts`
  - council required/block 판정과 계약 출력
- `src/orchestration/apply-lock.ts`
  - single-writer apply lock과 stale-lock 복구
- `src/state/session-store.ts`
  - 거버넌스 상태(`state.governance`) 저장/복원
- `src/risk/policy-matrix.ts`
  - apply 전이 식별(`isApplyTransitionAttempt`)과 정책 경계
- `src/risk/sanitize.ts`
  - 실패 신호 파싱과 프롬프트 인젝션 지표 감지
- `src/state/notes-store.ts`
  - STATE/WORKLOG/EVIDENCE/SCAN/CONTEXT_PACK 저장 및 회전
- `src/config/schema.ts`
  - patch/review/council/apply-lock fail-closed 기본값과 정책 튜너
- `src/orchestration/playbook.ts`
  - 타겟별 CTF/BOUNTY 실행 플레이북 텍스트
- `src/mcp/index.ts`
  - 내장 MCP 레지스트리와 disable-list 필터링
- `src/config/readiness.ts`
  - 쓰기 가능 여부, 필수 서브에이전트, 타겟별 커버리지, MCP 존재 검사
- `scripts/apply.ts`
  - `opencode.json`/`oh-my-Aegis.json` 원커맨드 apply/update(최소 내장 MCP 매핑 포함)
- `scripts/benchmark-generate.ts`
  - 도메인 픽스처 시나리오 실행, 증거 아티팩트 및 `benchmarks/results.json` 생성
- `scripts/benchmark-score.ts`
  - 비스킵 실행의 도메인 점수 및 증거 경로 존재 여부 검증
- `scripts/doctor.ts`
  - runtime/build/readiness/benchmark 게이트 환경 진단
- `scripts/release-version.ts`
  - 릴리즈 자동화를 위한 semver bump/override 로직
- `scripts/generate-changelog.ts`
  - git 히스토리 기반 릴리즈 노트 생성

## 남아 있는 정책 레벨 계약

아래 항목은 의도적으로 완전 하드코딩하지 않고 운영자/프롬프트 규율로 남겨둡니다:

- 정확한 리포팅 템플릿
- bounty scope의 법적/권한 정책
- custom notes root path contract (`notes.root_dir`) 운영 규율
