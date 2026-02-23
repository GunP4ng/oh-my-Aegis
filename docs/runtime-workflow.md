# Runtime Workflow (oh-my-Aegis)

이 문서는 `oh-my-Aegis` 런타임 워크플로우를 구현 기준으로 요약합니다.

## 1) 상태 머신

- MODE: `CTF` 또는 `BOUNTY`
- PHASE: `SCAN -> PLAN -> EXECUTE`
- TARGET: `WEB_API`, `WEB3`, `PWN`, `REV`, `CRYPTO`, `FORENSICS`, `MISC`, `UNKNOWN`
- 세션 상태 저장 경로: `.Aegis/orchestrator_state.json`

핵심 전이(`src/state/session-store.ts`):

- `scan_completed` -> `PLAN`
- `plan_completed` -> `EXECUTE`
- `candidate_found` -> `candidatePendingVerification=true`
- `verify_success` -> 후보/실패 루프 카운터 정리
- `verify_fail` -> mismatch/정체 카운터 증가
- `context_length_exceeded` / `timeout` -> 실패 카운터 및 폴백 신호 반영

## 2) 훅 파이프라인

주요 오케스트레이션 훅(`src/index.ts`):

- `chat.message`
  - `MODE: CTF|BOUNTY` 감지
  - 텍스트 기반 타겟 힌트 감지(기본: SCAN + UNKNOWN에서만 1회 설정)
  - 옵션 활성화 시 인젝션 지표 로깅
- `tool.execute.before`
  - `task`: 자동 디스패치 경로 -> `subagent_type`
    - route가 `bounty-scope`/`ctf-decoy-check`/`ctf-verify`/`md-scribe`이면 사용자 지정 `category/subagent_type`을 무시하고 강제 핀(pin)
  - `bash`: 정책 매트릭스 적용(BOUNTY scope 읽기 전용(read-only) + 파괴 명령 거부 패턴)
  - `todowrite`: `in_progress` 단일 항목 가드
- `tool.execute.after`
  - 실패 원인 분류 + 검증 이벤트 반영 + task 폴백 전환 준비

## 3) 라우팅 우선순위

라우트 엔진: `src/orchestration/router.ts`

1. context/timeout 임계치 초과 -> `md-scribe`
2. scope 미확인 `BOUNTY` -> `bounty-scope`
3. 실패 기반 적응 라우팅
   - `static_dynamic_contradiction` 발생 시 `ctf-rev` patch-and-dump 추출 루트를 우선 강제(루프 예산 기반)
   - stale kill-switch: 동일 패턴 반복 + 신규 증거 없음이면 `ctf-hypothesis`로 강제 피벗
4. 후보 검증 경로(`ctf-decoy-check` / `ctf-verify` fast path / `bounty-triage`)
5. bounty 읽기 전용(read-only) inconclusive 에스컬레이션 -> `bounty-research`
6. 공통 정체(stuck) 경로
7. phase 경로(`scan`, `plan`, `execute`)

## 4) 노트, 증거, 회전

런타임 저장 노트(`src/state/notes-store.ts`, 기본 root=`.Aegis`, 설정 `notes.root_dir`로 변경 가능):

- `.Aegis/STATE.md`
- `.Aegis/WORKLOG.md`
- `.Aegis/EVIDENCE.md`
- `.Aegis/SCAN.md`
- `.Aegis/CONTEXT_PACK.md`
- 아카이브: `.Aegis/archive/*`

## 5) Readiness 및 진단

- `ctf_orch_readiness`: 설정/서브에이전트/MCP/쓰기 권한 점검
- `bun run doctor`: 런타임 + 빌드 + 벤치마크 + readiness 게이트
