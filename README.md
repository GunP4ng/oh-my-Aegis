# oh-my-Aegis

OpenCode용 CTF/BOUNTY 오케스트레이션 플러그인입니다. 세션 상태/루프 신호를 노트 디렉토리(기본 `.Aegis/*`)에 남기고, 현재 상황에 맞는 다음 서브에이전트를 라우팅합니다.

독립 실행형 오케스트레이터 아키텍처/운영 경계는 `docs/standalone-orchestrator.md`를 참고하세요.

## 주요 기능

### CTF

- **3단계 페이즈 관리**: `SCAN → PLAN → EXECUTE` 자동 전이
- **8개 타겟 전용 라우팅**: `WEB_API`, `WEB3`, `PWN`, `REV`, `CRYPTO`, `FORENSICS`, `MISC`, `UNKNOWN` 각각 전용 scan/plan/execute/stuck/failover 경로
- **정체(stuck) 감지 + 자동 피벗**: `noNewEvidenceLoops`, `samePayloadLoops`, `verifyFailCount` 기반 임계치 초과 시 자동 전환 (`stuck_threshold` 설정 가능)
- **실패 기반 적응 라우팅**: `context_overflow`, `verification_mismatch`, `tooling_timeout`, `exploit_chain`, `hypothesis_stall` 5가지 유형 자동 감지 + 대응 경로 선택
- **디코이 검증 파이프라인**: `ctf-decoy-check → ctf-verify` 2단계 검증, 리스크 평가 기반 고속 검증 fast-path 지원
- **자동 디스패치 + 폴백**: route → subagent 매핑, rate limit/timeout 시 자동 폴백 전환 (설정으로 재시도 횟수 조절)
- **도메인별 플레이북 주입**: `task` 호출 시 타겟/모드에 맞는 규칙을 prompt에 자동 삽입
- **병렬 트랙 실행(옵션)**: `ctf_parallel_dispatch/status/collect/abort`로 SCAN/가설/딥워커(deep_worker) 트랙을 병렬로 실행하고, 자동 폴링으로 완료 감지 후 알림(toast/세션 메시지)

### BOUNTY

- **Scope 우선 강제**: scope 미확인 시 모든 라우팅이 `bounty-scope`로 제한
- **Task 우회 차단**: `task` 호출에서도 route가 `bounty-scope`인 동안은 사용자 지정 `category/subagent_type`을 무시하고 `bounty-scope`로 강제 핀(pin)
- **Read-only 가드레일**: scope 확인 전 bash 명령을 세그먼트 단위로 검사, 허용 목록(`ls`, `cat`, `grep`, `readelf`, `strings` 등)만 통과
- **파괴 명령 차단**: `rm -rf`, `mkfs`, `dd`, `shutdown`, `git reset --hard` 등 파괴적 패턴 차단 (설정으로 패턴 추가 가능)
- **Soft deny 권한 재요청**: 스캐너/blackout/out-of-scope host 등 “soft deny”는 권한을 다시 ask로 띄우고 사용자가 승인하면 1회 실행 허용 (파괴 명령은 계속 hard deny)
- **연구 에스컬레이션**: read-only 검증 2회 inconclusive 시 `bounty-research`로 자동 전환
- **Recon 파이프라인**: `ctf_recon_pipeline`으로 4단계 정찰 자동 계획 (Asset Discovery → Live Host Triage → Content Discovery → Vuln Scan). scope 기반 필터링 지원
- **델타 스캔**: `ctf_delta_scan`으로 스캔 스냅샷 저장/비교 → 새로 발견된 호스트/포트/취약점만 추출. 재스캔 필요 여부 자동 판단 (`delta_scan.*`)

### 공통

