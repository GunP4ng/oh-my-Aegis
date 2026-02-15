# oh-my-Aegis

OpenCode용 CTF/BOUNTY 오케스트레이션 플러그인입니다. 세션 상태/루프 신호를 노트 디렉토리(기본 `.Aegis/*`)에 남기고, 현재 상황에 맞는 다음 서브에이전트를 라우팅합니다.

## 주요 기능

### CTF

- **3단계 페이즈 관리**: `SCAN → PLAN → EXECUTE` 자동 전이
- **8개 타겟 전용 라우팅**: `WEB_API`, `WEB3`, `PWN`, `REV`, `CRYPTO`, `FORENSICS`, `MISC`, `UNKNOWN` 각각 전용 scan/plan/execute/stuck/failover 경로
- **정체(stuck) 감지 + 자동 피벗**: `noNewEvidenceLoops`, `samePayloadLoops`, `verifyFailCount` 기반 임계치 초과 시 자동 전환 (`stuck_threshold` 설정 가능)
- **실패 기반 적응 라우팅**: `context_overflow`, `verification_mismatch`, `tooling_timeout`, `exploit_chain`, `hypothesis_stall` 5가지 유형 자동 감지 + 대응 경로 선택
- **디코이 검증 파이프라인**: `ctf-decoy-check → ctf-verify` 2단계 검증, 리스크 평가 기반 고속 검증 fast-path 지원
- **자동 디스패치 + 폴백**: route → subagent 매핑, rate limit/timeout 시 자동 폴백 전환 (설정으로 재시도 횟수 조절)
- **도메인별 플레이북 주입**: `task` 호출 시 타겟/모드에 맞는 규칙을 prompt에 자동 삽입
- **병렬 트랙 실행(옵션)**: `ctf_parallel_dispatch/status/collect/abort`로 SCAN/가설을 병렬로 실행하고 결과를 수집/중단

### BOUNTY

- **Scope 우선 강제**: scope 미확인 시 모든 라우팅이 `bounty-scope`로 제한
- **Task 우회 차단**: `task` 호출에서도 route가 `bounty-scope`인 동안은 사용자 지정 `category/subagent_type`을 무시하고 `bounty-scope`로 강제 핀(pin)
- **Read-only 가드레일**: scope 확인 전 bash 명령을 세그먼트 단위로 검사, 허용 목록(`ls`, `cat`, `grep`, `readelf`, `strings` 등)만 통과
- **파괴 명령 차단**: `rm -rf`, `mkfs`, `dd`, `shutdown`, `git reset --hard` 등 파괴적 패턴 차단 (설정으로 패턴 추가 가능)
- **Soft deny 권한 재요청**: 스캐너/blackout/out-of-scope host 등 “soft deny”는 권한을 다시 ask로 띄우고 사용자가 승인하면 1회 실행 허용 (파괴 명령은 계속 hard deny)
- **연구 에스컬레이션**: read-only 검증 2회 inconclusive 시 `bounty-research`로 자동 전환

### 공통

- **에이전트별 최적 모델 자동 선택 + 모델 failover**: 역할별 기본 모델 매핑 + rate limit/쿼터 오류(429 등) 감지 시 대체 모델 변형(`--flash`, `--opus`)으로 자동 전환
- **Ultrawork 키워드 지원**: 사용자 프롬프트에 `ultrawork`/`ulw`가 포함되면 세션을 ultrawork 모드로 전환(연속 실행 자세 + 추가 free-text 신호 + CTF todo continuation)
- **Aegis 오케스트레이터 에이전트 자동 주입**: runtime config에 `agent.Aegis`가 없으면 자동으로 추가(이미 정의돼 있으면 유지)
- **Think/Ultrathink 안전장치**: `--opus` 변형 적용 전 모델 헬스 체크(429/timeout 쿨다운), unhealthy면 스킵; stuck 기반 auto-deepen은 세션당 최대 3회
- **Google Antigravity OAuth 내장(옵션)**: google provider에 OAuth(PKCE) auth hook 제공. 외부 `opencode-antigravity-auth` 플러그인 설치 시 기본은 중복 방지로 비활성화(설정으로 override 가능)
- **도구 출력 트렁케이션 + 아티팩트 저장**: 출력이 너무 길면 자동으로 잘라서 컨텍스트 폭주를 막고, 원문은 `.Aegis/artifacts/tool-output/*`에 저장
- **디렉토리 컨텍스트 주입**: `read`로 파일을 열 때, 상위 디렉토리의 `AGENTS.md`/`README.md`를 자동으로 주입(최대 파일/용량 제한)
- **컴팩션 컨텍스트 강화**: 세션 컴팩션 시 `.Aegis/CONTEXT_PACK.md`를 자동으로 compaction prompt에 포함
- 세션별 상태(`MODE`, `PHASE`, 정체/검증 신호) 추적 + 라우팅 결정 기록
- `.Aegis/*` 마크다운 노트 기록 + 예산 초과 시 자동 아카이브 회전
- 실패 자동 분류(7가지 유형) + 실패 카운트 추적
- 인젝션 감지(5가지 패턴) + SCAN에 로깅
- 시스템 프롬프트에 `MODE/PHASE/TARGET/NEXT_ROUTE` 자동 주입
- 내장 MCP 자동 등록(context7, grep_app, websearch)

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

