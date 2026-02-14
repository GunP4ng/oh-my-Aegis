# oh-my-Aegis

OpenCode용 CTF/BOUNTY 오케스트레이션 플러그인입니다. 세션 상태/루프 신호를 `.Aegis/*`로 남기고, 현재 상황에 맞는 다음 서브에이전트를 라우팅합니다.

## 주요 기능

### CTF

- **3단계 페이즈 관리**: `SCAN → PLAN → EXECUTE` 자동 전이
- **8개 타겟 전용 라우팅**: `WEB_API`, `WEB3`, `PWN`, `REV`, `CRYPTO`, `FORENSICS`, `MISC`, `UNKNOWN` 각각 전용 scan/plan/execute/stuck/failover 경로
- **정체(stuck) 감지 + 자동 피벗**: `noNewEvidenceLoops`, `samePayloadLoops`, `verifyFailCount` 기반 임계치 초과 시 자동 전환 (`stuck_threshold` 설정 가능)
- **실패 기반 적응 라우팅**: `context_overflow`, `verification_mismatch`, `tooling_timeout`, `exploit_chain`, `hypothesis_stall` 5가지 유형 자동 감지 + 대응 경로 선택
- **디코이 검증 파이프라인**: `ctf-decoy-check → ctf-verify` 2단계 검증, 리스크 평가 기반 고속 검증 fast-path 지원
- **자동 디스패치 + 폴백**: route → subagent 매핑, rate limit/timeout 시 자동 폴백 전환 (설정으로 재시도 횟수 조절)
- **도메인별 플레이북 주입**: `task` 호출 시 타겟/모드에 맞는 규칙을 prompt에 자동 삽입

### BOUNTY

- **Scope 우선 강제**: scope 미확인 시 모든 라우팅이 `bounty-scope`로 제한
- **Read-only 가드레일**: scope 확인 전 bash 명령을 세그먼트 단위로 검사, 허용 목록(`ls`, `cat`, `grep`, `readelf`, `strings` 등)만 통과
- **파괴 명령 차단**: `rm -rf`, `mkfs`, `dd`, `shutdown`, `git reset --hard` 등 파괴적 패턴 차단 (설정으로 패턴 추가 가능)
- **연구 에스컬레이션**: read-only 검증 2회 inconclusive 시 `bounty-research`로 자동 전환

### 공통

- **에이전트별 최적 모델 자동 선택 + 모델 failover**: 역할별 기본 모델 매핑 + rate limit/쿼터 오류(429 등) 감지 시 대체 모델 변형(`--flash`, `--opus`)으로 자동 전환
- 세션별 상태(`MODE`, `PHASE`, 정체/검증 신호) 추적 + 라우팅 결정 기록
- `.Aegis/*` 마크다운 노트 기록 + 예산 초과 시 자동 아카이브 회전
- 실패 자동 분류(7가지 유형) + 실패 카운트 추적
- 인젝션 감지(5가지 패턴) + SCAN에 로깅
- 시스템 프롬프트에 `MODE/PHASE/TARGET/NEXT_ROUTE` 자동 주입
- 내장 MCP 자동 등록(context7, grep_app)

## 설치

### 한 번에 적용 (권장)

```bash
bun run setup
```

### 수동 적용

```bash
bun install
bun run build
```

`opencode.json`에 플러그인을 등록합니다.

```json
{
  "plugin": [
    "/absolute/path/to/oh-my-Aegis/dist/index.js"
  ]
}
```

마지막으로 readiness 점검을 실행합니다.

- `ctf_orch_readiness`

## 사용방법

### 기본 흐름

1. **모드 설정**: 세션 시작 시 `ctf_orch_set_mode`로 `CTF` 또는 `BOUNTY` 모드를 설정합니다 (기본값: `BOUNTY`).

2. **자동 라우팅**: `task` 호출 시 오케스트레이터가 현재 상태(모드/페이즈/타겟/정체 신호)를 분석하여 최적의 서브에이전트를 자동 선택합니다. 사용자가 직접 `category`나 `subagent_type`을 지정할 수도 있습니다.

3. **페이즈 전이(CTF)**: `ctf_orch_event`로 이벤트를 전달하면 `SCAN → PLAN → EXECUTE` 페이즈가 자동 전이됩니다.

4. **상태 확인**: `ctf_orch_status`로 현재 모드, 페이즈, 타겟, 정체 신호, 다음 라우팅 결정을 확인할 수 있습니다.

5. **실패 대응**: 에이전트 실패 시 `ctf_orch_failover`로 폴백 에이전트를 조회하거나, `ctf_orch_postmortem`로 실패 원인 분석 + 다음 추천을 받습니다.

### 모델 자동 선택

`bun run setup` 실행 시 각 서브에이전트에 역할에 맞는 모델이 자동 매핑됩니다:

| 역할 | 모델 | 대상 에이전트 |
|---|---|---|
| 고성능 추론 | `openai/gpt-5.3-codex` | ctf-web, ctf-web3, ctf-pwn, ctf-rev, ctf-crypto, ctf-solve, ctf-verify, bounty-scope, bounty-triage |
| 빠른 탐색/리서치 | `google/antigravity-gemini-3-flash` | ctf-explore, ctf-research, ctf-forensics, ctf-decoy-check, bounty-research, md-scribe |
| 깊은 사고/계획 | `google/antigravity-claude-opus-4-6-thinking` | ctf-hypothesis, deep-plan |
| 폴백 (explore) | `google/antigravity-gemini-3-flash` | explore-fallback |
| 폴백 (librarian/oracle) | `google/antigravity-gemini-3-pro` | librarian-fallback, oracle-fallback |

모델 매핑은 `src/install/agent-overrides.ts`의 `AGENT_OVERRIDES`에서 커스터마이즈할 수 있습니다.

추가로 `dynamic_model.enabled=true`일 때, rate limit/쿼터 오류가 감지되면 해당 모델을 일정 시간 동안 unhealthy로 표시하고 동일 역할의 변형 에이전트로 전환합니다.

- 변형 이름 규칙: `<agent>--codex`, `<agent>--flash`, `<agent>--opus`
- 쿨다운: `dynamic_model.health_cooldown_ms` (기본 300000ms)

### 예시 워크플로우 (CTF)

```
1. ctf_orch_set_mode mode=CTF        # CTF 모드 설정
2. (채팅) "target is PWN heap challenge"  # 타겟 자동 감지
   # 또는: ctf_orch_event event=reset_loop target_type=PWN
3. (task 호출 → 자동으로 ctf-pwn 디스패치)
4. ctf_orch_event event=scan_completed
5. ctf_orch_event event=candidate_found candidate="..."
6. (자동 디코이 검증 → ctf-decoy-check → ctf-verify)
7. ctf_orch_status
```

### 예시 워크플로우 (BOUNTY)

```
1. ctf_orch_set_mode mode=BOUNTY     # BOUNTY 모드 설정 (기본값)
2. (scope 미확인 → 모든 라우팅이 bounty-scope로 제한)
3. ctf_orch_event event=scope_confirmed  # scope 확인 후
4. (task 호출 → bounty-triage 에이전트 자동 선택)
5. (bash 명령 → 세그먼트 단위 read-only 검사 자동 적용)
6. ctf_orch_status
```

## 설정

설정 파일 탐색 우선순위:

- 사용자: `~/.config/opencode/oh-my-Aegis.json`
- 프로젝트: `<project>/.Aegis/oh-my-Aegis.json` (사용자 설정을 덮어씀)

주요 설정:

| 키 | 기본값 | 설명 |
|---|---|---|
| `enabled` | `true` | 플러그인 활성화 |
| `default_mode` | `BOUNTY` | 기본 모드 |
| `stuck_threshold` | `2` | 정체 감지 임계치 |
| `dynamic_model.enabled` | `false` | 모델/쿼터 오류 시 동일 역할의 대체 모델 변형으로 자동 전환 (setup 사용 시 기본 활성화) |
| `dynamic_model.health_cooldown_ms` | `300000` | 모델 unhealthy 쿨다운 (ms) |
| `dynamic_model.generate_variants` | `true` | setup에서 변형 에이전트 생성 여부 |
| `auto_dispatch.enabled` | `true` | route → subagent 자동 디스패치 |
| `auto_dispatch.max_failover_retries` | `2` | 폴백 최대 재시도 횟수 |
| `ctf_fast_verify.enabled` | `true` | 저위험 후보 고속 검증 |
| `guardrails.deny_destructive_bash` | `true` | 파괴 명령 차단 |

전체 설정 스키마는 `src/config/schema.ts`를 참고하세요.

## 제공 도구

| 도구 | 설명 |
|---|---|
| `ctf_orch_status` | 현재 상태 + 라우팅 결정 |
| `ctf_orch_set_mode` | `CTF` 또는 `BOUNTY` 모드 설정 |
| `ctf_orch_event` | 이벤트 반영(후보/가설/타겟 포함 가능) |
| `ctf_orch_next` | 다음 추천 라우팅 |
| `ctf_orch_failover` | 에러 텍스트 기반 폴백 에이전트 조회 |
| `ctf_orch_postmortem` | 실패 원인 요약 + 다음 추천 |
| `ctf_orch_check_budgets` | 마크다운 예산 점검 |
| `ctf_orch_compact` | 즉시 회전/압축 |
| `ctf_orch_readiness` | 필수 서브에이전트/MCP/쓰기 권한 점검 |

## 개발/검증

```bash
bun run typecheck
bun test
bun run build
bun run doctor
```

## 운영 메모

- 세션 상태: `.Aegis/orchestrator_state.json`
- 런타임 노트: `.Aegis/STATE.md`, `.Aegis/WORKLOG.md`, `.Aegis/EVIDENCE.md`, `.Aegis/SCAN.md`, `.Aegis/CONTEXT_PACK.md`

## 문서

- 런타임 워크플로우 요약: `docs/runtime-workflow.md`
- CTF/BOUNTY 운영 계약(원문): `docs/ctf-bounty-contract.md`
- 커버리지/경계 노트: `docs/workflow_coverage.md`
- readiness 로드맵: `docs/perfect-readiness-roadmap.md`