- **명시적 모드 활성화(required)**: `MODE: CTF`/`MODE: BOUNTY` 또는 `ctf_orch_set_mode`를 실행하기 전까지 오케스트레이터는 비활성 상태입니다. 비활성 상태에서는 `ctf_*`/`aegis_*` 도구(예외: `ctf_orch_set_mode`, `ctf_orch_status`)를 실행할 수 없습니다.
- **에이전트별 최적 모델 자동 선택 + 모델 failover**: 역할별 기본 모델 매핑 + rate limit/쿼터 오류(429 등) 감지 시 subagent는 유지하고 `model/variant`만 대체 프로필로 자동 전환
- **Ultrawork 키워드 지원**: 사용자 프롬프트에 `ultrawork`/`ulw`가 포함되면 세션을 ultrawork 모드로 전환(연속 실행 자세 + 추가 free-text 신호 + CTF todo continuation)
- **Aegis 오케스트레이터 + Aegis 서브에이전트 자동 주입**: runtime config에 `agent.Aegis`가 없으면 자동으로 추가(이미 정의돼 있으면 유지). 추가로 `aegis-plan`/`aegis-exec`/`aegis-deep`/`aegis-explore`/`aegis-librarian`도 자동 주입하며, 내부 서브에이전트는 `mode=subagent` + `hidden=true`로 고정되어 선택 메뉴에는 메인 `Aegis`만 노출
- **Aegis Explore 서브에이전트**: 코드베이스/로컬 파일 탐색 전용 에이전트. 패턴 검색, 디렉토리 구조 분석, 파일 내용 grep을 구조화된 결과로 반환
- **Aegis Librarian 서브에이전트**: 외부 참조 검색 전용 에이전트. CVE/Exploit-DB/공식 문서/OSS writeup을 검색하여 공격 벡터 및 best practice 정보 제공
- **계획/실행 분리**: `PLAN`은 `aegis-plan`, `EXECUTE`는 `aegis-exec`로 기본 라우팅(PLAN 출력은 `.Aegis/PLAN.md`로 저장)
- **딥 워커(REV/PWN)**: stuck 피벗 시 `aegis-deep`로 전환 가능(병렬 `deep_worker` 플랜으로 2~5개 트랙 탐색)
- **Skill 자동 로드(opencode skills)**: `MODE/PHASE/TARGET(+subagent)` 매핑에 따라 subagent task 호출에 `load_skills`를 자동 주입 (`skill_autoload.*`)
- **Think/Ultrathink 안전장치**: `google/antigravity-gemini-3-pro` 프로필 적용 전 모델 헬스 체크(429/timeout 쿨다운), unhealthy면 스킵; stuck 기반 auto-deepen은 세션당 최대 3회
- **Google Antigravity OAuth 내장(옵션)**: google provider에 OAuth(PKCE) auth hook 제공. `setup/install`은 npm 최신 버전을 조회해 `opencode-antigravity-auth@x.y.z`로 pin(조회 실패 시 `@latest`)하며, 내장 OAuth는 중복 방지를 위해 기본 auto에서 비활성화(설정으로 override 가능)
- **Non-Interactive 환경 가드**: `git rebase -i`, `vim`, `nano`, `python` REPL, `| less` 등 인터랙티브 명령을 자동 감지하여 차단, headless 환경에서의 무한 대기 방지 (`recovery.non_interactive_env`)
- **Thinking Block Validator**: thinking 모델의 깨진 `<thinking>` 태그(미닫힘/고아 태그/접두사 누출)를 자동 수정하여 다운스트림 파싱 에러 방지 (`recovery.thinking_block_validator`)
- **Edit Error Recovery**: edit/patch 적용 실패 시 re-read + 작은 hunk 재시도 가이드를 자동 주입 (`recovery.edit_error_hint`)
- **Session Recovery**: `tool_use`는 있는데 `tool_result`가 누락된 경우(크래시/중단 등) synthetic `tool_result`를 주입해 세션을 복구. BOUNTY에서는 “실행 여부 불명”으로 처리하고 자동 재실행을 억제 (`recovery.session_recovery`)
- **Context Window Recovery**: context length 초과 감지 시 `session.summarize`를 호출해 대화를 요약하고 재시도를 유도 (`recovery.context_window_recovery`)
- **도구 출력 트렁케이션 + 아티팩트 저장**: 출력이 너무 길면 자동으로 잘라서 컨텍스트 폭주를 막고, 원문은 `.Aegis/artifacts/tool-output/*`에 저장 (tool별 임계치 설정 지원)
- **Exploit 템플릿 라이브러리**: `ctf_orch_exploit_template_list/get`으로 PWN/CRYPTO/WEB/REV/FORENSICS 26개 템플릿을 빠르게 조회
- **챌린지 파일 자동 트리아지**: `ctf_auto_triage`로 파일 타입 감지 → 타겟 타입 추천 → 스캔 명령어 자동 생성 (ELF/archive/image/pcap/pdf/script 지원)
- **플래그 자동 탐지**: 도구 출력에서 15가지 플래그 포맷(`flag{}`, `CTF{}`, `picoCTF{}`, `htb{}` 등)을 자동 스캔하여 후보 알림 + 커스텀 패턴 지원 (`flag_detector.*`)
- **CTF 패턴 매처**: `ctf_pattern_match`로 41가지 알려진 CTF 패턴(PWN/WEB/CRYPTO/REV/FORENSICS) 자동 매칭 → 공격 경로 추천
- **Libc 데이터베이스**: `ctf_libc_lookup`으로 leaked 함수 주소 → libc 버전 식별 + useful offset 추출 + libc.rip URL 빌더
- **보안 도구 추천**: `ctf_tool_recommend`로 타겟 타입별 추천 도구 + 명령어 자동 생성 (checksec/ROPgadget/one_gadget/binwalk/exiftool/nuclei/RsaCtfTool/z3/patchelf)
- **환경 패리티 체크**: `ctf_env_parity`로 Dockerfile/ldd 파싱 → 로컬-리모트 libc/링커/아키텍처 차이 감지 + patchelf 명령 자동 생성
- **리포트 자동 생성**: `ctf_report_generate`로 WORKLOG/EVIDENCE 기반 CTF writeup 또는 BOUNTY 리포트 자동 생성
- **디렉토리 컨텍스트 주입**: `read`로 파일을 열 때, 상위 디렉토리의 `AGENTS.md`/`README.md`를 자동으로 주입(최대 파일/용량 제한)
- **컴팩션 컨텍스트 강화**: 세션 컴팩션 시 `.Aegis/CONTEXT_PACK.md`를 자동으로 compaction prompt에 포함
- **Comment Checker**: edit/write 출력에서 코드 패치의 과도한 주석 비율 및 AI slop 마커(`as an ai`, `chatgpt`, `generated by` 등)를 감지하여 경고 주입 (`comment_checker.*`)
- **Rules Injector**: `.claude/rules/*.md` 파일의 내용을 `read` 출력에 자동 주입. frontmatter의 `paths:` 글로브로 대상 파일을 매칭하며, 세션당 중복 주입 방지 (`rules_injector.*`)
- **Claude Deny Rules**: `.claude/settings.json`(및 `settings.local.json`)의 `permissions.deny` 패턴을 파싱하여 `Bash(...)`, `Read(...)`, `Edit(...)` 규칙을 런타임에 강제. 위반 시 즉시 차단
- **Claude Hooks 호환 레이어**: `.claude/hooks/` 디렉토리의 `PreToolUse`/`PostToolUse` 훅 스크립트를 실행하는 호환 레이어. 훅이 deny를 반환하면 도구 실행을 차단 (`claude_hooks.*`)
- **Think/Ultrathink 모드**: 사용자 프롬프트에 `think`/`ultrathink` 키워드가 포함되면 해당 세션의 `task` 호출에 opus thinking 모델 변형을 자동 적용. stuck 감지 시 auto-deepen(세션당 최대 3회)
- **PTY 관리 도구**: `ctf_orch_pty_create/list/get/update/remove/connect`로 대화형 프로세스(exploit 실행, 디버거 연결 등)를 관리
- **세션 관리 도구**: `ctf_orch_session_list/read/search/info`로 OpenCode 세션 이력을 조회/검색
- **AST-grep 도구**: `ctf_ast_grep_search/replace`로 AST 기반 코드 패턴 검색 및 교체 (25개 언어 지원)
- **LSP 도구**: `ctf_lsp_goto_definition/find_references/diagnostics`로 LSP 기반 코드 탐색 및 진단
- **Doctor 도구**: `ctf_orch_doctor`로 환경 진단(서브에이전트/MCP/설정/노트 상태 종합 점검)
- **Slash 커맨드 도구**: `ctf_orch_slash`로 OpenCode의 슬래시 커맨드를 프로그래밍 방식으로 실행
- **Claude Skill 도구**: `ctf_orch_claude_skill_list/run`으로 설치된 Claude 스킬 목록 조회 및 실행
- **메트릭 조회 도구**: `ctf_orch_metrics`로 오케스트레이터 런타임 메트릭(디스패치 횟수/성공률/모델 상태 등) 조회
- 세션별 상태(`MODE`, `PHASE`, 정체/검증 신호) 추적 + 라우팅 결정 기록
- `.Aegis/*` 마크다운 노트 기록 + 예산 초과 시 자동 아카이브 회전
- 실패 자동 분류(7가지 유형) + 실패 카운트 추적
- 인젝션 감지(5가지 패턴) + SCAN에 로깅
- 시스템 프롬프트에 `MODE/PHASE/TARGET/NEXT_ROUTE` 자동 주입
- 내장 MCP 자동 등록(context7, grep_app, websearch, memory, sequential_thinking)

