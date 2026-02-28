# Changelog

## 최근 변경 내역

- **v0.1.32 (tmux Flow 패널 버그 수정)**: 플러그인 로드 시 `tmux-panel`이 `cli` 명령어를 호출하지 못하는 경로 버그(`process.argv[1]`가 `dist/index.js`를 가리킴)를 동적 탐색 로직으로 수정했습니다. 또한 README 명세에 따라 `spawnFlowPanel` 동작을 `tui_notifications.enabled=true` 환경 설정에 종속되도록 수정하여 의도치 않은 패널 생성을 방지했습니다.

- **v0.1.31 (tmux 서브에이전트 워크플로우 시각화)**: 병렬 서브에이전트 호출 흐름을 tmux 패널에서 실시간 한국어 플로우차트로 표시하는 기능을 추가했습니다. `process.stderr`를 통해 LLM 컨텍스트에 영향 없이 화면에만 출력되며, tmux 세션 안에서 OpenCode를 실행하면 우측 35% 패널이 자동으로 열립니다. 각 트랙의 현재 도구 호출(`lastActivity`)도 실시간으로 갱신됩니다. `tui_notifications.enabled=true` 설정 시 활성화. `oh-my-aegis flow --watch <FLOW.json>` 커맨드로 수동 실행도 가능합니다.

- **v0.1.30 (세션 시작 토스트 `oh-my-opencode` 동작 정렬 + idle fallback 보강)**: startup toast를 `oh-my-opencode`와 동일한 spinner-style 프레임(`· • ● ○ ◌ ◦`)로 표시하도록 정렬했고, top-level 세션에서만 1회 동작하도록 중복/자식 세션 가드를 강화했습니다. 또한 `session.created` 시점에 TUI 토스트 API가 아직 준비되지 않은 환경을 위해 `session.status=idle` 시 1회 fallback 재시도 경로를 추가해 세션 시작 알림 누락을 줄였습니다. 관련 회귀 테스트(기본 표시, 중복 억제, child 세션 제외, idle fallback, repeated idle bounded)를 함께 추가했습니다.

- **v0.1.29 (`oh-my-aegis install` 시 OpenCode 내부 플러그인 자동 업데이트)**: `oh-my-aegis install`이 `opencode.json`은 업데이트했지만 OpenCode가 관리하는 `node_modules`의 oh-my-aegis가 기존 버전(예: `^0.1.17`)에 고정되어 세션 시작 알림 등 신규 기능이 동작하지 않던 문제를 수정했습니다. 이제 install 완료 후 OpenCode의 `package.json`에 버전을 기록하고 `npm install --prefer-online`을 자동 실행해 `node_modules`를 즉시 갱신합니다. 출력 메시지에 실제 설치 경로와 버전도 표시됩니다.

- **v0.1.28 (`oh-my-aegis install` 경로 자동 감지 수정)**: `OPENCODE_CONFIG_DIR` / `XDG_CONFIG_HOME` 환경변수가 없는 환경에서 `oh-my-aegis install`이 `~/.config/opencode-aegis/opencode` 대신 `~/.config/opencode`에 잘못 기록되던 버그를 수정했습니다. `~/.config/` 하위 디렉토리를 스캔해 `oh-my-Aegis.json` 또는 `opencode.json` 내 oh-my-aegis 플러그인 항목이 있는 경로를 자동 감지(`scanConfigSubdirCandidates`)하고, 기본 `~/.config/opencode` 폴백보다 해당 경로를 우선 사용하도록 `buildOpencodeDirCandidates`를 개선했습니다.

- **v0.1.27 (npm 글로벌 업데이트 시 플러그인 경로 자동 교체)**: `oh-my-aegis install`을 실행하면 `opencode.json`의 plugin 배열에서 기존 oh-my-aegis 항목(이전 버전 태그 `oh-my-aegis@0.1.x`, 로컬 절대경로 `/…/dist/index.js` 등)을 새 버전으로 **교체**하도록 `applyAegisConfig`를 개선했습니다. 이전에는 동일 패키지 항목이 중복 추가되는 문제가 있었습니다. `isOhMyAegisPluginEntry` 함수(버전 태그·절대경로 대소문자 무시 매칭)와 `replaceOrAddPluginEntry` 함수(첫 번째 일치 항목 교체 + 나머지 중복 제거)를 신규 추가했습니다.

- **v0.1.26 (install path + startup toast 안정화)**: 설치 시 기존 `OPENCODE_CONFIG_DIR` 경로(`opencode-aegis/opencode` 등)에 이미 Aegis 설치 흔적이 있으면 해당 경로를 우선 재사용하도록 `resolveOpencodeDir` 우선순위를 보정했습니다. 또한 startup toast 경로를 `oh-my-opencode` 방식(body-first + `setTimeout(0)`)으로 정렬하고 `tui.showToast` 호출 시 SDK `this` 바인딩을 유지하도록 수정해, 런타임에서 발생하던 `this._client` 오류로 인한 세션 시작 알림 미표시 문제를 해결했습니다.

- **터미널 텍스트 Startup 배너 추가 (v0.1.25)**: `session.created` 시 top-level 세션에서 터미널 텍스트 배너를 1회 출력하도록 추가했습니다. 현재 기본값은 `tui_notifications.startup_terminal_banner=false`이며, 필요할 때만 켜서 사용합니다.

- **서브에이전트 모델 교체 + minimax-2.5-free 폴백 (v0.1.24)**: 모든 서브에이전트(md-scribe, ctf-hypothesis, ctf-forensics, ctf-explore, ctf-research, ctf-decoy-check, bounty-research, aegis-plan, deep-plan, explore-fallback/librarian-fallback/oracle-fallback 등 12개)의 기본 모델을 `opencode/glm-5-free`로 통일했습니다. `opencode/minimax-2.5-free`를 새 폴백 모델로 추가하여 glm-5-free 실패 시 → minimax-2.5-free → codex 순으로 자동 전환합니다. `applyRequiredAgents`에 antigravity 모델 강제 마이그레이션 로직을 추가해 `bun run setup` 재실행 시 기존 구성의 antigravity 항목도 자동 교체됩니다. 시작 토스트 메시지를 `"Aegis is orchestrating your workflow."`로 업데이트하고, 서브에이전트 자식 세션에서는 토스트가 표시되지 않도록 `parentID` 체크를 추가했습니다.

- **Startup Toast 알림 (v0.1.23)**: opencode 세션이 시작될 때(`session.created`) TUI 토스트로 버전 정보를 표시합니다. 현재는 `oh-my-opencode` 스타일 spinner toast를 사용하며, `tui_notifications.startup_toast=true`(기본값)일 때 top-level 세션에서 1회 동작합니다.

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

