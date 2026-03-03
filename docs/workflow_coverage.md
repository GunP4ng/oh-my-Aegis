# AGENTS.md 커버리지 매트릭스 (oh-my-Aegis)

정책 기준 문서: `~/.config/opencode/AGENTS.md`

이 문서는 CTF/BOUNTY 워크플로우 정책이 `oh-my-Aegis` 코드에 어떻게 반영되어 있는지 추적합니다.

## 코드로 커버되는 항목

- 모드 게이트(`CTF`/`BOUNTY`)와 기본 `BOUNTY` 폴백.
- 페이즈 라우팅(`SCAN -> PLAN -> EXECUTE`)과 stuck 에스컬레이션.
- 후보 검증 게이트(`ctf-decoy-check -> ctf-verify`).
- Bounty scope-first 동작과 scope 확인 전 read-only bash 정책.
- 장애 대응 시그니처 매핑(`explore/librarian/oracle` -> `*-fallback`).
- 디스패치된 `task` 프롬프트에 타겟 인식형 도메인 플레이북 주입.
- 프롬프트 인젝션 지표 감지 및 `.Aegis/SCAN.md`의 `INJECTION-ATTEMPT` 로깅.
- `todowrite`의 `in_progress` 1개 제한 가드레일.
- 저위험 후보용 CTF fast-verify 경로(위험/모호 조건에서는 decoy-check 강제 유지).
- 보안 이슈가 아닌 훅/런타임 실패는 best-effort 로그를 남기고 fail-open 처리.
- 반복 미해결 상태를 위한 실패 원인 분류 및 적응형 라우팅 훅.
- `.Aegis` 노트의 마크다운 예산 제어 및 아카이브 회전.
- `WEB_API`, `WEB3`, `PWN`, `REV`, `CRYPTO`, `FORENSICS`, `MISC`, `UNKNOWN` 타겟 인식형 CTF 라우팅.
- `OSINT`는 의도적으로 `MISC` 분류를 통해 라우팅.
- OpenCode 플러그인/필수 서브에이전트를 한 번에 반영하는 apply 플로우(`bun run setup` / `bun run apply`).
- 최소 내장 MCP 베이스라인(`context7`, `grep_app`) + 런타임 설정 주입 + apply 시 보장.
- readiness 리포트에 타겟별 누락 서브에이전트 커버리지(`coverageByTarget`) 포함.
- readiness 리포트에 누락 내장 MCP 매핑 포함.
- 벤치마크 품질 게이트는 증거 기반 실행을 강제(스킵이 아닌 항목은 증거 파일 필수).
- 도메인 픽스처 벤치마크 생성기가 재현 가능한 `results.json` 및 도메인별 증거 아티팩트 생성.
- 픽스처 생성기는 듀얼 모드 커버리지 강제(모든 도메인이 CTF/BOUNTY 모두에 등장).
- 릴리즈 자동화에 semver bump, changelog 생성, git 태깅, GitHub 릴리즈 워크플로우 포함.
- CI는 Linux/macOS/Windows 전부에서 OS별 apply smoke 검증 수행.
- doctor 커맨드가 릴리즈 전 runtime/build/readiness/benchmark 상태 검증.

## 주요 구현 위치

- `src/orchestration/router.ts`
  - 라우팅 결정, 타겟 인식형 phase/stuck 라우팅, 실패 기반 적응 로직
- `src/orchestration/task-dispatch.ts`
  - route -> subagent 매핑, 타겟 인식형 failover 디스패치
- `src/state/session-store.ts`
  - 상태 전이와 이벤트 카운터
- `src/state/notes-store.ts`
  - STATE/WORKLOG/EVIDENCE/SCAN/CONTEXT_PACK 저장 및 회전
- `src/risk/policy-matrix.ts`
  - 파괴 명령/BOUNTY scope 전 제어를 위한 명령 가드레일
- `src/risk/sanitize.ts`
  - 실패 신호 파싱과 프롬프트 인젝션 지표 감지
- `src/config/schema.ts`
  - failover/verification/markdown 예산/타겟 라우팅/capability profile/내장 MCP 토글/강제 옵션 스키마
- `src/orchestration/playbook.ts`
  - 타겟별 CTF/BOUNTY 실행 플레이북 텍스트
- `src/mcp/index.ts`
  - 내장 MCP 레지스트리와 disable-list 필터링
- `src/config/readiness.ts`
  - 쓰기 가능 여부, 필수 서브에이전트, 타겟별 커버리지, MCP 존재 검사
- `src/tools/control-tools.ts`
  - 운영 도구(`status`, `event`, `next`, `failover`, `postmortem`, `check_budgets`, `compact`, `readiness`)
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