## 설치

### 한 번에 적용 (권장)

```bash
bun run setup
```

### npm으로 설치 (배포 후)

```bash
# 전역 설치
npm i -g oh-my-aegis
oh-my-aegis install

# 또는 1회 실행
npx -y oh-my-aegis install
```

또는 CLI 설치:

```bash
oh-my-aegis install
```

- TUI(tty)에서는 Google/OpenAI 연동 여부를 대화형으로 선택
- Non-TUI에서는 `auto` 기본값을 사용(신규 설치는 둘 다 `yes`, 기존 설치는 현재 구성 유지)
- 명시 옵션:

```bash
oh-my-aegis install --no-tui --gemini=yes --chatgpt=yes
# alias
oh-my-aegis install --no-tui --gemini=yes --openai=yes
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
    "/absolute/path/to/oh-my-Aegis/dist/index.js",
    "opencode-antigravity-auth@x.y.z",
    "opencode-openai-codex-auth@x.y.z"
  ]
}
```

`bun run setup` 또는 `oh-my-aegis install`은 아래를 함께 보정합니다.

- `oh-my-aegis@latest|@beta|@next|@x.y.z` 형식의 버전/태그 pin
- `opencode-antigravity-auth@x.y.z` (npm latest 조회 후 pin, 실패 시 `@latest`)
- `opencode-openai-codex-auth@x.y.z` (npm latest 조회 후 pin, 실패 시 `@latest`)
- `provider.google` / `provider.openai` 모델 카탈로그
- `default_agent`를 메인 오케스트레이터 `Aegis`로 설정
- 충돌 가능성이 높은 legacy 오케스트레이터 agent(`build`, `prometheus`, `hephaestus`) 및 MCP alias(`sequential-thinking`) 정리
- 기본 primary 오케스트레이터 `build`/`plan`은 `subagent + hidden`으로 내려 Aegis가 primary가 되도록 정리

