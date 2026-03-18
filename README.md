# oh-my-Aegis

OpenCode용 CTF/BOUNTY 오케스트레이션 플러그인입니다. 세션 상태와 루프 신호를 노트 디렉토리(기본 `.Aegis/`)에 기록하고, 현재 상황에 맞는 서브에이전트를 자동으로 라우팅합니다.

독립 실행형 오케스트레이터 아키텍처와 운영 경계는 `docs/standalone-orchestrator.md`를 참고하세요.

---

## 설치

### 방법 1 — npm (권장)

npm에 패키지가 배포된 상태라면 아래 명령어 하나로 설치가 완료됩니다.

```bash
npx -y oh-my-aegis install
```

전역 설치를 선호한다면:

```bash
npm i -g oh-my-aegis
oh-my-aegis install
```

> **Windows에서 `'oh-my-aegis'은(는) 인식되지 않습니다` 오류가 날 때**
> 전역 설치 후에도 명령을 찾지 못하면 새 터미널을 열어 다시 시도하세요.
> `npm config get prefix`로 전역 경로를 확인하고 `%AppData%\npm`이 PATH에 있는지 점검하세요.
> 전역 설치 없이 실행하려면 `npx -y oh-my-aegis install`을 사용하세요.

---

### 방법 2 — 소스 체크아웃

저장소를 클론한 경우에는 아래 명령어 하나로 의존성 설치, 빌드, 설정 적용을 한 번에 수행합니다.

```bash
bun run setup
```

---

### install 명령 옵션

`oh-my-aegis install`은 OpenCode 설정을 자동으로 보정합니다. TUI(터미널 대화형 선택) 환경에서는 Google/OpenAI 연동 여부를 묻는 대화창이 표시되며, 비-TUI 환경에서는 `auto` 기본값을 적용합니다.

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `--no-tui` | — | TUI 없이 실행 |
| `--chatgpt=<auto\|yes\|no>` | `auto` | ChatGPT/OpenAI 연동 (alias: `--openai`) |
| `--gemini=<auto\|yes\|no>` | `auto` | Gemini 연동 |
| `--claude=<auto\|yes\|no>` | `auto` | Claude 연동 |
| `--bootstrap=<auto\|yes\|no>` | `auto` | 설치 후 Gemini OAuth 안내 메시지를 출력합니다. (auto=출력 없음) |

```bash
# 비대화형 설치 예시
npx -y oh-my-aegis install --no-tui --chatgpt=yes --gemini=yes --claude=yes
oh-my-aegis install --no-tui --chatgpt=yes --gemini=yes --claude=yes
```

install 실행 시 아래 항목을 자동으로 보정합니다.

- `opencode.json`에 `oh-my-aegis@latest` 플러그인 엔트리 추가
- OpenAI 인증 플러그인(`opencode-openai-codex-auth`) 설정
- 필수 MCP 등록: `context7`, `grep_app`, `websearch`, `memory`, `sequential_thinking`
- `provider.google` / `anthropic` / `openai` 카탈로그 보정
- Gemini / Claude 계열 모델을 각각 `provider.google` / `provider.anthropic`에 자동 시드하고, 예전 CLI provider 설정은 현재 provider 구조로 자동 마이그레이션
- `default_agent`를 `Aegis`로 설정
- 충돌 가능성이 높은 레거시 에이전트(`build`, `prometheus`, `hephaestus`) 및 MCP alias 정리

기본 설치 경로는 `~/.config/opencode-aegis/opencode`입니다. `OPENCODE_CONFIG_DIR`를 지정하면 해당 경로를 우선 사용합니다.

---

### 업데이트

```bash
# npm 설치 사용자
npm install -g oh-my-aegis@latest
oh-my-aegis install --no-tui

# 소스 체크아웃 사용자
git pull --ff-only
bun run setup
```

> 새 기본값(예: `anthropic/claude-sonnet-4-6`, `google/gemini-3.1-pro-preview`)을 반영하려면 `install --no-tui`를 반드시 재실행하세요. `git pull` 또는 빌드만으로는 OpenCode 설정에 새 기본값이 반영되지 않습니다.

자동 업데이트 동작(소스 체크아웃 설치에서 `install/run/doctor/readiness` 실행 시):
- 원격이 앞서 있고 로컬 작업트리가 깨끗하면 `git pull --ff-only` + `bun run build`를 자동 실행합니다.
- 비활성화: `AEGIS_NPM_AUTO_UPDATE=0`
- 체크 간격 조정: `AEGIS_NPM_AUTO_UPDATE_INTERVAL_MINUTES` (기본 360분)

---

### 재설치 / 복구

readiness 실패(예: provider/MCP 누락) 시 아래 순서로 복구하세요.

```bash
# 1) CLI 최신 버전으로 업데이트
npm install -g oh-my-aegis@latest
# 또는 (전역 설치 없이)
npx -y oh-my-aegis@latest --help

# 2) install 재실행
oh-my-aegis install --no-tui --chatgpt=yes --gemini=yes --claude=yes
# 또는
npx -y oh-my-aegis@latest install --no-tui --chatgpt=yes --gemini=yes --claude=yes

# 3) 검증
oh-my-aegis readiness
oh-my-aegis doctor --json
```

OpenCode 내부에서는 `ctf_orch_readiness`도 함께 확인하세요.

---

### 설치 검증

```bash
oh-my-aegis doctor        # 사람이 읽기 쉬운 요약
oh-my-aegis doctor --json # 기계 파싱용 JSON
oh-my-aegis readiness     # 필수 서브에이전트/MCP 점검

# 선택: 실제 provider runtime smoke
OPENCODE_CONFIG_DIR="$HOME/.config/opencode-aegis" opencode run --model google/gemini-2.5-flash "Reply with exactly GEMINI_OK and nothing else."
OPENCODE_CONFIG_DIR="$HOME/.config/opencode-aegis" opencode run --model anthropic/claude-sonnet-4-6 "Reply with exactly CLAUDE_OK and nothing else."
```

