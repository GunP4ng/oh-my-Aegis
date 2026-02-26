# oh-my-Aegis

OpenCode용 CTF/BOUNTY 오케스트레이션 플러그인입니다. 세션 상태/루프 신호를 노트 디렉토리(기본 `.Aegis/*`)에 남기고, 현재 상황에 맞는 다음 서브에이전트를 라우팅합니다.

독립 실행형 오케스트레이터 아키텍처/운영 경계는 `docs/standalone-orchestrator.md`를 참고하세요.

## 빠른 시작 (설치 / 업데이트 / 검사)

### A) npm 미배포/404일 때 (로컬 소스 기준)

```bash
# 1) 의존성 + 빌드 + 설정 적용
bun run setup

# 2) 검사
bun run doctor
bun run typecheck && bun test && bun run build
```

### B) npm 배포 후

```bash
# 1) 설치 (전역 설치 없이 바로 실행)
npx -y oh-my-aegis install

# 2) 업데이트 (수동)
# - npm 설치 사용자: npm install -g oh-my-aegis@latest
# - git 체크아웃 설치 사용자: npx -y oh-my-aegis update
npm install -g oh-my-aegis@latest
npx -y oh-my-aegis update

# 3) 검사
npx -y oh-my-aegis doctor
npx -y oh-my-aegis doctor --json
npx -y oh-my-aegis readiness
```

전역 설치를 쓸 경우에만 `oh-my-aegis ...`를 바로 실행할 수 있습니다.

```bash
npm i -g oh-my-aegis
oh-my-aegis install
oh-my-aegis update
```

- `doctor` 기본 출력은 사람이 읽기 쉬운 요약 형식이며, 기계 파싱이 필요하면 `doctor --json`을 사용하세요.
- Git 체크아웃 설치에서는 `install/run/doctor/readiness/get-local-version` 실행 시 자동 업데이트 체크를 수행합니다.
- 원격이 앞서 있고 로컬 작업트리가 깨끗하면 `git pull --ff-only` + `bun run build`를 자동 수행합니다.
- 자동 업데이트 비활성화: `AEGIS_AUTO_UPDATE=0`
- 자동 체크 간격(분): `AEGIS_AUTO_UPDATE_INTERVAL_MINUTES` (기본 360분)

## 주요 기능

### CTF

- **5단계 페이즈 관리**: `SCAN → PLAN → EXECUTE → VERIFY → SUBMIT` 자동 전이
- **8개 타겟 전용 라우팅**: `WEB_API`, `WEB3`, `PWN`, `REV`, `CRYPTO`, `FORENSICS`, `MISC`, `UNKNOWN` 각각 전용 scan/plan/execute/stuck/failover 경로
- **Heuristic 기반 자동 페이즈 전환**: 에이전트가 `ctf_orch_event`를 수동 호출하지 않아도 오케스트레이터가 자동으로 페이즈를 승격. `SCAN → PLAN`: 도구 호출 누적 카운터가 임계치(`auto_phase.scan_to_plan_tool_count`, 기본 8회)를 초과하면 자동 전환. `PLAN → EXECUTE`: `todowrite` 도구 호출 감지 시 자동 전환 (`auto_phase.plan_to_execute_on_todo`, 기본 true)
- **도구 호출 추적**: 세션별 총 도구 호출 수(`toolCallCount`), Aegis 도구 호출 수(`aegisToolCallCount`), 최근 20개 호출 히스토리(`toolCallHistory`)를 추적하여 stuck 감지 및 자동 페이즈 전환에 활용
- **정체(stuck) 감지 + 자동 피벗**: `noNewEvidenceLoops`, `samePayloadLoops`, `verifyFailCount` 기반 임계치 초과 시 자동 전환 (`stuck_threshold` 설정 가능). 추가로 연속 15회 비Aegis 도구 호출 + Aegis 도구 미사용 감지 시 `no_new_evidence` 이벤트 자동 발생. 최근 5개 도구가 동일 패턴이면 `staleToolPatternLoops` 증가 및 경고 주입
- **실패 기반 적응 라우팅**: `context_overflow`, `verification_mismatch`, `tooling_timeout`, `exploit_chain`, `hypothesis_stall` 5가지 유형 자동 감지 + 대응 경로 선택
- **디코이 검증 파이프라인**: `ctf-decoy-check → ctf-verify` 2단계 검증, 리스크 평가 기반 고속 검증 fast-path 지원
- **자동 디스패치 + 폴백**: route → subagent 매핑, rate limit/timeout 시 자동 폴백 전환 (설정으로 재시도 횟수 조절)
- **도메인별 플레이북 주입**: `task` 호출 시 타겟/모드에 맞는 규칙을 prompt에 자동 삽입. 도메인별 조건부 규칙(WEB_API: SQLi blind 우선/SSRF 내부매핑, WEB3: reentrancy 체크/proxy storage, CRYPTO: factordb 우선/테스트 벡터 교차검증, FORENSICS: chain-of-custody 해시/복수 추출 도구, MISC: 다계층 디코딩/2회 가설 제한)
- **도메인 에이전트 시스템 프롬프트 자동 주입**: 17개 서브에이전트(CTF 도메인 7 + 공용 5 + BOUNTY 3 + 유틸 2)에 도메인 전문 워크플로우/필수 도구/금지 행동/검증 기준을 포함한 시스템 프롬프트와 권한 프로필을 `applyRequiredAgents()` 단계에서 자동 주입
- **오케스트레이션 컨텍스트 강화 시스템 프롬프트 주입**: `experimental.chat.system.transform` 훅에서 메인 에이전트에게 현재 phase별 행동 지침(`buildPhaseInstruction`), 감지된 신호 기반 행동 가이던스(`buildSignalGuidance`), phase별 가용 Aegis 도구 목록(`buildToolGuide`), 전체 플레이북 규칙을 자동으로 주입. 에이전트가 `ctf_*`/`aegis_*` 도구의 존재를 인식하고 자발적으로 사용하도록 유도
- **Signal → Action 매핑**: 감지된 신호가 즉시 에이전트 행동 지침으로 변환됨. `revVmSuspected=true` → 정적 분석 불신 + `ctf_rev_loader_vm_detect` 사용 권고. `decoySuspect=true` → `ctf_decoy_guard` 실행 요청. `verifyFailCount >= 2` → 디코이 의심 자동 경고. `aegisToolCallCount === 0` → Aegis 도구 사용 강제 안내. `noNewEvidenceLoops >= 1` → 접근법 전환 요구
- **사전 디코이 감지(Early Decoy Detection)**: VERIFY 단계까지 기다리지 않고 모든 도구 출력(200KB 이하)에서 flag 패턴을 즉시 스캔. flag-like 문자열 발견 시 즉시 `checkForDecoy` 실행 + `decoySuspect` 플래그 설정 + toast 알림. 오라클 검증 전이라도 디코이 조기 탐지 가능
- **도메인별 위험 평가**: 도구 출력에서 도메인별 취약점 패턴을 자동 감지하여 리스크 스코어 산출. WEB_API(SSTI/SQLi/SSRF/XSS/LFI/역직렬화/인증우회/IDOR), WEB3(재진입/오라클조작/접근제어/스토리지충돌/서명리플레이), CRYPTO(약한RSA/패딩오라클/ECB/약한해시/약한난수), FORENSICS(스테가노/숨겨진파티션/타임스탬프변조/메모리아티팩트/PCAP/파일카빙), MISC(인코딩체인/OSINT/난해한언어/QR바코드/논리퍼즐) 패턴 지원
- **도메인별 검증 게이트**: 플래그 후보 검증 시 도메인별 필수 증거를 요구. PWN/REV(Oracle + ExitCode 0 + 환경패리티), WEB_API(Oracle + HTTP 응답 증거), WEB3(Oracle + 트랜잭션 해시/시뮬레이션), CRYPTO(Oracle + 테스트 벡터 매칭), FORENSICS(Oracle + 아티팩트 해시), MISC(Oracle 필수). 미충족 시 `verify_success` 차단
- **도메인별 모순 처리 + Stuck 탈출**: `static_dynamic_contradiction` 발생 시 도메인별 전용 에이전트로 피벗(WEB→`ctf-web`, CRYPTO→`ctf-crypto`, FORENSICS→`ctf-forensics` 등). Decoy Guard/Contradiction SLA도 도메인별 구체 가이던스 제공. Stuck 감지 시 도메인별 탈출 전략 자동 주입(WEB: 공격벡터 전환, CRYPTO: 암호시스템 재식별, FORENSICS: 분석 레이어 전환 등)
- **도메인별 CTF 리콘 전략**: `planDomainRecon()`으로 7개 도메인별 정찰 계획 자동 생성. WEB(스택핑거프린팅+공격면), WEB3(컨트랙트분석+상태분석), PWN(바이너리분석+취약점분류), REV(구조분석+로직맵핑), CRYPTO(파라미터추출+오라클분석), FORENSICS(파일분석+타임라인메타데이터), MISC(포맷감지+컨텍스트단서)
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
- **초반 병렬 SCAN 자동 위임(옵션)**: `parallel.auto_dispatch_scan=true`이고 `scope_confirmed` 이후 SCAN 단계면 `ctf_parallel_dispatch plan=scan`을 자동 주입해 BOUNTY 하위 트랙을 병렬 실행