### Ultrawork 모드

oh-my-opencode처럼 “계속 굴러가게” 만들고 싶다면, 아래 중 하나로 ultrawork 모드를 켤 수 있습니다.

- **키워드로 활성화**: 사용자 프롬프트에 `ultrawork` 또는 `ulw` 포함
  - 예: `ulw ctf pwn challenge`
- **도구로 활성화**: `ctf_orch_set_ultrawork enabled=true`

ultrawork 모드에서 적용되는 동작(핵심만):

- free-text 신호 처리 강화: `scan_completed`, `plan_completed`, `verify_success`, `verify_fail` 같은 이벤트 이름을 텍스트로 보내도 상태 이벤트로 반영
- CTF에서 `verify_success` 이전에 todos를 모두 `completed/cancelled`로 닫으려 하면, 자동으로 pending TODO 1개를 추가해 루프를 이어가도록 강제

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

### Google Antigravity OAuth

`google/antigravity-*` 모델을 사용할 때 필요한 Google OAuth를 플러그인에 내장합니다.

- 기본 동작(auto): 외부 플러그인 `opencode-antigravity-auth`가 설치돼 있지 않으면 내장 OAuth 활성화, 설치돼 있으면 중복 방지를 위해 비활성화
- 강제 설정: `google_auth=true`(항상 활성화) / `google_auth=false`(항상 비활성화)

설정 예시(`~/.config/opencode/oh-my-Aegis.json`):

```json
{
  "google_auth": true
}
```

선택: OpenCode 설정(`opencode.json`)에서 google provider 옵션으로 clientId/clientSecret을 지정할 수 있습니다.

```json
{
  "provider": {
    "google": {
      "options": {
        "clientId": "...",
        "clientSecret": "..."
      }
    }
  }
}
```

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

### 병렬 스캔/가설(옵션)

SCAN 단계에서 2~3개의 트랙을 동시에 돌려 빠르게 탐색하고 싶다면:

```text
ctf_parallel_dispatch plan=scan challenge_description="..." max_tracks=3
ctf_parallel_status
ctf_parallel_collect message_limit=5
```

가설을 병렬로 반증하고 싶다면(배열 JSON 문자열 전달):

```text
ctf_parallel_dispatch \
  plan=hypothesis \
  hypotheses='[{"hypothesis":"...","disconfirmTest":"..."}]' \
  max_tracks=3
```

winner를 고른 뒤 나머지 트랙을 중단하려면:

```text
ctf_parallel_collect winner_session_id="<child-session-id>"
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

### 지속 루프(계속 작업하기)

CTF/BOUNTY 모두 “끝날 때까지 계속 진행”을 원하면 OpenCode의 내장 continuation 루프를 쓰는 게 가장 안정적입니다.

추가로, oh-my-Aegis는 플러그인 레벨에서도 **완전 자동 루프(Autoloop)** 를 지원합니다.

- 트리거: OpenCode가 `session.idle`(또는 `session.status: idle`) 이벤트를 발생시키면, Aegis가 `client.session.promptAsync`로 다음 프롬프트를 자동으로 주입
- 기본 정책: `ultrawork/ulw`가 활성화된 세션에서만 자동 루프(`auto_loop.only_when_ultrawork=true`)
- CTF 종료 조건: `verify_success`로 `latestVerified`가 채워지면 자동 루프 종료(`auto_loop.stop_on_verified=true`)

설정(`~/.config/opencode/oh-my-Aegis.json`):

```json
{
  "auto_loop": {
    "enabled": true,
    "only_when_ultrawork": true,
    "idle_delay_ms": 350,
    "max_iterations": 200,
    "stop_on_verified": true
  }
}
```

수동 제어:

- `ctf_orch_set_autoloop enabled=true|false`
- `ctf_orch_set_ultrawork enabled=true|false` (ultrawork를 켜면 autoloop도 함께 켬)

CTF 예시(플래그 검증까지 계속):

```text
/ulw-loop "CTF를 풀고 verifier에서 Correct/Accepted가 나올 때까지 루프. 각 루프는 1 TODO만 수행하고 ctf_orch_event로 SCAN/PLAN/EXECUTE 및 verify_success/verify_fail 반영."
```

BOUNTY 예시(발견/재현 가능한 증거까지 계속):

```text
/ulw-loop "BOUNTY에서 scope 확인 후(read-only 준수) 재현 가능한 증거/영향을 확보할 때까지 루프. 필요 시 ctf_orch_event scope_confirmed/readonly_inconclusive 등을 반영."
```

중단:

```text
/cancel-ralph
/stop-continuation
```

### BOUNTY 스코프 문서

프로그램이 제공하는 스코프 문서를 프로젝트에 두면, Aegis가 이를 파싱해서 BOUNTY 가드레일에 반영합니다.

- 자동 탐지 후보 경로: `.Aegis/scope.md`, `.opencode/bounty-scope.md`, `BOUNTY_SCOPE.md`, `SCOPE.md`
- 적용 시점: `scope_confirmed` 이후 (문서가 존재하더라도 자동으로 scope를 확인 처리하지 않습니다)
- 강제 내용(기본값):
  - 스캐너/자동화 명령 차단 (`nmap`, `nuclei`, `ffuf`, `sqlmap` 등)
  - scope 문서에서 추출한 allow/deny host 기반으로 `curl/wget/ping`류 네트워크 명령의 대상 호스트를 제한
  - 문서에 blackout window(예: `목요일 00:00 ~ 11:00`)가 있으면 해당 시간대 네트워크 명령 차단

확인은 `ctf_orch_readiness` 출력의 `scopeDoc` 필드를 참고하세요.

## 설정

설정 파일 탐색 우선순위:

- 사용자: `~/.config/opencode/oh-my-Aegis.json`
- 프로젝트: `<project>/.Aegis/oh-my-Aegis.json` (사용자 설정을 덮어씀)

주요 설정:

| 키 | 기본값 | 설명 |
|---|---|---|
| `enabled` | `true` | 플러그인 활성화 |
| `enable_builtin_mcps` | `true` | 내장 MCP 자동 등록 (context7, grep_app, websearch) |
| `google_auth` | `auto` | Google Antigravity OAuth 내장 auth hook 활성화. auto=외부 `opencode-antigravity-auth` 없으면 on, 있으면 off; true=강제 on, false=강제 off |
| `disabled_mcps` | `[]` | 내장 MCP 비활성화 목록 (예: `["websearch"]`) |
| `default_mode` | `BOUNTY` | 기본 모드 |
| `stuck_threshold` | `2` | 정체 감지 임계치 |
| `dynamic_model.enabled` | `false` | 모델/쿼터 오류 시 동일 역할의 대체 모델 변형으로 자동 전환 (setup 사용 시 기본 활성화) |
| `dynamic_model.health_cooldown_ms` | `300000` | 모델 unhealthy 쿨다운 (ms) |
| `dynamic_model.generate_variants` | `true` | setup에서 변형 에이전트 생성 여부 |
| `bounty_policy.scope_doc_candidates` | `[... ]` | BOUNTY 스코프 문서 자동 탐지 후보 경로 |
| `bounty_policy.enforce_allowed_hosts` | `true` | scope 문서 기반 호스트 allow/deny 강제 |
| `bounty_policy.enforce_blackout_windows` | `true` | blackout window 시간대 네트워크 명령 차단 |
| `bounty_policy.deny_scanner_commands` | `true` | 스캐너/자동화 명령 차단 |
| `auto_dispatch.enabled` | `true` | route → subagent 자동 디스패치 |
| `auto_dispatch.max_failover_retries` | `2` | 폴백 최대 재시도 횟수 |
| `ctf_fast_verify.enabled` | `true` | 저위험 후보 고속 검증 |
| `guardrails.deny_destructive_bash` | `true` | 파괴 명령 차단 |
| `target_detection.enabled` | `true` | 텍스트 기반 타겟 자동 감지 사용 |
| `target_detection.lock_after_first` | `true` | 타겟이 한 번 설정되면 세션 중간에 자동 변경 금지 |
| `target_detection.only_in_scan` | `true` | SCAN 페이즈에서만 타겟 자동 감지 허용 |
| `notes.root_dir` | `.Aegis` | 런타임 노트 디렉토리(예: `.Aegis` 또는 `.sisyphus`) |

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
| `ctf_parallel_dispatch` | 병렬 child 세션 디스패치(SCAN/가설) |
| `ctf_parallel_status` | 병렬 트랙 상태 조회 |
| `ctf_parallel_collect` | 병렬 결과 수집(선택: winner 지정 시 나머지 abort) |
| `ctf_parallel_abort` | 병렬 트랙 전체 중단 |

## 개발/검증

```bash
bun run typecheck
bun test
bun run build
bun run doctor
```

## 운영 메모

- 세션 상태: `.Aegis/orchestrator_state.json`
- 런타임 노트: 기본 `.Aegis/*` (설정 `notes.root_dir`로 변경 가능)

## 문서

- 런타임 워크플로우 요약: `docs/runtime-workflow.md`
- CTF/BOUNTY 운영 계약(원문): `docs/ctf-bounty-contract.md`
- 커버리지/경계 노트: `docs/workflow_coverage.md`
- readiness 로드맵: `docs/perfect-readiness-roadmap.md`