`readiness`는 플러그인 존재 여부만 보는 것이 아니라 Gemini Google OAuth 자격이 비어 있을 때도 실패로 보고합니다. `Google provider is configured but local Google auth credentials are missing or incomplete`가 보이면 `opencode auth login`으로 Google OAuth를 다시 완료하세요.

실제 런타임에서 허용되는 모델 ID는 `opencode models google` / `opencode models anthropic` 출력이 기준입니다. install/apply는 그 런타임에서 바로 쓸 수 있는 ID에 맞춰 provider catalog를 시드합니다.

---

### 수동 설치

자동 설치 대신 직접 설정하려면 `opencode.json`에 플러그인을 등록합니다.

```bash
bun install && bun run build
```

```json
{
  "plugin": [
    "/absolute/path/to/oh-my-Aegis/dist/index.js"
  ]
}
```

이후 OpenCode 내부에서 `ctf_orch_readiness`로 점검하세요.

---

### Gemini OAuth 연동

Gemini 기본 모델은 `provider.google` + `opencode-gemini-auth`로 연결됩니다. `oh-my-aegis install`에서 Gemini를 활성화했다면 아래 순서로 인증을 완료하세요.

```bash
opencode auth login
# Google -> OAuth with Google (Gemini CLI) 선택
```

기본으로 시드되는 모델 ID:
`google/gemini-2.5-flash`, `google/gemini-2.5-pro`, `google/gemini-2.5-flash-lite`, `google/gemini-3-flash-preview`, `google/gemini-3-pro-preview`, `google/gemini-3.1-flash-lite-preview`, `google/gemini-3.1-pro-preview`

install/apply는 기존 `provider.google.models`를 보존하면서, 빠진 엔트리만 자동으로 채웁니다. 예전 Gemini CLI provider 참조가 남아 있으면 `provider.google` 및 현재 런타임 유효 ID(`google/gemini-3.1-pro-preview` 등)로 자동 정리합니다.