### 공통

- **명시적 모드 활성화(required)**: `MODE: CTF`/`MODE: BOUNTY` 또는 `ctf_orch_set_mode`를 실행하기 전까지 오케스트레이터는 비활성 상태입니다. 비활성 상태에서는 `ctf_*`/`aegis_*` 도구(예외: `ctf_orch_set_mode`, `ctf_orch_status`)를 실행할 수 없습니다.
- **에이전트별 최적 모델 자동 선택 + 모델 failover**: 역할별 기본 모델 매핑 + rate limit/쿼터 오류(429 등) 감지 시 subagent는 유지하고 `model/variant`만 대체 프로필로 자동 전환
- **Ultrawork 키워드 지원**: 사용자 프롬프트에 `ultrawork`/`ulw`가 포함되면 세션을 ultrawork 모드로 전환(연속 실행 자세 + 추가 free-text 신호 + CTF todo continuation)
- **Aegis 오케스트레이터 + Aegis 서브에이전트 자동 주입**: runtime config에 `agent.Aegis`가 없으면 자동으로 추가. 이미 `agent.Aegis`가 있어도 manager 안전 정책은 강제(`mode=primary`, `hidden=false`, `edit/bash/webfetch=deny`). 추가로 `aegis-plan`/`aegis-exec`/`aegis-deep`/`aegis-explore`/`aegis-librarian`도 자동 주입하며, 내부 서브에이전트는 `mode=subagent` + `hidden=true`로 고정되어 선택 메뉴에는 메인 `Aegis`만 노출
- **서브에이전트 권한 하드 경계**: `aegis-explore`는 실행 도구(`edit/bash/webfetch`)를 모두 deny하고, `aegis-librarian`는 외부 참조 수집에 필요한 `webfetch`만 허용(`edit/bash` deny)
- **Aegis Exec 재귀 방지 가드**: `aegis-exec` 문맥에서 `task` 호출 시 `subagent_type` 미지정 요청은 런타임 pre-hook에서 하드 차단
- **Aegis Explore 서브에이전트**: 코드베이스/로컬 파일 탐색 전용 에이전트. 패턴 검색, 디렉토리 구조 분석, 파일 내용 grep을 구조화된 결과로 반환
- **Aegis Librarian 서브에이전트**: 외부 참조 검색 전용 에이전트. CVE/Exploit-DB/공식 문서/OSS writeup을 검색하여 공격 벡터 및 best practice 정보 제공
- **계획/실행 분리**: `PLAN`은 `aegis-plan`, `EXECUTE`는 `aegis-exec`로 기본 라우팅(PLAN 출력은 `.Aegis/PLAN.md`로 저장)
- **딥 워커(REV/PWN)**: stuck 피벗 시 `aegis-deep`로 전환 가능(병렬 `deep_worker` 플랜으로 2~5개 트랙 탐색)
- **Skill 자동 로드(opencode skills)**: `MODE/PHASE/TARGET(+subagent)` 매핑에 따라 `task` 실행 직전(pre-hook)마다 `load_skills`를 자동 병합 주입 (`skill_autoload.*`)
- **Claude 호환 훅 브리지**: 워크스페이스 `.claude/hooks/PreToolUse(.sh/.bash)`/`PostToolUse(.sh/.bash)`를 실행. Pre 훅 비정상 종료는 실행 차단(deny), Post 훅 실패는 soft-fail로 `SCAN.md`에 기록
- **Think/Ultrathink 안전장치**: stuck 기반 auto-deepen은 세션당 최대 3회
- **Non-Interactive 환경 가드**: `git rebase -i`, `vim`, `nano`, `python` REPL, `| less` 등 인터랙티브 명령을 자동 감지하여 차단, headless 환경에서의 무한 대기 방지 (`recovery.non_interactive_env`)
- **Thinking Block Validator**: thinking 모델의 깨진 `<thinking>` 태그(미닫힘/고아 태그/접두사 누출)를 자동 수정하여 다운스트림 파싱 에러 방지 (`recovery.thinking_block_validator`)
- **Edit Error Recovery**: edit/patch 적용 실패 시 re-read + 작은 hunk 재시도 가이드를 자동 주입 (`recovery.edit_error_hint`)
- **Session Recovery**: `tool_use`는 있는데 `tool_result`가 누락된 경우(크래시/중단 등) synthetic `tool_result`를 주입해 세션을 복구. BOUNTY에서는 “실행 여부 불명”으로 처리하고 자동 재실행을 억제 (`recovery.session_recovery`)
- **Context Window Recovery**: context length 초과 감지 시 `session.summarize`를 호출해 대화를 요약하고 재시도를 유도 (`recovery.context_window_recovery`)
- **Proactive Context Budget Recovery**: assistant `message.updated`에서 컨텍스트 사용량이 임계치(기본 90%)를 넘으면 선제적으로 notes compaction + `session.summarize`를 수행하고, continuation prompt를 주입해 manager-mode(하위 task 위임 중심)를 유지. 재arm 임계치(기본 75%) 아래로 내려가면 다음 선제 복구를 다시 허용 (`recovery.context_window_proactive_*`)
- **도구 출력 트렁케이션 + 아티팩트 저장**: 출력이 너무 길면 자동으로 잘라서 컨텍스트 폭주를 막고, 원문은 `.Aegis/artifacts/tool-output/*`에 저장 (tool별 임계치 설정 지원)
- **Exploit 템플릿 라이브러리**: `ctf_orch_exploit_template_list/get`으로 PWN/CRYPTO/WEB/WEB3/REV/FORENSICS/MISC 7개 도메인 39개 템플릿을 빠르게 조회 (WEB3: flash-loan/delegatecall/storage-collision/approval-abuse, REV: anti-debug/unpacking/dynamic-instrumentation/constraint-solving, FORENSICS: PCAP-reconstruction/disk-timeline/registry, MISC: encoding-chain-solver/QR-barcode 포함)
- **챌린지 파일 자동 트리아지**: `ctf_auto_triage`로 파일 타입 감지 → 타겟 타입 추천 → 스캔 명령어 자동 생성 (ELF/archive/image/pcap/pdf/script 지원). ELF의 경우 `readelf -S/-r` + `binwalk`로 REV Loader/VM 패턴(.rela.*/커스텀 섹션/embedded ELF) 자동 감지
- **플래그 자동 탐지**: 도구 출력에서 15가지 플래그 포맷(`flag{}`, `CTF{}`, `picoCTF{}`, `htb{}` 등)을 자동 스캔하여 후보 알림 + 커스텀 패턴 지원 (`flag_detector.*`). Decoy Guard 연동: 후보 발견 + 오라클 실패 시 자동 `DECOY_SUSPECT` 설정. Replay Safety Rule 연동: memfd/relocation 의존 바이너리의 standalone 재실행 결과를 자동 low-trust 태깅
- **CTF 패턴 매처**: `ctf_pattern_match`로 41가지 알려진 CTF 패턴(PWN/WEB/CRYPTO/REV/FORENSICS) 자동 매칭 → 공격 경로 추천
- **Libc 데이터베이스**: `ctf_libc_lookup`으로 leaked 함수 주소 → libc 버전 식별 + useful offset 추출 + libc.rip URL 빌더
- **보안 도구 추천**: `ctf_tool_recommend`로 타겟 타입별 추천 도구 + 명령어 자동 생성. PWN(checksec/ROPgadget/one_gadget/patchelf), REV(checksec/binwalk/exiftool), WEB_API(nuclei/sqlmap/ffuf/curl/jwt_tool), WEB3(nuclei/slither/forge/cast), CRYPTO(RsaCtfTool/z3), FORENSICS(binwalk/exiftool/volatility3/foremost/tshark), MISC(binwalk/exiftool/zsteg/steghide)
- **환경 패리티 체크**: `ctf_env_parity`로 Dockerfile/ldd 파싱 → 로컬-리모트 libc/링커/아키텍처 차이 감지 + patchelf 명령 자동 생성. 도메인별 환경 체크: WEB_API(curl/httpie/sqlmap/node/php), WEB3(node/forge/cast/solc/slither), CRYPTO(python/sage/openssl/pycryptodome/gmpy2), FORENSICS(volatility3/binwalk/foremost/exiftool/tshark/sleuthkit), MISC(python/stegsolve/zsteg/steghide)
- **리포트 자동 생성**: `ctf_report_generate`로 WORKLOG/EVIDENCE 기반 CTF writeup 또는 BOUNTY 리포트 자동 생성
- **디렉토리 컨텍스트 주입**: `read`로 파일을 열 때, 상위 디렉토리의 `AGENTS.md`/`README.md`를 자동으로 주입(최대 파일/용량 제한)
- **컴팩션 컨텍스트 강화**: 세션 컴팩션 시 `.Aegis/CONTEXT_PACK.md`를 자동으로 compaction prompt에 포함
- **Comment Checker**: edit/write 출력에서 코드 패치의 과도한 주석 비율 및 AI slop 마커(`as an ai`, `chatgpt`, `generated by` 등)를 감지하여 경고 주입 (`comment_checker.*`)
- **Think/Ultrathink 모드**: 사용자 프롬프트에 `think`/`ultrathink` 키워드가 포함되면 해당 세션의 `task` 호출에 `openai/gpt-5.2` + `xhigh`를 자동 적용. stuck 감지 시 auto-deepen(세션당 최대 3회)
- **PTY 관리 도구**: `ctf_orch_pty_create/list/get/update/remove/connect`로 대화형 프로세스(exploit 실행, 디버거 연결 등)를 관리
- **세션 관리 도구**: `ctf_orch_session_list/read/search/info`로 OpenCode 세션 이력을 조회/검색
- **AST-grep 도구**: `ctf_ast_grep_search/replace`로 AST 기반 코드 패턴 검색 및 교체 (25개 언어 지원)
- **LSP 도구**: `ctf_lsp_goto_definition/find_references/diagnostics`로 LSP 기반 코드 탐색 및 진단
- **Doctor 도구**: `ctf_orch_doctor`로 환경 진단(서브에이전트/MCP/설정/노트 상태 종합 점검)
- **Slash 커맨드 도구**: `ctf_orch_slash`로 OpenCode의 슬래시 커맨드를 프로그래밍 방식으로 실행
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