```json
{
  "provider": {
    "google": {
      "name": "Google",
      "npm": "@ai-sdk/google",
      "models": {
        "antigravity-gemini-3-pro": {
          "name": "Gemini 3 Pro (Antigravity)",
          "attachment": true,
          "limit": {
            "context": 1048576,
            "output": 65535
          },
          "modalities": {
            "input": [
              "text",
              "image",
              "pdf"
            ],
            "output": [
              "text"
            ]
          },
          "variants": {
            "low": {
              "thinkingLevel": "low"
            },
            "high": {
              "thinkingLevel": "high"
            }
          }
        },
        "antigravity-gemini-3-flash": {
          "name": "Gemini 3 Flash (Antigravity)",
          "attachment": true,
          "limit": {
            "context": 1048576,
            "output": 65536
          },
          "modalities": {
            "input": [
              "text",
              "image",
              "pdf"
            ],
            "output": [
              "text"
            ]
          },
          "variants": {
            "minimal": {
              "thinkingLevel": "minimal"
            },
            "low": {
              "thinkingLevel": "low"
            },
            "medium": {
              "thinkingLevel": "medium"
            },
            "high": {
              "thinkingLevel": "high"
            }
          }
        }
      }
    },
    "openai": {
      "name": "OpenAI",
      "options": {
        "reasoningEffort": "medium",
        "reasoningSummary": "auto",
        "textVerbosity": "medium",
        "include": [
          "reasoning.encrypted_content"
        ],
        "store": false
      },
      "models": {
        "gpt-5.2-codex": {
          "name": "GPT 5.2 Codex (OAuth)"
        }
      }
    }
  }
}
```

마지막으로 readiness 점검을 실행합니다.

- `ctf_orch_readiness`

독립 실행형 오케스트레이터로 바로 실행하려면:

```bash
oh-my-aegis run --mode=CTF "challenge description"
oh-my-aegis get-local-version
```

## 사용방법

### 기본 흐름

1. **모드 명시(필수)**: 세션 시작 시 반드시 `MODE: CTF` 또는 `MODE: BOUNTY`를 메시지에 명시하거나, `ctf_orch_set_mode`를 먼저 호출합니다. 명시 전에는 오케스트레이션 로직이 동작하지 않습니다.

2. **자동 라우팅**: `task` 호출 시 오케스트레이터가 현재 상태(모드/페이즈/타겟/정체 신호)를 분석하여 최적의 서브에이전트를 자동 선택합니다. 사용자가 직접 `category`나 `subagent_type`을 지정할 수도 있습니다.

3. **페이즈 전이(CTF)**: `ctf_orch_event`로 이벤트를 전달하면 `SCAN → PLAN → EXECUTE` 페이즈가 자동 전이됩니다.

4. **상태 확인**: `ctf_orch_status`로 현재 모드, `mode_explicit` 상태, 페이즈, 타겟, 정체 신호, 다음 라우팅 결정을 확인할 수 있습니다.

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
| 고성능 추론 | `openai/gpt-5.3-codex` | aegis-exec, aegis-deep, ctf-web, ctf-web3, ctf-pwn, ctf-rev, ctf-crypto, ctf-solve, ctf-verify, bounty-scope, bounty-triage |
| 빠른 탐색/리서치 | `google/antigravity-gemini-3-flash` (variant 없음) | ctf-explore, ctf-research, ctf-forensics, ctf-decoy-check, bounty-research, md-scribe |
| 깊은 사고/계획 | `google/antigravity-gemini-3-pro` (variant 없음) | aegis-plan, ctf-hypothesis, deep-plan |
| 폴백 (explore) | `google/antigravity-gemini-3-flash` | explore-fallback |
| 폴백 (librarian/oracle) | `google/antigravity-gemini-3-pro` (variant 없음) | librarian-fallback, oracle-fallback |

모델 매핑은 `src/install/agent-overrides.ts`의 `AGENT_OVERRIDES`에서 커스터마이즈할 수 있습니다.

런타임에서 메인 오케스트레이터(Aegis)가 세션별로 특정 서브에이전트의 실행 프로필을 직접 고정할 수도 있습니다.

- 설정: `ctf_orch_set_subagent_profile subagent_type=<name> model=<provider/model> [variant=<variant>]`
- 조회: `ctf_orch_list_subagent_profiles`
- 해제: `ctf_orch_clear_subagent_profile subagent_type=<name>` (또는 인자 없이 전체 해제)

예시:

```text
ctf_orch_set_subagent_profile subagent_type=ctf-web model=google/antigravity-gemini-3-flash
```

추가로 `dynamic_model.enabled=true`일 때, rate limit/쿼터 오류가 감지되면 해당 모델을 일정 시간 동안 unhealthy로 표시하고 동일 subagent에 대체 `model/variant`를 주입합니다.

- 쿨다운: `dynamic_model.health_cooldown_ms` (기본 300000ms)
- 런타임에서 `task` 호출 시 Aegis가 `subagent_type + model + variant`를 함께 명시

지원 variant 기준:

- GPT(OpenAI): `low`, `medium`, `high`, `xhigh`
- Gemini Flash: variant 없음
- Gemini Pro: variant 없음
- Claude(Anthropic): `low`, `max`

### Google Antigravity OAuth

`google/antigravity-*` 모델을 사용할 때 필요한 Google OAuth를 플러그인에 내장합니다.

- `setup/install` 기본 동작:
  - npm 최신 버전 조회 후 `opencode-antigravity-auth@x.y.z`를 `plugin`에 자동 추가(조회 실패 시 `@latest`)
  - npm 최신 버전 조회 후 `opencode-openai-codex-auth@x.y.z`를 `plugin`에 자동 추가(조회 실패 시 `@latest`)
  - `provider.google` / `provider.openai` / `provider.anthropic` 카탈로그 자동 보정