`ctf_gemini_cli` 도구는 로컬 `gemini` CLI 바이너리를 직접 호출하는 별도 경로입니다. 필요 시 [Gemini CLI](https://github.com/google-gemini/gemini-cli)를 설치하고 아래 환경변수로 동작을 제어하세요.

`AEGIS_GEMINI_CLI_BIN`, `AEGIS_GEMINI_CLI_TIMEOUT_MS`, `AEGIS_GEMINI_CLI_MAX_OUTPUT_CHARS`, `AEGIS_GEMINI_CLI_CWD`

---

### Claude Code CLI 연동

Claude 기본 모델은 `provider.anthropic` + `opencode-cluade-auth`로 연결됩니다. `oh-my-aegis install`에서 Claude를 활성화했다면 아래 조건을 확인하세요.

- 로컬 `claude` CLI가 설치되어 있어야 합니다.
- `claude auth login` 등으로 Claude Code CLI 로그인 상태여야 합니다.
- 런타임 강제 안전 플래그: `--permission-mode=plan`, `--no-session-persistence`, `--tools=""`
- CLI 바이너리 경로 오버라이드: `AEGIS_CLAUDE_CODE_CLI_BIN`

기본으로 시드되는 모델 ID:
`anthropic/claude-sonnet-4.5`, `anthropic/claude-opus-4.1`, `anthropic/claude-sonnet-4-6`, `anthropic/claude-opus-4-6`, `anthropic/claude-haiku-4-5`

install/apply는 기존 `provider.anthropic.models`를 보존하면서, 빠진 엔트리만 자동으로 채웁니다. 예전 Claude CLI provider 참조가 남아 있으면 `provider.anthropic` 및 현재 런타임 유효 ID(`anthropic/claude-sonnet-4-6` 등)로 자동 정리합니다.

---

### run 명령

`oh-my-aegis run`은 메시지 앞에 `MODE:` 헤더를 자동으로 붙이고, 필요하면 ultrawork/god mode 플래그를 함께 주입해 `opencode run`으로 전달합니다.

```bash
# 일반 실행
oh-my-aegis run --mode=CTF "solve this rev challenge"

# ultrawork + 세션 이어받기
oh-my-aegis run --ultrawork "continue bounty triage" -- --session-id ses_xxx

# 격리된 VM에서 완전 권한 실행
oh-my-aegis run --god-mode "continue inside isolated VM"
```

- `--god-mode` / `--unsafe-full-permission`: spawned `opencode run`에 `AEGIS_GOD_MODE=1`을 전달합니다.
- god mode에서도 `rm`, `del`, `format`, `Remove-Item -Force` 같은 파괴 명령은 자동 허용되지 않고 명시적 승인 절차를 거칩니다.

---

## 사용 방법

### 기본 흐름

1. **모드 명시(필수)**: 세션 시작 시 `MODE: CTF` 또는 `MODE: BOUNTY`를 메시지에 포함하거나, `ctf_orch_set_mode`를 먼저 호출하세요. 명시 전에는 오케스트레이션 로직이 동작하지 않습니다.
2. **자동 라우팅**: `task` 호출 시 오케스트레이터가 현재 상태(모드/페이즈/타겟/정체 신호)를 분석하여 최적의 서브에이전트를 자동 선택합니다.
3. **페이즈 전이(CTF)**: 도구 호출 패턴 기반으로 자동 승격됩니다. 직접 전이하려면 `ctf_orch_event`를 사용하세요.
4. **상태 확인**: `ctf_orch_status`로 현재 모드, 페이즈, 타겟, 정체 신호, 라우팅 결정을 확인할 수 있습니다.
5. **실패 대응**: `ctf_orch_failover`로 폴백 에이전트를 조회하거나, `ctf_orch_postmortem`으로 실패 원인 분석과 다음 추천을 받으세요.

### Ultrawork 모드

프롬프트에 `ultrawork` 또는 `ulw` 키워드를 포함하거나 `ctf_orch_set_ultrawork enabled=true`로 활성화합니다.

- free-text 신호 처리 강화: `scan_completed`, `verify_success` 등을 텍스트로 보내도 상태 이벤트로 반영
- CTF에서 `verify_success` 이전에 TODO를 모두 닫으려 하면 자동으로 pending TODO를 추가하여 루프 유지
- PLAN/EXECUTE 단계에서 TODO 흐름 강제 검증

### 예시 워크플로우 (CTF)

```
1. ctf_orch_set_mode mode=CTF
2. (채팅) "target is PWN heap challenge"  ← 타겟 자동 감지
   또는: ctf_orch_event event=reset_loop target_type=PWN
3. (task 호출 → SCAN: ctf-pwn 자동 디스패치)
4. ctf_orch_event event=scan_completed
5. (task 호출 → PLAN: aegis-plan 자동 디스패치)
6. (task 호출 → EXECUTE: aegis-exec 자동 디스패치)
7. ctf_orch_event event=candidate_found candidate="..."
8. (자동 디코이 검증 → ctf-decoy-check → ctf-verify)
   또는 수동 검증: ctf_orch_manual_verify verification_command="./exploit" stdout_summary="flag{...}"
9. (submit_accepted 시 CLOSED 전환 → autoloop 자동 종료)
10. ctf_orch_status
```

### 예시 워크플로우 (BOUNTY)

```
1. ctf_orch_set_mode mode=BOUNTY
2. (scope 미확인 → 모든 라우팅이 bounty-scope로 제한)
3. ctf_orch_event event=scope_confirmed
4. (task 호출 → bounty-triage 자동 선택)
5. (parallel.auto_dispatch_scan=true이면 ctf_parallel_dispatch plan=scan 자동 위임)
6. ctf_parallel_status / ctf_parallel_collect
7. ctf_orch_status
```

### 병렬 스캔 / 가설 / 딥 워크

```bash
# SCAN 트랙 병렬 실행
ctf_parallel_dispatch plan=scan challenge_description="..." max_tracks=3
ctf_parallel_status
ctf_parallel_collect message_limit=5

# 가설 병렬 반증
ctf_parallel_dispatch plan=hypothesis hypotheses='[{"hypothesis":"...","disconfirmTest":"..."}]' max_tracks=3

# REV/PWN 딥 워크
ctf_parallel_dispatch plan=deep_worker goal="..." max_tracks=5
ctf_parallel_collect winner_session_id="<child-session-id>"  # winner 선택 후 나머지 abort
```

### 지속 루프 (Autoloop)

`session.idle` 이벤트 발생 시 Aegis가 다음 프롬프트를 자동으로 주입합니다.

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

수동 제어: `ctf_orch_set_autoloop enabled=true|false`, `ctf_orch_set_ultrawork enabled=true|false`

중단: `/cancel-ralph` 또는 `/stop-continuation`

### 모델 자동 선택

서브에이전트 lane을 기준으로 `model/variant`를 런타임에서 동적으로 해석합니다.

런타임 해석 우선순위:
1. 사용자 요청의 `model/variant`
2. 세션 서브에이전트 프로필 오버라이드(`ctf_orch_set_subagent_profile`)
3. 에이전트별 모델 오버라이드(`dynamic_model.agent_model_overrides`)
4. 오케스트레이터 lane role profile(`dynamic_model.role_profiles`)
5. 모델 health 상태 기반 fallback

기본 lane 프로필:

| lane | 기본 모델 | variant | 해당 에이전트 예시 |
|---|---|---|---|
| `execution` | `openai/gpt-5.3-codex` | `high` | `aegis-exec`, `ctf-web`, `ctf-pwn`, `ctf-rev` 등 |
| `planning` | `anthropic/claude-sonnet-4-6` | `low` | `aegis-plan`, `ctf-verify`, `bounty-scope` 등 |
| `exploration` | `google/gemini-3.1-pro-preview` | `""` | `aegis-explore`, `ctf-research`, `ctf-forensics`, `md-scribe` 등 |
| Think/Ultrathink/Auto-deepen | `openai/gpt-5.2` | `xhigh` | — |

지원 기본 모델:

| 모델 | 프로바이더 | 필요 인증 |
|---|---|---|
| `google/gemini-3.1-pro-preview` | Google | `opencode-gemini-auth` |
| `google/gemini-3.1-flash-lite-preview` | Google | `opencode-gemini-auth` |
| `google/gemini-3-pro-preview` | Google | `opencode-gemini-auth` |
| `google/gemini-3-flash-preview` | Google | `opencode-gemini-auth` |
| `google/gemini-2.5-pro` | Google | `opencode-gemini-auth` |
| `google/gemini-2.5-flash` | Google | `opencode-gemini-auth` |
| `anthropic/claude-sonnet-4-6` | Anthropic | `opencode-cluade-auth` 또는 `ANTHROPIC_API_KEY` |
| `anthropic/claude-opus-4-6` | Anthropic | `opencode-cluade-auth` 또는 `ANTHROPIC_API_KEY` |
| `anthropic/claude-haiku-4-5` | Anthropic | `opencode-cluade-auth` 또는 `ANTHROPIC_API_KEY` |
| `anthropic/claude-sonnet-4.5` | Anthropic | `opencode-cluade-auth` 또는 `ANTHROPIC_API_KEY` |
| `anthropic/claude-opus-4.1` | Anthropic | `opencode-cluade-auth` 또는 `ANTHROPIC_API_KEY` |

```bash
# 세션별 서브에이전트 프로필 오버라이드
ctf_orch_set_subagent_profile subagent_type=ctf-web model=openai/gpt-5.3-codex
ctf_orch_list_subagent_profiles
ctf_orch_clear_subagent_profile subagent_type=ctf-web
```

에이전트별 고정 모델은 `oh-my-Aegis.json`의 `dynamic_model.agent_model_overrides`로 설정합니다:

```json
{
  "dynamic_model": {
    "agent_model_overrides": {
      "ctf-rev": { "model": "anthropic/claude-opus-4.1", "variant": "high" },
      "aegis-exec": { "model": "openai/gpt-5.4", "variant": "high" },
      "md-scribe": { "model": "google/gemini-2.5-flash", "variant": "" }
    }
  }
}
```

rate limit/쿼터 오류 감지 시 해당 모델을 쿨다운(`dynamic_model.health_cooldown_ms`, 기본 300000ms)하고 대체 프로필을 자동 주입합니다.

### BOUNTY 스코프 문서

프로그램이 제공하는 스코프 문서를 아래 경로 중 하나에 두면 Aegis가 자동으로 파싱하여 가드레일에 반영합니다.

- `.Aegis/scope.md`, `.opencode/bounty-scope.md`, `BOUNTY_SCOPE.md`, `SCOPE.md`

적용 시점: `scope_confirmed` 이후 (문서가 존재해도 자동으로 scope_confirmed 처리되지 않음)

확인: `ctf_orch_readiness` 출력의 `scopeDoc` 필드

---

## 주요 기능

### CTF

- **6단계 페이즈 관리**: `SCAN → PLAN → EXECUTE → VERIFY → SUBMIT → CLOSED` 자동 전이. `CLOSED`는 terminal 단계로 진입 후 모든 이벤트를 무시하고 autoloop를 자동 종료
- **8개 타겟 전용 라우팅**: `WEB_API`, `WEB3`, `PWN`, `REV`, `CRYPTO`, `FORENSICS`, `MISC`, `UNKNOWN` 각각 전용 scan/plan/execute/stuck/failover 경로
- **Heuristic 기반 자동 페이즈 전환**: SCAN 중 분석 도구 N회 이상 호출 시 PLAN으로, PLAN 중 `todowrite` 호출 시 EXECUTE로 자동 전이
- **정체(stuck) 감지 + 자동 피벗**: `noNewEvidenceLoops`, `samePayloadLoops`, `verifyFailCount` 임계치 초과 시 자동 전환. 연속 15회 비Aegis 도구 호출 + Aegis 도구 미사용 감지 시 `no_new_evidence` 이벤트 자동 발생
- **실패 기반 적응 라우팅**: `context_overflow`, `verification_mismatch`, `tooling_timeout`, `exploit_chain`, `hypothesis_stall` 5가지 유형 자동 감지
- **디코이 검증 파이프라인**: `ctf-decoy-check → ctf-verify` 2단계 검증, 리스크 평가 기반 고속 검증 fast-path 지원
- **사전 디코이 감지(Early Decoy Detection)**: VERIFY 단계 전 모든 도구 출력(200KB 이하)에서 flag 패턴을 즉시 스캔
- **도메인별 플레이북 주입**: `task` 호출 시 타겟/모드에 맞는 규칙을 prompt에 자동 삽입 (`playbooks/**/*.yaml`)
- **도메인별 위험 평가**: 도구 출력에서 도메인별 취약점 패턴을 자동 감지하여 리스크 스코어 산출
- **도메인별 검증 게이트**: 플래그 후보 검증 시 도메인별 필수 증거 요구 (PWN/REV: Oracle + ExitCode0 + 환경패리티, WEB_API: Oracle + HTTP 응답 증거, WEB3: Oracle + 트랜잭션 해시/시뮬레이션 등)
- **병렬 트랙 실행**: `ctf_parallel_dispatch/status/collect/abort`로 SCAN/가설/딥워커 트랙을 병렬 실행
- **Exploit 템플릿 라이브러리**: 7개 도메인 39개 템플릿 (`ctf_orch_exploit_template_list/get`)
- **챌린지 파일 자동 트리아지**: `ctf_auto_triage`로 파일 타입 감지 → 타겟 추천 → 스캔 명령 자동 생성
- **플래그 자동 탐지**: 15가지 플래그 포맷 자동 스캔 + 커스텀 패턴 지원

### BOUNTY

- **Scope 우선 강제**: scope 미확인 시 모든 라우팅이 `bounty-scope`로 제한
- **Read-only 가드레일**: bash 명령을 세그먼트 단위로 검사, 허용 목록(`ls`, `cat`, `grep`, `readelf`, `strings` 등)만 통과
- **Pre-scope soft escalation**: scope 확정 전에도 비파괴성 write/execute가 꼭 필요하면 hard block 대신 사용자 확인 기반 soft deny로 한 번 더 승격 가능
- **파괴 명령 차단**: `rm -rf`, `mkfs`, `dd`, `shutdown`, `git reset --hard` 등 (설정으로 패턴 추가 가능)
- **Soft deny 권한 재요청**: 스캐너/blackout/out-of-scope host 등은 사용자 승인 시 1회 실행 허용
- **연구 에스컬레이션**: read-only 검증 2회 inconclusive 시 `bounty-research`로 자동 전환
- **BOUNTY PTY 허용(기본 비활성)**: BOUNTY 세션에서는 interactive/PTY가 기본 차단되며, 별도 플래그(`interactive.enabled_in_bounty`)로만 허용 가능
- **Recon 파이프라인**: `ctf_recon_pipeline`으로 4단계 정찰 자동 계획 (Asset Discovery → Live Host Triage → Content Discovery → Vuln Scan)
- **델타 스캔**: `ctf_delta_scan`으로 스캔 스냅샷 저장/비교 → 새로 발견된 호스트/포트/취약점만 추출

### 공통

- **명시적 모드 활성화(required)**: `MODE: CTF`/`MODE: BOUNTY` 선언 전까지 오케스트레이터는 비활성 상태
- **Lane 기반 모델 자동 선택 + failover**: rate limit/쿼터 오류(429 등) 감지 시 subagent를 유지하고 `model/variant`만 대체 프로필로 자동 전환
- **17개 서브에이전트 자동 주입**: CTF 도메인 7 + 공용 5 + BOUNTY 3 + 유틸 2. `applyRequiredAgents()`에서 도메인 전문 시스템 프롬프트와 권한 프로필을 자동 주입
- **Skill 자동 로드**: `MODE/PHASE/TARGET(+subagent)` 매핑에 따라 `task` 직전마다 `load_skills` 자동 병합 주입
- **Durable TODO ownership**: 현재 `in_progress` TODO는 명시적으로 `completed` 또는 `cancelled + blocked/failed` 되기 전까지 다른 TODO로 덮어쓰지 못하도록 canonical/staged 상태로 보호
- **반복 액션 루프 가드**: `task` / `todowrite` / `ctf_orch_event`가 동일 시그니처로 timeout/stall을 반복하면 dispatch 자체를 차단해 무한 루프를 끊음
- **Shared channel 메시지 버스**: 오케스트레이터↔서브에이전트뿐 아니라 서브에이전트끼리도 진행 상황/발견 사항을 세션 채널에 publish/read 가능
- **Windows GUI→CLI fallback**: GUI 도구가 막히면 대체 CLI 후보, 검색 명령, `winget`/`choco` 설치 흐름을 계획해 이어서 실행 가능
- **God mode with destructive confirm**: 샌드박스를 완화하더라도 파괴 명령은 별도 승인 경로를 유지
- **Claude 호환 훅 브리지**: `.claude/hooks/PreToolUse(.sh/.bash)`/`PostToolUse(.sh/.bash)` 실행
- **Non-Interactive 환경 가드**: `git rebase -i`, `vim`, `nano`, `| less` 등 인터랙티브 명령 자동 차단
- **Context Window 자동 복구**: 컨텍스트 사용량이 90% 초과 시 선제적 notes compaction + `session.summarize` 수행
- **도구 출력 트렁케이션**: 출력이 너무 길면 자동으로 자르고 원문은 `.Aegis/artifacts/tool-output/`에 저장
- **내장 MCP 자동 등록**: `context7`, `grep_app`, `websearch`, `memory`, `sequential_thinking`

---

## 설정

설정 파일 탐색 우선순위:
- 사용자: `~/.config/opencode-aegis/opencode/oh-my-Aegis.json` (또는 `$XDG_CONFIG_HOME/opencode-aegis/opencode/oh-my-Aegis.json`, Windows는 `%APPDATA%/opencode-aegis/opencode/oh-my-Aegis.json`; legacy `.../opencode/oh-my-Aegis.json`도 fallback으로 읽음, `.jsonc`도 지원)
- 프로젝트: `<project>/.Aegis/oh-my-Aegis.json` (프로젝트 설정이 사용자 설정을 덮어씀)

주요 설정:

| 키 | 기본값 | 설명 |
|---|---|---|
| `enabled` | `true` | 플러그인 활성화 |
| `default_mode` | `BOUNTY` | 기본 모드 |
| `enable_builtin_mcps` | `true` | 내장 MCP 자동 등록 |
| `disabled_mcps` | `[]` | 내장 MCP 비활성화 목록 (예: `["websearch"]`) |
| `stuck_threshold` | `2` | 정체 감지 임계치 |
| `dynamic_model.enabled` | `false` | 모델/쿼터 오류 시 대체 프로필 자동 적용 (setup 사용 시 기본 활성화) |
| `dynamic_model.health_cooldown_ms` | `300000` | 모델 unhealthy 쿨다운 (ms) |
| `dynamic_model.thinking_model` | `"openai/gpt-5.2"` | Think/Ultrathink 모드에 사용할 모델 |
| `dynamic_model.role_profiles.execution` | `{ "model": "openai/gpt-5.3-codex", "variant": "high" }` | 실행 lane 기본 프로필 |
| `dynamic_model.role_profiles.planning` | `{ "model": "anthropic/claude-sonnet-4-6", "variant": "low" }` | 계획 lane 기본 프로필 |
| `dynamic_model.role_profiles.exploration` | `{ "model": "google/gemini-3.1-pro-preview", "variant": "" }` | 탐색 lane 기본 프로필 |
| `dynamic_model.agent_model_overrides` | `{}` | 에이전트별 모델/variant 고정 오버라이드. 예: `{ "ctf-rev": { "model": "anthropic/claude-opus-4.1", "variant": "high" } }` |
| `bounty_policy.enforce_allowed_hosts` | `true` | scope 문서 기반 호스트 allow/deny 강제 |
| `bounty_policy.enforce_blackout_windows` | `true` | blackout window 시간대 네트워크 명령 차단 |
| `bounty_policy.deny_scanner_commands` | `true` | 스캐너/자동화 명령 차단 |
| `interactive.enabled_in_ctf` | `true` | CTF 세션에서 interactive/PTY 허용 여부 |
| `interactive.enabled_in_bounty` | `false` | BOUNTY 세션에서 interactive/PTY 허용 여부 |
| `auto_dispatch.enabled` | `true` | route → subagent 자동 디스패치 |
| `auto_dispatch.max_failover_retries` | `2` | 폴백 최대 재시도 횟수 |
| `auto_phase.enabled` | `true` | Heuristic 기반 자동 페이즈 전환 |
| `auto_phase.scan_to_plan_tool_count` | `8` | SCAN→PLAN 자동 전환 도구 호출 임계치 |
| `auto_phase.plan_to_execute_on_todo` | `true` | PLAN→EXECUTE: `todowrite` 호출 시 자동 전환 |
| `auto_loop.enabled` | `true` | 플러그인 레벨 자동 루프 활성화 |
| `auto_loop.only_when_ultrawork` | `true` | ultrawork 모드에서만 자동 루프 |
| `auto_loop.max_iterations` | `200` | 자동 루프 최대 반복 횟수 |
| `auto_loop.stop_on_verified` | `true` | CTF에서 verify_success 시 자동 루프 종료 |
| `parallel.auto_dispatch_scan` | `false` (install: `true`) | SCAN 단계에서 병렬 디스패치 자동 위임 |
| `parallel.auto_dispatch_hypothesis` | `false` (install: `true`) | 가설 피벗 구간에서 병렬 트랙 자동 위임 |
| `parallel.max_concurrent_per_provider` | `2` | provider별 동시 실행 상한 |
| `skill_autoload.enabled` | `true` | subagent task 호출에 `load_skills` 자동 주입 |
| `skill_autoload.max_skills` | `2` | task 당 최대 skills 수 |
| `notes.root_dir` | `.Aegis` | 런타임 노트 디렉토리 |
| `memory.enabled` | `true` | 로컬 지식 그래프/메모리 도구 사용 여부 |
| `memory.storage_dir` | `.Aegis/memory` | 메모리 저장 디렉토리 |
| `sequential_thinking.enabled` | `true` | Sequential thinking 기능 사용 여부 |
| `sequential_thinking.activate_phases` | `["PLAN"]` | 적용할 페이즈 목록 |
| `sequential_thinking.activate_targets` | `["REV","CRYPTO"]` | 적용할 타겟 목록 |
| `sequential_thinking.activate_on_stuck` | `true` | stuck 감지 시 자동 활성화 |
| `tui_notifications.enabled` | `false` | TUI 토스트 알림 활성화 |
| `guardrails.deny_destructive_bash` | `true` | 파괴 명령 차단 |
| `guardrails.bounty_scope_allow_soft_escalation` | `true` | BOUNTY pre-scope 단계에서 비파괴성 execute/write 명령을 soft deny로 재확인 가능 |
| `target_detection.enabled` | `true` | 텍스트 기반 타겟 자동 감지 |
| `target_detection.lock_after_first` | `true` | 타겟 설정 후 세션 중 자동 변경 금지 |
| `recovery.enabled` | `true` | 복구 기능 전체 활성화 |
| `recovery.context_window_proactive_compaction` | `true` | 컨텍스트 90% 초과 시 선제 compaction |
| `recovery.session_recovery` | `true` | `tool_result` 누락 시 세션 복구 |
| `flag_detector.enabled` | `true` | 도구 출력에서 플래그 패턴 자동 탐지 |
| `flag_detector.custom_patterns` | `[]` | 커스텀 플래그 패턴 정규식 배열 |
| `debug.log_all_hooks` | `false` | 모든 훅 호출을 `latency.jsonl`에 기록 (기본: 120ms 이상만) |
| `patch_boundary.enabled` | `true` | 거버넌스 패치 경계 활성화 |
| `patch_boundary.fail_closed` | `true` | 전제조건 미충족 시 fail-closed |
| `patch_boundary.budgets.max_files` | `10` | 패치 허용 최대 파일 수 |
| `patch_boundary.budgets.max_loc` | `1000` | 패치 허용 최대 코드 줄 수 |
| `patch_boundary.allowed_operations` | `["add","modify"]` | 허용 파일 연산 종류 |
| `review_gate.enabled` | `true` | 패치 검토 게이트 활성화 |
| `review_gate.require_independent_reviewer` | `true` | 독립 reviewer 강제 |
| `review_gate.enforce_provider_family_separation` | `true` | 제안자와 다른 provider family의 reviewer 강제 |
| `review_gate.require_patch_digest_match` | `true` | 패치 digest 일치 검증 |
| `council.enabled` | `true` | 카운슬 에스컬레이션 활성화 |
| `council.thresholds.max_files` | `5` | 카운슬 에스컬레이션 트리거: 최대 파일 수 |
| `council.thresholds.max_loc` | `500` | 카운슬 에스컬레이션 트리거: 최대 코드 줄 수 |
| `council.thresholds.risk_score` | `70` | 카운슬 에스컬레이션 트리거: 리스크 스코어 |

전체 설정 스키마는 `src/config/schema.ts`를 참고하세요.

### Skill 자동 로드

- 탐색 경로: `~/.config/opencode/skills/`, `./.opencode/skills/`
- 기본 매핑: `src/config/schema.ts`의 `DEFAULT_SKILL_AUTOLOAD` 참고

```json
{
  "skill_autoload": {
    "enabled": true,
    "max_skills": 2,
    "ctf": {
      "execute": {
        "WEB_API": ["idor-testing", "systematic-debugging"]
      }
    },
    "by_subagent": {
      "aegis-plan": ["plan-writing"]
    }
  }
}
```

---

## 제공 도구

### 오케스트레이션 제어

| 도구 | 설명 |
|---|---|
| `ctf_orch_status` | 현재 상태 + 라우팅 결정 |
| `ctf_orch_set_mode` | `CTF` 또는 `BOUNTY` 모드 설정 |
| `ctf_orch_event` | 이벤트 반영(후보/가설/타겟 포함 가능) |
| `ctf_orch_next` | 다음 추천 라우팅 |
| `ctf_orch_set_ultrawork` | ultrawork 모드 토글 |
| `ctf_orch_set_autoloop` | autoloop 토글 |
| `ctf_orch_set_subagent_profile` | 세션 단위 서브에이전트 model/variant 오버라이드 |
| `ctf_orch_list_subagent_profiles` | 세션 단위 서브에이전트 프로필 조회 |
| `ctf_orch_clear_subagent_profile` | 세션 단위 서브에이전트 프로필 초기화 |
| `ctf_orch_channel_publish` | 오케스트레이터/서브에이전트 공용 채널에 진행 상황 또는 재사용 가능한 발견 사항 게시 |
| `ctf_orch_channel_read` | 세션 공유 채널 메시지 읽기 |
| `ctf_orch_manual_verify` | 수동 검증 결과 기록 (verificationCommand + stdoutSummary 필수). verifier 서브에이전트 없이도 verify_success 처리 |
| `ctf_orch_metrics` | 런타임 메트릭 조회(디스패치 횟수/성공률/모델 상태 등) |

### 실패 대응 / 진단

| 도구 | 설명 |
|---|---|
| `ctf_orch_failover` | 에러 텍스트 기반 폴백 에이전트 조회 |
| `ctf_orch_postmortem` | 실패 원인 요약 + 다음 추천 |
| `ctf_orch_readiness` | 필수 서브에이전트/MCP/쓰기 권한 점검 |
| `ctf_orch_doctor` | 환경 종합 진단 |
| `ctf_orch_check_budgets` | 마크다운 예산 점검 |
| `ctf_orch_compact` | 즉시 회전/압축 |

### 병렬 실행

| 도구 | 설명 |
|---|---|
| `ctf_parallel_dispatch` | 병렬 child 세션 디스패치(SCAN/가설/deep_worker) |
| `ctf_parallel_status` | 병렬 트랙 상태 조회 |
| `ctf_parallel_collect` | 병렬 결과 수집(선택: winner 지정 시 나머지 abort) |
| `ctf_parallel_abort` | 병렬 트랙 전체 중단 |

### 분석 도구

| 도구 | 설명 |
|---|---|
| `ctf_auto_triage` | 챌린지 파일 자동 트리아지: 타입 감지 → 타겟 추천 → 스캔 명령 생성 |
| `ctf_flag_scan` | 플래그 패턴 스캔 + 후보 관리(15가지 기본 포맷 + 커스텀) |
| `ctf_pattern_match` | 알려진 CTF 패턴 매칭(41개 패턴, 5개 도메인) |
| `ctf_risk_score` | 도메인별 위험 평가 |
| `ctf_evidence_ledger` | 증거 원장 기록 (L0–L3 레벨 스코어링, 5가지 evidence_type 지원) |
| `ctf_contradiction_runner` | 가설 예상 결과 vs 실제 런타임 출력 비교 → 모순 감지 시 `static_dynamic_contradiction` 이벤트 자동 발생 |
| `ctf_parity_runner` | local/docker/remote 출력 패리티 비교 실행 |
| `ctf_tool_recommend` | 타겟 타입별 보안 도구 + 명령어 추천 |
| `ctf_orch_windows_cli_fallback` | Windows에서 GUI 도구가 막혔을 때 CLI 대체 후보/검색/설치 명령 계획 생성 |
| `ctf_libc_lookup` | Libc 버전 식별 + offset 추출 + base 주소 계산 |
| `ctf_env_parity` | 로컬-리모트 환경 패리티 체크 + patchelf 명령 생성 |
| `ctf_report_generate` | CTF 라이트업 / BOUNTY 리포트 자동 생성 |

### 거버넌스 (패치 파이프라인)

| 도구 | 설명 |
|---|---|
| `ctf_patch_propose` | 거버넌스 패치 제안 아티팩트 체인 기록 (run_id, manifest_ref, patch_diff_ref, sandbox_cwd 필요) |
| `ctf_patch_review` | 패치 검토 결과 기록 (digest 바인딩, 독립 reviewer 검증) |
| `ctf_patch_apply` | 패치 적용 (single-writer 락 + 전제조건 검증 후 실행) |
| `ctf_patch_audit` | 패치 감사 로그 조회 |

### Exploit 템플릿

| 도구 | 설명 |
|---|---|
| `ctf_orch_exploit_template_list` | 내장 exploit 템플릿 목록(7개 도메인, 39개) |
| `ctf_orch_exploit_template_get` | 내장 exploit 템플릿 조회 |

### REV 분석 / Decoy / Replay

| 도구 | 설명 |
|---|---|
| `ctf_rev_loader_vm_detect` | REV Loader/VM 패턴 감지 |
| `ctf_decoy_guard` | 플래그 후보 디코이 여부 평가 |
| `ctf_replay_safety_check` | 바이너리 standalone 재실행 안전성 검사 |
| `ctf_rev_rela_patch` | RELA 엔트리 r_offset 패치 스크립트 생성 |
| `ctf_rev_syscall_trampoline` | x86_64 syscall 트램펄린 생성 |
| `ctf_rev_entry_patch` | pwntools 기반 엔트리 포인트 패치 스크립트 생성 |
| `ctf_rev_base255_codec` | Base255 (null-free) 인코딩/디코딩 |
| `ctf_rev_linear_recovery` | 선형 방정식 복원 (out/expected 기반 역산) |
| `ctf_rev_mod_inverse` | 확장 유클리드 알고리즘 기반 모듈러 역원 계산 |

### 가설 관리

| 도구 | 설명 |
|---|---|
| `ctf_hypothesis_register` | 가설 등록 |
| `ctf_hypothesis_experiment` | 가설 실험 결과 기록 |
| `ctf_hypothesis_summary` | 활성/완료 가설 요약 조회 |

### UNSAT / Oracle

| 도구 | 설명 |
|---|---|
| `ctf_unsat_gate_status` | UNSAT 주장 필수 조건 상태 확인 |
| `ctf_unsat_record_validation` | UNSAT 조건 충족 기록 |
| `ctf_oracle_progress` | 오라클 테스트 진행률 기록 |

### 외부 CLI 연동

| 도구 | 설명 |
|---|---|
| `ctf_gemini_cli` | Gemini CLI 바이너리(`gemini`)를 통해 Gemini 모델 호출 (prompt 필수, model 선택) |
| `ctf_claude_code` | Claude Code CLI(`claude`)를 통해 Claude 모델 호출. 강제 안전 플래그(`--permission-mode=plan`, `--no-session-persistence`) 적용 |

### BOUNTY 전용

| 도구 | 설명 |
|---|---|
| `ctf_scope_confirm` | 스코프 확인 |
| `ctf_recon_pipeline` | 4단계 정찰 파이프라인 자동 계획 |
| `ctf_delta_scan` | 스캔 스냅샷 저장/비교/재스캔 판단 |

### 메모리 / 사고 / 세션

| 도구 | 설명 |
|---|---|
| `aegis_memory_save` | 지식 그래프에 엔티티/관계 저장 |
| `aegis_memory_search` | 지식 그래프 검색 |
| `aegis_memory_list` | 지식 그래프 전체 조회 |
| `aegis_memory_delete` | 지식 그래프 엔티티 삭제 |
| `aegis_think` | Sequential thinking |
| `ctf_orch_session_list` | OpenCode 세션 목록 조회 |
| `ctf_orch_session_read` | 세션 메시지 읽기 |
| `ctf_orch_session_search` | 세션 내 텍스트 검색 |
| `ctf_orch_session_info` | 세션 메타데이터/통계 조회 |

### AST-grep / LSP / PTY

| 도구 | 설명 |
|---|---|
| `ctf_ast_grep_search` | AST 기반 코드 패턴 검색(25개 언어 지원) |
| `ctf_ast_grep_replace` | AST 기반 코드 패턴 교체 |
| `ctf_lsp_goto_definition` | LSP 정의 이동 |
| `ctf_lsp_find_references` | LSP 참조 찾기 |
| `ctf_lsp_diagnostics` | LSP 진단 메시지(에러/워닝) |
| `ctf_orch_pty_create` | PTY 세션 생성(exploit 실행, 디버거 연결 등) |
| `ctf_orch_pty_list` | PTY 세션 목록 조회 |
| `ctf_orch_pty_get` | PTY 세션 상태 조회 |
| `ctf_orch_pty_update` | PTY 세션 업데이트 |
| `ctf_orch_pty_remove` | PTY 세션 제거 |
| `ctf_orch_pty_connect` | PTY 세션 연결 (일부 OpenCode 버전에서 미지원 시 `ok=true, connectSupported=false` 반환) |
| `ctf_orch_slash` | OpenCode 슬래시 커맨드 실행 |

---

## 운영 메모

| 파일 | 설명 |
|---|---|
| `.Aegis/orchestrator_state.json` | 세션 상태 |
| `.Aegis/STATE.md` | 목표, 제약, 환경, pending TODO |
| `.Aegis/WORKLOG.md` | 시도, 관찰, 요약 |
| `.Aegis/EVIDENCE.md` | 검증된 사실만 기록 |
| `.Aegis/latency.jsonl` | 훅 지연 메트릭 |
| `.Aegis/metrics.jsonl` | 오케스트레이터 이벤트 메트릭 |
| `.Aegis/parallel_state.json` | 병렬 상태 스냅샷 |
| `.Aegis/memory/memory.jsonl` | MCP memory 서버 저장소 |
| `.Aegis/memory/knowledge-graph.json` | Aegis 로컬 지식 그래프 |
| `.Aegis/artifacts/` | 원본 도구 출력, 로그, 스크립트 |

---

## 개발 / 검증

```bash
bun run typecheck
bun test
bun run build
bun run doctor
```

### 특정 테스트 실행

```bash
# ULW + todo continuation
bun test test/plugin-hooks.test.ts test/cli-run.test.ts -t "ultrawork|todo continuation|auto-continues"

# skill_autoload
bun test test/skill-autoload.test.ts test/plugin-hooks.test.ts -t "skill|load_skills|autoload"
```

### npm 배포 전 체크리스트

```bash
bun run typecheck && bun test && bun run build && bun run doctor
git diff --exit-code -- dist   # dist 동기화 확인
npm pack --dry-run             # 패키지 구성 확인
```

- 정식 릴리즈는 `.github/workflows/publish.yml`만 사용합니다.
- 정식 릴리즈는 항상 `preview` 브랜치를 기준으로 수행하며, release note도 `preview`의 최신 태그 이후 커밋만 사용합니다.
- `publish.yml`은 `main`을 직접 업데이트하지 않고 `preview -> main` 동기화 PR을 생성/갱신합니다.
- `latest` 변경/복구는 `.github/workflows/npm-dist-tag.yml`로만 수행합니다.

---

## 문서

- `docs/runtime-workflow.md` — 런타임 워크플로우 요약
- `docs/ctf-bounty-contract.md` — CTF/BOUNTY 운영 계약
- `docs/standalone-orchestrator.md` — 독립 실행형 오케스트레이터 아키텍처
- `docs/workflow_coverage.md` — 커버리지/경계 노트
- `docs/perfect-readiness-roadmap.md` — Readiness 로드맵
- `CHANGELOG.md` — 전체 변경 내역
