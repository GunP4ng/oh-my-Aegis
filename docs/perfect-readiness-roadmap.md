# 완전 Readiness 로드맵

이 로드맵은 "범용 CTF/BOUNTY 오케스트레이터" 목표를 구체적인 엔지니어링 마일스톤으로 변환합니다.

## Readiness 정의

아래 조건이 모두 충족되면 `oh-my-Aegis`를 "perfect-ready" 상태로 간주합니다.

1. 안전/검증/루프 규율을 위한 런타임 강제 오케스트레이션 정책이 존재한다(문서 규정만으로 끝나지 않음).
2. 각 타겟(`WEB_API`, `WEB3`, `PWN`, `REV`, `CRYPTO`, `FORENSICS`, `MISC`)별 도메인 라우팅 및 실행 가이드가 명시되어 있다.
3. 치명적 설정 오류에 대해 readiness 진단이 fail-hard로 동작한다.
4. end-to-end 통합 테스트가 훅 체인과 failover 동작을 검증한다.
5. 도메인 벤치마크 스코어링이 존재하며 릴리즈 품질 게이트로 사용할 수 있다.

## 마일스톤 분해

## M1 — 도메인 플레이북 주입
- **목표**: 모든 `task` 호출이 타겟 인식형 CTF/BOUNTY 실행 가이드를 받도록 한다.
- **대상 파일**:
  - `src/orchestration/playbook.ts`
  - `src/index.ts`
- **수용 테스트**:
  - `test/plugin-hooks.test.ts`에서 프롬프트에 `[oh-my-Aegis domain-playbook]` 및 `target=<...>` 포함 여부를 검증.

## M2 — 런타임 정책 강제
- **목표**: 문서 규정 중심 정책을 가능한 범위에서 런타임 검사로 전환.
- **대상 파일**:
  - `src/risk/sanitize.ts` (prompt-injection indicator detection)
  - `src/state/notes-store.ts` (injection-attempt logging)
  - `src/index.ts` (`todowrite` one-`in_progress` guard + injection logging hook)
  - `src/config/schema.ts` (policy toggles)
- **수용 테스트**:
  - `test/plugin-hooks.test.ts`에서 `in_progress` 다중 항목을 가진 잘못된 `todowrite` payload 차단 검증.
  - `test/plugin-hooks.test.ts`에서 인젝션 시도가 `.Aegis/SCAN.md`에 기록되는지 검증.
  - `test/risk-policy.test.ts`에서 인젝션 지표 감지 로직 검증.

## M3 — 엄격한 Readiness 진단
- **목표**: 누락/비가독 설정 및 필수 매핑 누락 시 readiness가 기본적으로 fail-closed로 동작.
- **대상 파일**:
  - `src/config/readiness.ts`
  - `src/config/schema.ts`
  - `src/tools/control-tools.ts`
- **수용 테스트**:
  - `test/readiness.test.ts`에서 OpenCode 설정 누락 시 strict mode 실패 검증.
  - `test/readiness.test.ts`에서 strict mode 비활성화 시 relaxed mode 경고 전용 동작 검증.

## M4 — MCP 베이스라인 + 크로스 플랫폼 설정 경로
- **목표**: 최소 MCP 베이스라인과 설정 탐색이 Linux/Windows에서 모두 정상 동작.
- **대상 파일**:
  - `src/mcp/*`
  - `src/config/loader.ts`
  - `scripts/apply.ts`
- **수용 테스트**:
  - `test/mcp-config.test.ts`에서 내장 MCP 주입 및 disable list 검증.
  - apply smoke에서 생성된 `opencode.json`에 `context7`, `grep_app` 존재 여부 검증.

## M5 — 벤치마크 기반 품질 게이트
- **목표**: 범용 readiness 선언 전, 명시적 품질 게이트로 도메인 결과를 점수화.
- **대상 파일**:
  - `src/benchmark/scoring.ts`
  - `scripts/benchmark-score.ts`
  - `benchmarks/manifest.example.json`
  - `package.json`
- **수용 테스트**:
  - `test/benchmark-scoring.test.ts`에서 perfect/needs_work 판정 로직 검증.

## M6 — 통합/E2E 성숙도
- **목표**: 런타임 동작과 벤치마크 증거 추적성에 대해 훅 체인 전체 신뢰 확보.
- **완료 항목**:
  - Dedicated e2e harness for `chat.message -> tool.execute.before/after` flow (`test/e2e-orchestration.test.ts`).
  - Domain fixture benchmark pack with per-domain evidence artifacts (`benchmarks/fixtures/domain-fixtures.json`, `scripts/benchmark-generate.ts`).
  - Fixture coverage gate requiring all domains across both `CTF` and `BOUNTY` modes.
  - CI now generates benchmark evidence before scoring (`.github/workflows/ci.yml`).
- **성공 기준**:
  - 도메인별 증거 아티팩트를 포함한 CI 결정적 통과.

## M7 — 릴리즈/운영 하드닝
- **목표**: 검증된 빌드를 반복 가능한 프로덕션급 릴리즈로 전환.
- **완료 항목**:
  - Cross-platform CI matrix (`ubuntu`, `macos`, `windows`) with per-OS apply smoke checks.
  - Release workflow with semver bump, changelog generation, tag creation, and GitHub Release publishing.
  - `doctor` command for pre-release runtime/build/readiness/benchmark diagnostics.
- **성공 기준**:
  - `publish` 워크플로우가 깨끗한 mainline 커밋에서 태그 릴리즈 생성 가능.
  - 릴리즈 생성 전 Doctor 체크가 녹색 상태.

## 릴리즈 게이트(최소 요건)

오케스트레이터를 "perfect-ready"라고 부르기 전에 다음을 만족해야 합니다:

1. `bun run typecheck` passes.
2. `bun test` passes.
3. `bun run build` passes.
4. `bun run apply` smoke passes on isolated config path.
5. `bun run benchmark:score <results.json>` returns `qualityGate.verdict = "perfect"`.