- 기본 동작(auto): 외부 플러그인 `opencode-antigravity-auth`가 없으면 내장 OAuth 활성화, 있으면 중복 방지를 위해 비활성화
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
3. (task 호출 → SCAN: 자동으로 ctf-pwn 디스패치)
4. ctf_orch_event event=scan_completed
5. (task 호출 → PLAN: 자동으로 aegis-plan 디스패치; aegis-plan이 `plan_completed` 이벤트까지 반영)
6. (task 호출 → EXECUTE: 자동으로 aegis-exec 디스패치; 1 TODO 실행)
7. ctf_orch_event event=candidate_found candidate="..."
8. (자동 디코이 검증 → ctf-decoy-check → ctf-verify)
9. ctf_orch_status
```

### 병렬 스캔/가설(옵션)

SCAN 단계에서 2~3개의 트랙을 동시에 돌려 빠르게 탐색하고 싶다면:

```text
ctf_parallel_dispatch plan=scan challenge_description="..." max_tracks=3
ctf_parallel_status
ctf_parallel_collect message_limit=5
```

`ctf_parallel_dispatch` 이후에는 플러그인이 child 세션을 백그라운드로 폴링해 `idle` 트랙을 자동으로 `completed` 처리하고, 그룹 완료 시 부모 세션에 알림을 보냅니다.

- 토스트 알림: `tui_notifications.enabled=true`일 때만 표시
- 결과 조회: 알림이 와도 `ctf_parallel_collect`로 실제 결과를 가져옵니다

가설을 병렬로 반증하고 싶다면(배열 JSON 문자열 전달):

```text
ctf_parallel_dispatch \
  plan=hypothesis \
  hypotheses='[{"hypothesis":"...","disconfirmTest":"..."}]' \
  max_tracks=3
```

REV/PWN처럼 깊게 파고들어야 하는 문제에서 “목표만 주고 병렬 딥 워크”를 돌리고 싶다면:

```text
ctf_parallel_dispatch plan=deep_worker goal="..." max_tracks=5
ctf_parallel_status
ctf_parallel_collect message_limit=5
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

- 사용자: `~/.config/opencode/oh-my-Aegis.json` (또는 `$XDG_CONFIG_HOME/opencode/oh-my-Aegis.json`, Windows는 `%APPDATA%/opencode/oh-my-Aegis.json`; `.jsonc`도 지원)
- 프로젝트: `<project>/.Aegis/oh-my-Aegis.json` (또는 `.jsonc`, 프로젝트 설정이 사용자 설정을 덮어씀)

주요 설정:

| 키 | 기본값 | 설명 |
|---|---|---|
| `enabled` | `true` | 플러그인 활성화 |
| `enable_builtin_mcps` | `true` | 내장 MCP 자동 등록 (context7, grep_app, websearch, memory, sequential_thinking) |
| `google_auth` | `(unset)` | Google Antigravity OAuth 내장 auth hook 활성화. unset=auto(외부 `opencode-antigravity-auth` 없으면 on, 있으면 off; setup/install 기본 구성에서는 off); true=강제 on; false=강제 off |
| `disabled_mcps` | `[]` | 내장 MCP 비활성화 목록 (예: `["websearch", "memory"]`) |
| `default_mode` | `BOUNTY` | 기본 모드 |
| `stuck_threshold` | `2` | 정체 감지 임계치 |
| `dynamic_model.enabled` | `false` | 모델/쿼터 오류 시 동일 subagent에 대체 model/variant 프로필 자동 적용 (setup 사용 시 기본 활성화) |
| `dynamic_model.health_cooldown_ms` | `300000` | 모델 unhealthy 쿨다운 (ms) |
| `dynamic_model.generate_variants` | `true` | 동적 모델 failover 로직 사용 여부(하위 에이전트 추가 생성 없음) |
| `bounty_policy.scope_doc_candidates` | `[... ]` | BOUNTY 스코프 문서 자동 탐지 후보 경로 |
| `bounty_policy.enforce_allowed_hosts` | `true` | scope 문서 기반 호스트 allow/deny 강제 |
| `bounty_policy.enforce_blackout_windows` | `true` | blackout window 시간대 네트워크 명령 차단 |
| `bounty_policy.deny_scanner_commands` | `true` | 스캐너/자동화 명령 차단 |
| `auto_dispatch.enabled` | `true` | route → subagent 자동 디스패치 |
| `auto_dispatch.max_failover_retries` | `2` | 폴백 최대 재시도 횟수 |
| `skill_autoload.enabled` | `true` | subagent task 호출에 `load_skills` 자동 주입 |
| `skill_autoload.max_skills` | `2` | task 당 최대 skills 수(유저 지정 + 자동 로드 합산) |
| `ctf_fast_verify.enabled` | `true` | 저위험 후보 고속 검증 |
| `guardrails.deny_destructive_bash` | `true` | 파괴 명령 차단 |
| `target_detection.enabled` | `true` | 텍스트 기반 타겟 자동 감지 사용 |
| `target_detection.lock_after_first` | `true` | 타겟이 한 번 설정되면 세션 중간에 자동 변경 금지 |
| `target_detection.only_in_scan` | `true` | SCAN 페이즈에서만 타겟 자동 감지 허용 |
| `notes.root_dir` | `.Aegis` | 런타임 노트 디렉토리(예: `.Aegis` 또는 `.sisyphus`) |
| `memory.enabled` | `true` | 로컬 지식 그래프/메모리 도구 사용 여부 |
| `memory.storage_dir` | `.Aegis/memory` | 메모리 저장 디렉토리 (MCP memory도 이 경로 기준으로 `memory.jsonl` 생성) |
| `sequential_thinking.enabled` | `true` | Sequential thinking 기능 사용 여부 |
| `sequential_thinking.activate_phases` | `["PLAN"]` | 적용할 페이즈 목록 |
| `sequential_thinking.activate_targets` | `["REV","CRYPTO"]` | 적용할 타겟 목록 |
| `sequential_thinking.activate_on_stuck` | `true` | stuck 감지 시 자동 활성화 |
| `sequential_thinking.disable_with_thinking_model` | `true` | thinking 모델에서는 비활성화(중복 방지) |
| `sequential_thinking.tool_name` | `aegis_think` | 사용할 도구 이름 |
| `tool_output_truncator.per_tool_max_chars` | `{...}` | tool별 출력 트렁케이션 임계치 override (예: `{ "grep": 1000 }`) |
| `tui_notifications.enabled` | `false` | 병렬 완료/루프 상태 등 TUI 토스트 알림 활성화 |
| `tui_notifications.throttle_ms` | `5000` | 동일 알림 키 토스트 최소 간격(ms) |
| `recovery.enabled` | `true` | 복구 기능 전체 활성화 |
| `recovery.edit_error_hint` | `true` | Edit/patch 실패 시 re-read + 작은 hunk 재시도 가이드 주입 |
| `recovery.thinking_block_validator` | `true` | thinking 모델 출력의 깨진 `<thinking>` 태그를 자동 수정 |
| `recovery.non_interactive_env` | `true` | git -i, vim, nano 등 인터랙티브 명령 자동 차단 |
| `recovery.empty_message_sanitizer` | `true` | 빈 메시지 응답 시 자동 복구 문구 주입 |
| `recovery.auto_compact_on_context_failure` | `true` | context_length_exceeded 시 자동 아카이브 압축 |
| `recovery.session_recovery` | `true` | message.updated 기반 세션 복구(tool_result 누락 케이스). BOUNTY에서는 자동 재실행 억제 메시지 주입 |
| `recovery.context_window_recovery` | `true` | context length 초과 시 session.summarize 기반 자동 복구 |
| `recovery.context_window_recovery_cooldown_ms` | `15000` | context window 복구 최소 간격(ms) |
| `recovery.context_window_recovery_max_attempts_per_session` | `6` | 세션당 context window 복구 최대 시도 횟수 |
| `comment_checker.enabled` | `true` | 코드 패치의 과도한 주석/AI slop 마커 감지 |
| `comment_checker.only_in_bounty` | `true` | BOUNTY 모드에서만 활성화 |
| `comment_checker.max_comment_ratio` | `0.35` | 주석 비율 임계치 |
| `comment_checker.max_comment_lines` | `25` | 주석 줄 수 임계치 |
| `comment_checker.min_added_lines` | `12` | 검사 시작 최소 추가 줄 수 |
| `rules_injector.enabled` | `true` | `.claude/rules/*.md` 내용 자동 주입 |
| `rules_injector.max_files` | `6` | 주입 최대 파일 수 |
| `rules_injector.max_chars_per_file` | `3000` | 파일당 최대 문자 수 |
| `rules_injector.max_total_chars` | `12000` | 주입 총 최대 문자 수 |
| `context_injection.enabled` | `true` | `read` 시 상위 디렉토리 `AGENTS.md`/`README.md` 자동 주입 |
| `context_injection.inject_agents_md` | `true` | `AGENTS.md` 주입 여부 |
| `context_injection.inject_readme_md` | `true` | `README.md` 주입 여부 |
| `context_injection.max_files` | `6` | 주입 최대 파일 수 |
| `context_injection.max_chars_per_file` | `4000` | 파일당 최대 문자 수 |
| `context_injection.max_total_chars` | `16000` | 주입 총 최대 문자 수 |
| `claude_hooks.enabled` | `false` | Claude 호환 PreToolUse/PostToolUse 훅 실행 |
| `claude_hooks.max_runtime_ms` | `5000` | 훅 실행 최대 시간(ms) |
| `parallel.queue_enabled` | `true` | 병렬 task 큐 활성화 |
| `parallel.max_concurrent_per_provider` | `2` | provider별 동시 실행 상한 |
| `parallel.provider_caps` | `{}` | provider별 동시 실행 override |
| `parallel.auto_dispatch_scan` | `false` (install writes `true`) | CTF SCAN 단계에서 병렬 디스패치 자동 위임 |
| `parallel.auto_dispatch_hypothesis` | `false` (install writes `true`) | CTF 가설 피벗 구간에서 병렬 가설 트랙 자동 위임 |
| `markdown_budget.worklog_lines` | `300` | WORKLOG.md 최대 줄 수 |
| `markdown_budget.worklog_bytes` | `24576` | WORKLOG.md 최대 바이트 |
| `markdown_budget.evidence_lines` | `250` | EVIDENCE.md 최대 줄 수 |
| `markdown_budget.evidence_bytes` | `20480` | EVIDENCE.md 최대 바이트 |
| `markdown_budget.scan_lines` | `200` | SCAN.md 최대 줄 수 |
| `markdown_budget.scan_bytes` | `16384` | SCAN.md 최대 바이트 |
| `markdown_budget.context_pack_lines` | `80` | CONTEXT_PACK.md 최대 줄 수 |
| `markdown_budget.context_pack_bytes` | `8192` | CONTEXT_PACK.md 최대 바이트 |
| `verification.verifier_tool_names` | `[...]` | 검증 결과 감지 대상 도구 이름 목록 |
| `verification.verifier_title_markers` | `[...]` | 검증 결과 감지 대상 타이틀 마커 목록 |
| `auto_loop.enabled` | `true` | 플러그인 레벨 자동 루프 활성화 |
| `auto_loop.only_when_ultrawork` | `true` | ultrawork 모드에서만 자동 루프 |
| `auto_loop.idle_delay_ms` | `350` | idle 감지 후 프롬프트 주입 지연(ms) |
| `auto_loop.max_iterations` | `200` | 자동 루프 최대 반복 횟수 |
| `auto_loop.stop_on_verified` | `true` | CTF에서 verify_success 시 자동 루프 종료 |
| `enforce_todo_single_in_progress` | `true` | todowrite에서 in_progress 항목을 1개로 강제 정규화 |
| `enforce_mode_header` | `false` | MODE 헤더 미선언 시 시스템이 자동 주입 |
| `allow_free_text_signals` | `false` | ultrawork 외에서도 free-text 이벤트 신호 허용 |
| `enable_injection_logging` | `true` | 인젝션 감지 결과를 SCAN에 로깅 |
| `auto_triage.enabled` | `true` | 챌린지 파일 자동 트리아지 활성화 |
| `flag_detector.enabled` | `true` | 도구 출력에서 플래그 패턴 자동 탐지 |
| `flag_detector.custom_patterns` | `[]` | 커스텀 플래그 패턴 정규식 배열 (예: `["myctf{.*}"]`) |
| `pattern_matcher.enabled` | `true` | 알려진 CTF 패턴 자동 매칭 |
| `recon_pipeline.enabled` | `true` | BOUNTY 정찰 파이프라인 활성화 |
| `recon_pipeline.max_commands_per_phase` | `10` | 페이즈당 최대 명령어 수 |
| `delta_scan.enabled` | `true` | 델타 스캔(스냅샷 비교) 활성화 |
| `delta_scan.max_age_ms` | `86400000` | 스캔 스냅샷 최대 유효 기간(ms, 기본 24시간) |
| `report_generator.enabled` | `true` | 리포트/writeup 자동 생성 활성화 |