> `npm view oh-my-aegis version`가 404이면 아직 npm 배포 전 상태입니다. 이 경우 위의 로컬 소스 설치(`bun run setup`)를 사용하세요.

```bash
# 전역 설치
npm i -g oh-my-aegis
oh-my-aegis install

# 또는 1회 실행
npx -y oh-my-aegis install
```

### Windows에서 `'oh-my-aegis'은(는) ... 아닙니다`가 나올 때

```bat
:: 1) 전역 설치 없이 실행(권장)
npx -y oh-my-aegis install

:: 2) 전역 설치를 쓸 경우
npm i -g oh-my-aegis
oh-my-aegis install
```

- `npm i -g` 후에도 명령을 못 찾으면 새 터미널을 열고 다시 시도하세요.
- `npm config get prefix`로 전역 경로를 확인하고, Windows PATH에 npm global bin(보통 `%AppData%\npm`)이 포함되어 있는지 확인하세요.

전역 설치를 이미 완료했다면 CLI를 직접 실행할 수 있습니다:

```bash
oh-my-aegis install
```

- TUI(tty)에서는 Google/OpenAI 연동 여부를 대화형으로 선택
- Non-TUI에서는 `auto` 기본값을 사용(신규 설치는 둘 다 `yes`, 기존 설치는 현재 구성 유지)
- 명시 옵션:

