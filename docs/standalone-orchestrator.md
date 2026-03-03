# oh-my-Aegis 독립 실행형 오케스트레이터

`oh-my-Aegis`는 OpenCode용 독립 실행형 CTF/BOUNTY 오케스트레이터 플러그인으로 설계되었습니다.

## 제품 경계

- 주요 도메인: CTF 및 버그 바운티 오케스트레이션.
- 런타임 제어: 모드 게이트 실행(`MODE: CTF` / `MODE: BOUNTY`).
- 설치 결과:
  - OpenCode 설정에 플러그인 엔트리 보장
  - 인증 플러그인 보장(`opencode-antigravity-auth`, `opencode-openai-codex-auth`)
  - 프로바이더 카탈로그 보장(`provider.google`, `provider.openai`)
  - 오케스트레이터 설정 보장(`oh-my-Aegis.json`)

## CLI 인터페이스

- `oh-my-aegis install`: 대화형/비대화형 초기 부트스트랩.
- `oh-my-aegis run`: 모드 인식 메시지 부트스트랩과 함께 `opencode run` 래핑 실행.
- `oh-my-aegis doctor`: 로컬 상태 진단.
- `oh-my-aegis readiness`: readiness 리포트(JSON).
- `oh-my-aegis get-local-version`: 로컬/최신 버전 및 설치 엔트리 점검.

## Provider 전략

- Antigravity 모델 카탈로그는 variant 기반 키를 사용합니다:
  - `antigravity-gemini-3-pro` (`low`, `high`)
  - `antigravity-gemini-3-flash` (`minimal`, `low`, `medium`, `high`)
- 레거시 키(`antigravity-gemini-3-pro-high`, `antigravity-gemini-3-pro-low`)는 install/apply 단계에서 마이그레이션됩니다.
- OpenAI 카탈로그에는 reasoning variant를 포함한 Codex 중심 엔트리(`gpt-5.2-codex`)가 포함됩니다.

## 버전 고정(Pinning)

- 설치기는 npm dist-tags를 통해 패키지 플러그인 엔트리를 `oh-my-aegis@<tag|version>` 형태로 해석합니다.
- Antigravity auth 플러그인은 npm 최신 버전에 pin되며, 실패 시 `@latest`로 폴백합니다.

## 테스트 커버리지 초점

- install/apply 설정 병합 및 마이그레이션 동작
- 플러그인 훅 정책 및 복구 플로우
- 라우팅 및 failover 동작
- 모드/타겟별 readiness 매트릭스