### Skill 자동 로드

- 탐색 경로: `~/.config/opencode/skills/`, `./.opencode/skills/`, `./.claude/skills/`
- 매핑: `skill_autoload.(ctf|bounty).(scan|plan|execute).<TARGET>` + `skill_autoload.by_subagent["<subagent>"]`
- 자동 로드는 설치된 스킬만 주입(유저가 직접 지정한 `load_skills`는 유지)
- 기본 매핑은 `src/config/schema.ts`의 `DEFAULT_SKILL_AUTOLOAD` 참고

예시:

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

전체 설정 스키마는 `src/config/schema.ts`를 참고하세요.

## 제공 도구

### 오케스트레이션 제어

| 도구 | 설명 |
|---|---|
| `ctf_orch_status` | 현재 상태 + 라우팅 결정 |
| `ctf_orch_set_mode` | `CTF` 또는 `BOUNTY` 모드 설정 |
| `ctf_orch_set_subagent_profile` | 세션 단위 서브에이전트 model/variant 오버라이드 설정 |
| `ctf_orch_clear_subagent_profile` | 세션 단위 서브에이전트 model/variant 오버라이드 해제 |
| `ctf_orch_list_subagent_profiles` | 세션 단위 서브에이전트 model/variant 오버라이드 조회 |
| `ctf_orch_set_ultrawork` | ultrawork 모드 토글 |
| `ctf_orch_set_autoloop` | autoloop 토글 |
| `ctf_orch_event` | 이벤트 반영(후보/가설/타겟 포함 가능) |
| `ctf_orch_next` | 다음 추천 라우팅 |
| `ctf_orch_metrics` | 오케스트레이터 런타임 메트릭 조회(디스패치 횟수/성공률/모델 상태 등) |

### 실패 대응 / 진단

| 도구 | 설명 |
|---|---|
| `ctf_orch_failover` | 에러 텍스트 기반 폴백 에이전트 조회 |
| `ctf_orch_postmortem` | 실패 원인 요약 + 다음 추천 |
| `ctf_orch_check_budgets` | 마크다운 예산 점검 |
| `ctf_orch_compact` | 즉시 회전/압축 |
| `ctf_orch_readiness` | 필수 서브에이전트/MCP/쓰기 권한 점검 |
| `ctf_orch_doctor` | 환경 종합 진단(서브에이전트/MCP/설정/노트 상태) |

### Exploit 템플릿

| 도구 | 설명 |
|---|---|
| `ctf_orch_exploit_template_list` | 내장 exploit 템플릿 목록(PWN/CRYPTO/WEB/REV/FORENSICS, 26개) |
| `ctf_orch_exploit_template_get` | 내장 exploit 템플릿 조회(PWN/CRYPTO/WEB/REV/FORENSICS) |

### 병렬 실행

| 도구 | 설명 |
|---|---|
| `ctf_parallel_dispatch` | 병렬 child 세션 디스패치(SCAN/가설/deep_worker) |
| `ctf_parallel_status` | 병렬 트랙 상태 조회 |
| `ctf_parallel_collect` | 병렬 결과 수집(선택: winner 지정 시 나머지 abort) |
| `ctf_parallel_abort` | 병렬 트랙 전체 중단 |