```bash
# global 설치 사용자
oh-my-aegis install --no-tui --gemini=yes --chatgpt=yes

# global 설치 없이 1회 실행
npx -y oh-my-aegis install --no-tui --gemini=yes --chatgpt=yes

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
    "opencode-openai-codex-auth@x.y.z"
  ]
}
```

`bun run setup` 또는 `oh-my-aegis install`은 아래를 함께 보정합니다.

- `oh-my-aegis@latest|@beta|@next|@x.y.z` 형식의 버전/태그 pin
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
        "gemini-2.5-pro": {
          "name": "Gemini 2.5 Pro",
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
        "gemini-2.5-flash": {
          "name": "Gemini 2.5 Flash",
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

3. **페이즈 전이(CTF)**: 오케스트레이터가 도구 호출 패턴을 기반으로 페이즈를 자동 승격합니다(heuristic 전환). 직접 전이하려면 `ctf_orch_event`로 이벤트를 전달하세요. 자동 전환: SCAN 중 분석 도구 N회 이상 호출 시 PLAN으로, PLAN 중 `todowrite` 호출 시 EXECUTE로 자동 전이됩니다.

4. **상태 확인**: `ctf_orch_status`로 현재 모드, `mode_explicit` 상태, 페이즈, 타겟, 정체 신호, 다음 라우팅 결정을 확인할 수 있습니다.

5. **실패 대응**: 에이전트 실패 시 `ctf_orch_failover`로 폴백 에이전트를 조회하거나, `ctf_orch_postmortem`로 실패 원인 분석 + 다음 추천을 받습니다.

### Ultrawork 모드

oh-my-opencode처럼 “계속 굴러가게” 만들고 싶다면, 아래 중 하나로 ultrawork 모드를 켤 수 있습니다.

- **키워드로 활성화**: 사용자 프롬프트에 `ultrawork` 또는 `ulw` 포함
  - 예: `ulw ctf pwn challenge`
- **도구로 활성화**: `ctf_orch_set_ultrawork enabled=true`

ultrawork 모드에서 적용되는 동작(핵심만):

- free-text 신호 처리 강화: `scan_completed`, `plan_completed`, `verify_success`, `verify_fail` 같은 이벤트 이름을 텍스트로 보내도 상태 이벤트로 반영
- CTF에서 `verify_success` 이전에 todos를 모두 `completed/cancelled`로 닫으려 하면, 자동으로 pending TODO를 추가해 루프를 이어가도록 강제(복수 pending 허용, `in_progress`는 1개)
- SCAN 제외(PLAN/EXECUTE) 단계에서는 TODO 흐름을 강제 검증: 완료 업데이트 후 다음 pending TODO를 `in_progress`로 승격하고, TODO 세트 최소 개수(기본 2개)를 유지

### 모델 자동 선택

`bun run setup` 실행 시 각 서브에이전트에 역할에 맞는 모델이 자동 매핑됩니다:

| 역할 | 모델 | 대상 에이전트 |
|---|---|---|
| 고성능 실행 (`high`) | `openai/gpt-5.3-codex` | aegis-exec, aegis-deep, ctf-web, ctf-web3, ctf-pwn, ctf-rev, ctf-crypto, ctf-solve, bounty-triage |
| 검증/스코프 (`medium`) | `openai/gpt-5.3-codex` | ctf-verify, bounty-scope |
| Zen 무료 탐색/리서치/계획 (variant 없음) | `opencode/glm-5-free` | aegis-plan, ctf-forensics, ctf-explore, ctf-research, ctf-hypothesis, ctf-decoy-check, bounty-research, deep-plan, md-scribe |
| Zen 무료 폴백 (variant 없음) | `opencode/glm-5-free` | explore-fallback, librarian-fallback, oracle-fallback |
| Think/Ultrathink/Auto-deepen 강제 | `openai/gpt-5.2` + `xhigh` | think 계열이 적용되는 `task` 호출 (non-overridable 라우트 제외) |

모델 매핑은 `src/install/agent-overrides.ts`의 `AGENT_OVERRIDES`에서 커스터마이즈할 수 있습니다.

런타임에서 메인 오케스트레이터(Aegis)가 세션별로 특정 서브에이전트의 실행 프로필을 직접 고정할 수도 있습니다.

- 설정: `ctf_orch_set_subagent_profile subagent_type=<name> model=<provider/model> [variant=<variant>]`
- 조회: `ctf_orch_list_subagent_profiles`
- 해제: `ctf_orch_clear_subagent_profile subagent_type=<name>` (또는 인자 없이 전체 해제)

예시:

```text
ctf_orch_set_subagent_profile subagent_type=ctf-web model=openai/gpt-5.3-codex
```

추가로 `dynamic_model.enabled=true`일 때, rate limit/쿼터 오류가 감지되면 해당 모델을 일정 시간 동안 unhealthy로 표시하고 동일 subagent에 대체 `model/variant`를 주입합니다.

- 쿨다운: `dynamic_model.health_cooldown_ms` (기본 300000ms)
- 런타임에서 `task` 호출 시 Aegis가 `subagent_type + model + variant`를 함께 명시

지원 variant 기준:

- GPT(OpenAI): `low`, `medium`, `high`, `xhigh`
- OpenCode Zen `opencode/glm-5-free`: variant 미사용

### 예시 워크플로우 (CTF)

```
1. ctf_orch_set_mode mode=CTF        # CTF 모드 설정
2. (채팅) "target is PWN heap challenge"  # 타겟 자동 감지
   # 또는: ctf_orch_event event=reset_loop target_type=PWN
3. (task 호출 → SCAN: 자동으로 ctf-pwn 디스패치)
4. ctf_orch_event event=scan_completed
5. (task 호출 → PLAN: 자동으로 aegis-plan 디스패치; aegis-plan이 `plan_completed` 이벤트까지 반영)
6. (task 호출 → EXECUTE: 자동으로 aegis-exec 디스패치; TODO 세트 기준 실행, 복수 pending 허용 + in_progress 1개 유지)
7. ctf_orch_event event=candidate_found candidate="..."
8. (자동 디코이 검증 → ctf-decoy-check → ctf-verify)
9. ctf_orch_status
```

### 병렬 스캔/가설(옵션)

SCAN 단계에서 트랙을 동시에 돌려 빠르게 탐색하고 싶다면:

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
5. (`parallel.auto_dispatch_scan=true`이면 SCAN 단계에서 `ctf_parallel_dispatch plan=scan` 자동 위임)
6. ctf_parallel_status / ctf_parallel_collect 로 병렬 결과 합류
7. (bash 명령 → 세그먼트 단위 read-only 검사 자동 적용)
8. ctf_orch_status
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
/ulw-loop "CTF를 풀고 verifier에서 Correct/Accepted가 나올 때까지 루프. 각 루프에서 먼저 계획을 세우고 TODO 목록(복수 항목 가능, in_progress 1개)을 갱신한 뒤 ctf_orch_event로 SCAN/PLAN/EXECUTE 및 verify_success/verify_fail 반영."
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
| `notes.root_dir` | `.Aegis` | 런타임 노트 디렉토리(기본/권장: `.Aegis`) |
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
| `tui_notifications.startup_toast` | `true` | 세션 시작 시 버전 정보 토스트 표시 (`tui_notifications.enabled=true` 필요) |
| `recovery.enabled` | `true` | 복구 기능 전체 활성화 |
| `recovery.edit_error_hint` | `true` | Edit/patch 실패 시 re-read + 작은 hunk 재시도 가이드 주입 |
| `recovery.thinking_block_validator` | `true` | thinking 모델 출력의 깨진 `<thinking>` 태그를 자동 수정 |
| `recovery.non_interactive_env` | `true` | git -i, vim, nano 등 인터랙티브 명령 자동 차단 |
| `recovery.empty_message_sanitizer` | `true` | 빈 메시지 응답 시 자동 복구 문구 주입 |
| `recovery.auto_compact_on_context_failure` | `true` | context_length_exceeded 시 자동 아카이브 압축 |
| `recovery.context_window_proactive_compaction` | `true` | `message.updated` 기준 컨텍스트 사용률 임계치 초과 시 선제 compaction + summarize 수행 |
| `recovery.context_window_proactive_threshold_ratio` | `0.9` | 선제 복구 트리거 임계치(기본 90%) |
| `recovery.context_window_proactive_rearm_ratio` | `0.75` | 사용률이 이 값 이하로 내려가면 선제 복구 트리거를 다시 arm |
| `recovery.session_recovery` | `true` | message.updated 기반 세션 복구(tool_result 누락 케이스). BOUNTY에서는 자동 재실행 억제 메시지 주입 |
| `recovery.context_window_recovery` | `true` | context length 초과 시 session.summarize 기반 자동 복구 |
| `recovery.context_window_recovery_cooldown_ms` | `15000` | context window 복구 최소 간격(ms) |
| `recovery.context_window_recovery_max_attempts_per_session` | `6` | 세션당 context window 복구 최대 시도 횟수 |
| `comment_checker.enabled` | `true` | 코드 패치의 과도한 주석/AI slop 마커 감지 |
| `comment_checker.only_in_bounty` | `true` | BOUNTY 모드에서만 활성화 |
| `comment_checker.max_comment_ratio` | `0.35` | 주석 비율 임계치 |
| `comment_checker.max_comment_lines` | `25` | 주석 줄 수 임계치 |
| `comment_checker.min_added_lines` | `12` | 검사 시작 최소 추가 줄 수 |
| `rules_injector.enabled` | `true` | `.rules/*.md` 내용 자동 주입 |
| `rules_injector.max_files` | `6` | 주입 최대 파일 수 |
| `rules_injector.max_chars_per_file` | `3000` | 파일당 최대 문자 수 |
| `rules_injector.max_total_chars` | `12000` | 주입 총 최대 문자 수 |
| `context_injection.enabled` | `true` | `read` 시 상위 디렉토리 `AGENTS.md`/`README.md` 자동 주입 |
| `context_injection.inject_agents_md` | `true` | `AGENTS.md` 주입 여부 |
| `context_injection.inject_readme_md` | `true` | `README.md` 주입 여부 |
| `context_injection.max_files` | `6` | 주입 최대 파일 수 |
| `context_injection.max_chars_per_file` | `4000` | 파일당 최대 문자 수 |
| `context_injection.max_total_chars` | `16000` | 주입 총 최대 문자 수 |
| `parallel.queue_enabled` | `true` | 병렬 task 큐 활성화 |
| `parallel.max_concurrent_per_provider` | `2` | provider별 동시 실행 상한 |
| `parallel.provider_caps` | `{}` | provider별 동시 실행 override |
| `parallel.auto_dispatch_scan` | `false` (install writes `true`) | CTF SCAN + BOUNTY SCAN(`scope_confirmed` 이후) 단계에서 병렬 디스패치 자동 위임 |
| `parallel.auto_dispatch_hypothesis` | `false` (install writes `true`) | CTF 가설 피벗 구간에서 병렬 가설 트랙 자동 위임 |
| `parallel.bounty_scan.max_tracks` | `3` | BOUNTY `plan=scan` 기본 최대 트랙 수 (`ctf_parallel_dispatch max_tracks` 지정 시 해당 값 우선) |
| `parallel.bounty_scan.triage_tracks` | `2` | BOUNTY `plan=scan` triage 트랙 기본 개수 |
| `parallel.bounty_scan.research_tracks` | `1` | BOUNTY `plan=scan` research 트랙 기본 개수 |
| `parallel.bounty_scan.scope_recheck_tracks` | `0` | BOUNTY `plan=scan` scope 재검증 트랙 기본 개수 |
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
| `enforce_todo_flow_non_scan` | `true` | SCAN 제외(PLAN/EXECUTE) 단계에서 TODO 흐름 검증 강제 |
| `enforce_todo_granularity_non_scan` | `true` | SCAN 제외 단계에서 TODO 세분화(최소 개수) 강제 |
| `todo_min_items_non_scan` | `2` | SCAN 제외 단계에서 유지할 최소 TODO 항목 수 |
| `enforce_mode_header` | `false` | MODE 헤더 미선언 시 시스템이 자동 주입 |
| `allow_free_text_signals` | `false` | ultrawork 외에서도 free-text 이벤트 신호 허용 |
| `enable_injection_logging` | `true` | 인젝션 감지 결과를 SCAN에 로깅 |
| `auto_phase.enabled` | `true` | Heuristic 기반 자동 페이즈 전환 활성화 |
| `auto_phase.scan_to_plan_tool_count` | `8` | SCAN→PLAN 자동 전환 도구 호출 임계치 |
| `auto_phase.plan_to_execute_on_todo` | `true` | PLAN→EXECUTE 자동 전환: `todowrite` 호출 감지 시 |
| `debug.log_all_hooks` | `false` | 모든 훅 호출을 `latency.jsonl`에 기록 (기본: 120ms 이상만 기록) |
| `debug.log_tool_call_counts` | `true` | 도구 호출 카운터를 메트릭에 기록 |
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

- 탐색 경로: `~/.config/opencode/skills/`, `./.opencode/skills/`
- 매핑: `skill_autoload.(ctf|bounty).(scan|plan|execute).<TARGET>` + `skill_autoload.by_subagent["<subagent>"]`
- 플러그인 시작 시 설치된 스킬 목록을 탐색하고, `task` 호출 직전마다 현재 `MODE/PHASE/TARGET/subagent` 기준으로 `load_skills`를 자동 병합
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
| `ctf_orch_exploit_template_list` | 내장 exploit 템플릿 목록(PWN/CRYPTO/WEB/WEB3/REV/FORENSICS/MISC, 39개) |
| `ctf_orch_exploit_template_get` | 내장 exploit 템플릿 조회(PWN/CRYPTO/WEB/WEB3/REV/FORENSICS/MISC) |

### REV 분석 / Decoy / Replay

| 도구 | 설명 |
|---|---|
| `ctf_rev_loader_vm_detect` | REV Loader/VM 패턴 감지 (.rela.*/커스텀 섹션/embedded ELF/RWX/self-mod/bytecode VM) |
| `ctf_decoy_guard` | 플래그 후보 디코이 여부 평가 (FAKE_FLAG/placeholder/decoy 등 패턴 + 오라클 결과 교차검증) |
| `ctf_replay_safety_check` | 바이너리 standalone 재실행 안전성 검사 (memfd_create/fexecve/.rela.p 등 의존성 탐지) |
| `ctf_rev_rela_patch` | RELA 엔트리 r_offset 패치 스크립트 생성 (리로케이션 VM 무력화용) |
| `ctf_rev_syscall_trampoline` | x86_64 syscall 트램펄린 생성 (write+exit 스텁으로 내부 버퍼 덤프) |
| `ctf_rev_entry_patch` | pwntools 기반 엔트리 포인트 패치 스크립트 생성 |
| `ctf_rev_base255_codec` | Base255 (null-free) 인코딩/디코딩 유틸리티 |
| `ctf_rev_linear_recovery` | 선형 방정식 복원 (out/expected 기반 원본 입력 역산) |
| `ctf_rev_mod_inverse` | 확장 유클리드 알고리즘 기반 모듈러 역원 계산 |

### 가설 관리

| 도구 | 설명 |
|---|---|
| `ctf_hypothesis_register` | 가설 등록 (hypothesisId/description/status/실험 목록 구조화 저장) |
| `ctf_hypothesis_experiment` | 가설 실험 결과 기록 (실험명/결과/verdict + 동일 가설 반복 실행 방지) |
| `ctf_hypothesis_summary` | 활성/완료 가설 요약 조회 (실험 이력 + 상태 + 판정 포함) |

### UNSAT / Oracle

| 도구 | 설명 |
|---|---|
| `ctf_unsat_gate_status` | UNSAT 주장 필수 조건 상태 확인 (교차검증 횟수, 무개입 오라클, 아티팩트 digest) |
| `ctf_unsat_record_validation` | UNSAT 조건 충족 기록 (cross_validation/unhooked_oracle/artifact_digest 개별 등록) |
| `ctf_oracle_progress` | 오라클 테스트 진행률 기록 (통과/실패 인덱스/전체 테스트 수 → Oracle-first 스코어링) |

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

> 참고: 일부 OpenCode 서버 버전에서는 `/pty/{id}/connect`가 `Session not found`를 반환할 수 있습니다. 이 경우 Aegis는 `ctf_orch_pty_connect`에서 `ok=true` + `connectSupported=false` 메타데이터를 반환하고, `ctf_orch_pty_get/list` 기반으로 후속 흐름을 유지합니다.

### Slash 커맨드

| 도구 | 설명 |
|---|---|
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

## 최근 변경 내역 (요약)

- **Startup Toast 알림 (v0.1.23)**: opencode 세션이 시작될 때(`session.created`) TUI 토스트로 버전 정보와 함께 "Aegis orchestration active. Ready." 메시지를 표시합니다. `tui_notifications.enabled=true` + `tui_notifications.startup_toast=true`(기본값)일 때만 동작하며, 동일 세션 ID에 대한 중복 표시는 자동으로 throttle됩니다.

- **오케스트레이션 피드백 루프 복원 (v0.1.22+)**: 에이전트가 수동으로 `ctf_orch_event`를 호출하지 않아도 오케스트레이터가 능동적으로 페이즈를 관리하도록 핵심 피드백 루프를 전면 재구축. (1) **도구 호출 추적**: `toolCallCount`/`aegisToolCallCount`/`toolCallHistory`(최근 20개) 세션 상태 추가로 실시간 활동 감시. (2) **Heuristic 자동 페이즈 전환**: SCAN 중 N회 이상 도구 호출 시 PLAN으로, PLAN 중 `todowrite` 감지 시 EXECUTE로 자동 승격 (`auto_phase.*` 설정). (3) **Signal → Action 시스템**: `signal-actions.ts` 신규 모듈로 revVmSuspected/decoySuspect/verifyFailCount/aegisToolCallCount 등 7개 신호를 실시간 에이전트 행동 지침으로 변환. (4) **Phase별 도구 가이드**: `tool-guide.ts` 신규 모듈로 현재 페이즈에 적합한 Aegis 도구 목록을 시스템 프롬프트에 주입. (5) **강화된 시스템 프롬프트**: `experimental.chat.system.transform` 훅에서 phase 지침 + 신호 가이던스 + 도구 가이드 + 플레이북을 통합 주입. (6) **사전 디코이 감지**: 모든 도구 출력(200KB 이하)에서 flag 패턴 즉시 스캔 → VERIFY 이전에도 디코이 조기 탐지 + toast 알림. (7) **강화된 stuck 감지**: 연속 15회 비Aegis 도구 호출 시 `no_new_evidence` 자동 발생, 동일 도구 5회 연속 패턴 감지 시 `staleToolPatternLoops` 증가. (8) **Debug 모드**: `debug.log_all_hooks=true` 시 모든 훅 호출을 `latency.jsonl`에 기록. (9) 통합 테스트 23개 신규 추가(`test/orchestration-feedback.test.ts`).
- **전 분야 오케스트레이션 강화 (Phase 1-8)**: REV/PWN에만 집중되었던 도메인 특화 로직을 WEB_API/WEB3/CRYPTO/FORENSICS/MISC 전체로 확장. (1) 17개 에이전트 시스템 프롬프트 + 권한 프로필 자동 주입, (2) 도메인별 위험 평가 함수 5개 + 통합 디스패처(`assessDomainRisk`), (3) 도메인별 검증 게이트(WEB_API: HTTP증거, WEB3: TX해시, CRYPTO: 테스트벡터, FORENSICS: 아티팩트해시), (4) 도메인별 모순 처리/Stuck 탈출 전략, (5) 7개 도메인별 CTF 리콘 전략(`planDomainRecon`), (6) 도메인별 환경 체크(`domainEnvCommands`), (7) 도구 추천 확장(WEB_API/WEB3/FORENSICS/MISC) + 39개 exploit 템플릿(+13개), (8) 플레이북 도메인별 조건부 규칙 확장.
- **CTF 포스트모템 기반 P0/P1/P2 개선**: (P0) Decoy Guard — 플래그형 문자열 + 오라클 실패 시 자동 `DECOY_SUSPECT` 설정 + 런타임 추출 모드 전환, REV Loader-VM Detector — `.rela.*`/커스텀 섹션 기반 VM 패턴 자동 감지, UNSAT Claim Gate 강화 — 최소 2개 독립 추출 교차검증 + 무개입 오라클 재현 + 아티팩트 digest 검증 필수. (P1) Oracle-first Scoring — 서브태스크 성공보다 오라클 통과율을 핵심 지표로 채점, Contradiction Pivot SLA — 1회 모순 발생 시 N루프 내 내부 버퍼 직접 덤프 실험 강제, Replay Safety Rule — memfd/relocation 의존 바이너리 standalone 결과 low-trust 자동 태깅. (P2) REV 공용 툴킷 — RELA 패치/syscall 트램펄린/base255 코덱/선형 복원 도구 내장, 가설 실험 레지스트리 — 가설-반증실험-증거파일-판정 구조화 저장 + 동일 가설 반복 실행 방지.
- **신규 분석 도구 15개 추가**: `ctf_rev_loader_vm_detect`, `ctf_decoy_guard`, `ctf_replay_safety_check`, `ctf_rev_rela_patch`, `ctf_rev_syscall_trampoline`, `ctf_rev_entry_patch`, `ctf_rev_base255_codec`, `ctf_rev_linear_recovery`, `ctf_rev_mod_inverse`, `ctf_hypothesis_register`, `ctf_hypothesis_experiment`, `ctf_hypothesis_summary`, `ctf_unsat_gate_status`, `ctf_unsat_record_validation`, `ctf_oracle_progress`.
- **병렬 child session 생성 안정화(실환경 핫픽스)**: `extractSessionClient` 경로에서 SDK 메서드 컨텍스트(`this._client`) 유실을 방지하도록 세션 메서드 바인딩을 강화했고, child session ID 파싱/생성 fallback 및 실패 원인 텔레메트리를 보강했습니다.
- **전 분야 매트릭스 검증 완료**: CTF/BOUNTY 각각 8개 타겟(`WEB_API/WEB3/PWN/REV/CRYPTO/FORENSICS/MISC/UNKNOWN`)에서 `ctf_parallel_dispatch` child session 생성이 재검증되었습니다.
- **관리자 역할 E2E 최종 검증**: CTF/BOUNTY 실환경에서 manager-only 흐름(`parallel_dispatch → collect → winner 선택 → new_evidence → next route`)을 재검증해, Aegis가 직접 도메인 실행 없이 하위 세션 결과를 수집/판단하는 패턴을 확인했습니다.
- **PTY 호출 호환성 보강**: `client.pty.*` 호출에서도 메서드 바인딩을 적용해 컨텍스트 유실 오류를 완화했고, v1/v2 응답 shape(`data` envelope 유/무) 모두 처리하도록 호환 경로를 확장했습니다. `get/update`는 list 기반 복구 fallback을 추가했고, 서버 WebSocket connect 엔드포인트가 실패하는 환경에서는 `connectSupported=false` 메타데이터를 반환해 워크플로우 실패 없이 진행합니다.
- **v0.1.17 반영**: 오케스트레이터 성능 경로를 전면 최적화했습니다. 세션/노트/병렬 상태 저장을 배치형 flush 중심으로 정리하고, 병렬 그룹 폴링 처리의 직렬 병목을 완화했습니다.
- **권한/디스패치 하드닝**: `aegis-explore`/`aegis-librarian` 권한을 코드 레벨에서 명시 강제하고, `aegis-exec`의 `task(subagent_type 미지정)`을 하드 차단해 재귀 디스패치 가능성을 제거했습니다.
- **메트릭 저장 경량화**: `ctf_orch_metrics` 백엔드를 배열 재쓰기(`metrics.json`)에서 append 기반 `metrics.jsonl`로 전환했습니다(레거시 `metrics.json` 자동 fallback 지원).
- **훅 지연 계측 최적화**: 훅 계측 로그(`latency.jsonl`)를 버퍼+주기 flush 방식으로 변경해 hot-path 동기 I/O 오버헤드를 줄였습니다.
- **v0.1.13 반영**: Claude 호환 훅 체인 연결. `.claude/hooks/PreToolUse`는 정책 거부 시 실제 실행을 차단하고, `.claude/hooks/PostToolUse` 실패는 soft-fail로 처리해 `SCAN.md`에 기록.
- **훅 체인 테스트 보강**: `test/plugin-hooks.test.ts`에 PreToolUse deny 차단/ PostToolUse soft-fail 로깅 시나리오를 추가해 회귀를 방지.
- **Skill 자동 주입 시점 명확화**: 스킬 목록은 플러그인 시작 시 탐색하고, 자동 주입은 `task` pre-hook 단계에서 매 호출마다 수행하도록 문서와 동작을 정렬.
- **v0.1.12 반영**: PWN/REV 검증에 hard verify gate 적용(oracle 성공 문구 + exit code 0 + runtime/parity 증거). 미충족 시 `verify_success`를 차단하고 실패로 처리.
- **모순 자동 피벗 강화**: 플래그형 문자열이 보이는데 검증이 실패/차단되면 `static_dynamic_contradiction`로 승격하고 CTF는 `ctf-rev` 동적 추출 트랙으로 강제 피벗.
- **REV VM/relocation 위험도 추가**: `.rela.p`, `.sym.p`, RWX/self-mod/VM 힌트 기반 리스크 스코어를 세션 상태에 기록하고 정적 신뢰도(`revStaticTrust`)를 자동 하향.
- **Docker 패리티 요구 자동 감지**: README/Dockerfile의 "must run in Docker" 류 시그널 감지 시 `envParityRequired=true`로 승격, 패리티 미충족 검증은 inconclusive로만 기록.
- **timeout/context debt 튜닝**: `candidate_found`/`new_evidence`에서 debt를 부분 감소시키고, EXECUTE 단계에서는 `md-scribe`를 보조(followup) 경로로만 사용.
- **v0.1.11 반영**: BOUNTY `stuck/failover`를 target-aware로 세분화해 `bounty-research` 단일 수렴을 완화(PWN/REV/FORENSICS는 보수적 triage/scope 우선).
- **BOUNTY UNSAT gate 강화**: `unsat_claim`은 CTF와 유사하게 `alternatives>=2` + 관측 근거가 없으면 triage로 되돌려 근거 없는 확정 결론을 차단.
- **수동 이벤트 phase 검증 추가**: `ctf_orch_event`에서 `scan_completed`/`plan_completed`/`verify_*`를 현재 phase와 교차 검증해 순서 위반 전이를 차단.
- **v0.1.9 반영**: 정적/동적 모순(`static_dynamic_contradiction`) 발생 시 CTF/BOUNTY 모두 target-aware scan route로 extraction-first 피벗을 우선 강제하고, 루프 예산(2 dispatch) 내 미수행 시 동일 피벗을 재강제.
- **Stale Hypothesis Kill-switch**: 동일 도구/서브에이전트 패턴이 3회 이상 반복되고 신규 증거가 없으면 CTF/BOUNTY 모두 강제 피벗(CTF=`ctf-hypothesis`, BOUNTY=target stuck route)으로 관측 루프를 차단.
- **ULW md-scribe route guard**: `md-scribe`가 연속 메인 route로 고착되면(streak>=2) target-aware stuck route로 전환해 로깅 루프를 차단.
- **Autoloop 안정성 강화**: `session.promptAsync` 호출 payload shape를 다중 포맷으로 재시도하여 hook shape 차이에서 발생하는 autoloop 비활성화를 줄임.
- **v0.1.7 배포**: manager-only recovery 강화, proactive context budget 복구(90% 트리거/75% rearm) 및 관련 테스트 보강을 포함해 npm `latest`로 배포.
- **Aegis 관리자 역할 강제**: 오케스트레이터 본체는 `edit/bash/webfetch=deny`를 기본으로 유지하고, continuation prompt에서도 manager-mode(하위 subagent 위임 중심)를 명시.
- **기존 사용자 `agent.Aegis` 정의와의 정합성 개선**: 사용자가 이미 `agent.Aegis`를 정의한 경우에도 핵심 manager 안전 정책(`mode=primary`, `hidden=false`, 실행 권한 deny)은 런타임에서 일관되게 강제.
- **Recovery 기본값 동기화**: install 기본 설정(`apply-config`)에 `thinking_block_validator`, `non_interactive_env`, `session_recovery`, `context_window_recovery` 및 cooldown/max-attempts 기본값을 스키마와 동일하게 반영.
- **문서/테스트 확장**: `recovery.context_window_proactive_*` 설정 문서화, `test/recovery.test.ts`에 proactive summarize/주입/rearm/disable 시나리오 추가, `test/agent-injection.test.ts`에 manager 권한 강제 검증 추가.

## 개발/검증

```bash
bun run typecheck
bun test
bun run build
bun run doctor
```

### ULW / 스킬 주입 검증

아래 테스트로 ULW 동작과 `load_skills` 자동 주입 동작을 빠르게 검증할 수 있습니다.

```bash
# ULW(키워드 활성화, todo continuation, autoloop) + CLI ulw 플래그
bun test test/plugin-hooks.test.ts test/cli-run.test.ts -t "ultrawork|todo continuation|auto-continues|stops autoloop|injects ultrawork"

# skill_autoload 로직 + task pre-hook load_skills 자동 주입
bun test test/skill-autoload.test.ts test/plugin-hooks.test.ts -t "skill|load_skills|autoload"
```

- ULW는 `ultrawork/ulw` 키워드 또는 `ctf_orch_set_ultrawork`로 활성화됩니다.
- TODO는 복수 항목 허용이며, `in_progress`는 1개만 유지하도록 정규화됩니다.
- 스킬 자동 주입은 `skill_autoload.*` 설정 + 설치된 skill 디렉토리(`~/.config/opencode/skills`, `.opencode/skills`, `.claude/skills`)를 기준으로 동작합니다.

### npm publish 전 체크리스트

- 로컬 게이트 통과: `bun run typecheck && bun test && bun run build && bun run doctor`
- 빌드 산출물 동기화 확인: `git diff --exit-code -- dist`
- 패키지 구성 확인: `npm pack --dry-run`
- 버전/태그 준비: `package.json` 버전, 릴리즈 노트, git tag 계획 확인
- 권한 확인: `npm whoami` 성공 + 퍼블리시 권한 계정 사용
- CI 퍼블리시 사용 시 `NPM_TOKEN` 설정 확인 (`.github/workflows/publish.yml`)
- 최종 퍼블리시: `npm publish --provenance --access public`
- 환경에서 provenance 생성 미지원 시 fallback: `npm publish --access public`

## 운영 메모

- 세션 상태: `.Aegis/orchestrator_state.json`
- 세션/훅 지연 메트릭: `.Aegis/latency.jsonl`
- 오케스트레이터 이벤트 메트릭: `.Aegis/metrics.jsonl` (구버전 `metrics.json`도 조회 fallback 지원)
- 병렬 상태 스냅샷: `.Aegis/parallel_state.json`
- 런타임 노트: 기본 `.Aegis/*` (설정 `notes.root_dir`로 변경 가능)
- Memory 저장소는 2개가 공존할 수 있습니다.
- MCP memory 서버: `<memory.storage_dir>/memory.jsonl` (`MEMORY_FILE_PATH`), JSONL 포맷
- Aegis 로컬 그래프 스냅샷: `<memory.storage_dir>/knowledge-graph.json` (`aegis_memory_*` 도구가 사용)

## 문서

- 런타임 워크플로우 요약: `docs/runtime-workflow.md`
- CTF/BOUNTY 운영 계약(원문): `docs/ctf-bounty-contract.md`
- 커버리지/경계 노트: `docs/workflow_coverage.md`
- readiness 로드맵: `docs/perfect-readiness-roadmap.md`