### 세션 관리

| 도구 | 설명 |
|---|---|
| `ctf_orch_session_list` | OpenCode 세션 목록 조회 |
| `ctf_orch_session_read` | 세션 메시지 읽기 |
| `ctf_orch_session_search` | 세션 내 텍스트 검색 |
| `ctf_orch_session_info` | 세션 메타데이터/통계 조회 |

### 메모리(지식 그래프)

| 도구 | 설명 |
|---|---|
| `aegis_memory_save` | 지식 그래프에 엔티티/관계 저장 |
| `aegis_memory_search` | 지식 그래프 검색 |
| `aegis_memory_list` | 지식 그래프 전체 조회 |
| `aegis_memory_delete` | 지식 그래프 엔티티 삭제 |

### 사고(Thinking)

| 도구 | 설명 |
|---|---|
| `aegis_think` | Sequential thinking 도구. PLAN/REV/CRYPTO 페이즈 및 stuck 감지 시 자동 활성화 |

### PTY 관리

| 도구 | 설명 |
|---|---|
| `ctf_orch_pty_create` | PTY 세션 생성(exploit 실행, 디버거 연결 등) |
| `ctf_orch_pty_list` | PTY 세션 목록 |
| `ctf_orch_pty_get` | PTY 세션 조회 |
| `ctf_orch_pty_update` | PTY 세션 업데이트 |
| `ctf_orch_pty_remove` | PTY 세션 제거 |
| `ctf_orch_pty_connect` | PTY 세션 연결 |

### Claude Skill / Slash 커맨드

| 도구 | 설명 |
|---|---|
| `ctf_orch_claude_skill_list` | 설치된 Claude 스킬 목록 조회 |
| `ctf_orch_claude_skill_run` | Claude 스킬 실행 |
| `ctf_orch_slash` | OpenCode 슬래시 커맨드 실행 |

### AST-grep / LSP

| 도구 | 설명 |
|---|---|
| `ctf_ast_grep_search` | AST 기반 코드 패턴 검색(25개 언어 지원) |
| `ctf_ast_grep_replace` | AST 기반 코드 패턴 교체 |
| `ctf_lsp_goto_definition` | LSP 정의 이동 |
| `ctf_lsp_find_references` | LSP 참조 찾기 |
| `ctf_lsp_diagnostics` | LSP 진단 메시지(에러/워닝) |

### 속도 최적화(Speed)

| 도구 | 설명 |
|---|---|
| `ctf_auto_triage` | 챌린지 파일 자동 트리아지: 타입 감지 → 타겟 추천 → 스캔 명령 생성 |
| `ctf_flag_scan` | 텍스트에서 플래그 패턴 스캔 + 후보 관리(15가지 기본 포맷 + 커스텀) |
| `ctf_pattern_match` | 알려진 CTF 패턴 매칭(41개 패턴, 5개 도메인) |
| `ctf_recon_pipeline` | BOUNTY 4단계 정찰 파이프라인 자동 계획 |
| `ctf_delta_scan` | 스캔 스냅샷 저장/비교/재스캔 판단 |
| `ctf_tool_recommend` | 타겟 타입별 보안 도구 + 명령어 추천 |
| `ctf_libc_lookup` | Libc 버전 식별 + offset 추출 + base 주소 계산 |
| `ctf_env_parity` | 로컬-리모트 환경 패리티 체크 + patchelf 명령 생성 |
| `ctf_report_generate` | CTF writeup / BOUNTY 리포트 자동 생성 |
| `ctf_subagent_dispatch` | aegis-explore/aegis-librarian 서브에이전트 디스패치 플랜 |

## 개발/검증

```bash
bun run typecheck
bun test
bun run build
bun run doctor
```

### npm publish 전 체크리스트

- 로컬 게이트 통과: `bun run typecheck && bun test && bun run build && bun run doctor`
- 빌드 산출물 동기화 확인: `git diff --exit-code -- dist`
- 패키지 구성 확인: `npm pack --dry-run`
- 버전/태그 준비: `package.json` 버전, 릴리즈 노트, git tag 계획 확인
- 권한 확인: `npm whoami` 성공 + 퍼블리시 권한 계정 사용
- CI 퍼블리시 사용 시 `NPM_TOKEN` 설정 확인 (`.github/workflows/publish.yml`)
- 최종 퍼블리시: `npm publish --provenance --access public`

## 운영 메모

- 세션 상태: `.Aegis/orchestrator_state.json`
- 런타임 노트: 기본 `.Aegis/*` (설정 `notes.root_dir`로 변경 가능)
- Memory 저장소는 2개가 공존할 수 있습니다.
- MCP memory 서버: `<memory.storage_dir>/memory.jsonl` (`MEMORY_FILE_PATH`), JSONL 포맷
- Aegis 로컬 그래프 스냅샷: `<memory.storage_dir>/knowledge-graph.json` (`aegis_memory_*` 도구가 사용)

## 문서

- 런타임 워크플로우 요약: `docs/runtime-workflow.md`
- CTF/BOUNTY 운영 계약(원문): `docs/ctf-bounty-contract.md`
- 커버리지/경계 노트: `docs/workflow_coverage.md`
- readiness 로드맵: `docs/perfect-readiness-roadmap.md`
