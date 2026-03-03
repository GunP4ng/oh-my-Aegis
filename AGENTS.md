# AGENTS.md (oh-my-Aegis)

이 문서는 이 저장소에서 작업하는 에이전트용 실행 가이드입니다.
목표는 "빠르고 안전하게, 기존 패턴을 깨지 않고" 변경을 완료하는 것입니다.

## 0) 우선 원칙

- 패키지 매니저/런타임은 `bun`이 기본입니다.
- 코드 수정 전 관련 파일 패턴을 먼저 읽고 같은 스타일로 맞춥니다.
- 검증 없는 완료 보고를 금지합니다.
- 불필요한 대규모 리팩터링보다 요구사항 충족에 집중합니다.

## 1) 레포 기본 정보

- 언어: TypeScript (ESM)
- 타입 설정: `strict: true` (`tsconfig.json`)
- 테스트 러너: `bun test` (`package.json`)
- 빌드: Bun build + TypeScript declaration emit (`package.json`)

## 2) 핵심 명령어

근거: `package.json`, `.github/workflows/ci.yml`, `.github/workflows/package-deploy-test.yml`

- 의존성 설치: `bun install`
  - CI 정합성이 필요하면 `bun install --frozen-lockfile`를 사용합니다.
- 타입체크: `bun run typecheck`
- 전체 테스트: `bun test`
- 빌드: `bun run build`
- 적용(로컬 설정 반영): `bun run apply`
  - 주의: `apply`는 사용자 OpenCode 설정을 변경할 수 있습니다. 가능하면 격리 환경에서 실행합니다.
  - 예: `HOME=/tmp/aegis-home XDG_CONFIG_HOME=/tmp/aegis-xdg bun run apply`
- 설치+적용: `bun run setup`
- 환경 진단: `bun run doctor`

## 3) 단일 테스트 실행

기본은 `bun test`이며, 파일/패턴 단위 실행을 우선 사용합니다.

- 특정 파일 1개: `bun test test/cli-run.test.ts`
- 파일 여러 개: `bun test test/plugin-hooks.test.ts test/cli-run.test.ts`
- 테스트 이름 패턴: `bun test -t "ultrawork|todo continuation"`
- 파일+패턴 조합: `bun test test/plugin-hooks.test.ts -t "skill|load_skills|autoload"`

참고: 이 레포에는 `lint` 스크립트가 별도로 없습니다.
실질적인 품질 게이트는 `typecheck + test + build`입니다.

## 4) 변경 후 최소 검증 순서

작은 변경이라도 아래 순서를 기본으로 적용합니다.

1. `bun run typecheck`
2. `bun test` 또는 영향 범위 단일 테스트
3. `bun run build`

릴리즈/배포 경로에 닿는 수정이면 추가로:

- `bun run doctor`
- 필요 시 `bun run benchmark:score benchmarks/results.json`
- `git diff --exit-code -- dist` (빌드 산출물 동기화 확인)

## 5) 코드 스타일 규칙

### 5-1. 타입/모듈

- TypeScript `strict` 기준을 유지합니다.
- ESM import/export를 사용합니다.
- `type` 전용 import는 분리해서 사용합니다.
  - 예: `import type { OrchestratorConfig } from "../config/schema";`
- Node 내장 모듈은 `node:` prefix를 사용합니다.
  - 예: `import { randomUUID } from "node:crypto";`

### 5-2. 네이밍

- 함수/변수: `camelCase`
- 타입/인터페이스/스키마: `PascalCase`
- 상수 맵/기본값: `UPPER_SNAKE_CASE` 또는 의도가 분명한 `const` 객체
  - 예: `DEFAULT_ROUTING`, `DEFAULT_SKILL_AUTOLOAD`
- 테스트 파일: `test/*.test.ts`

### 5-3. import 정렬

파일 로컬 패턴을 따릅니다(전역 강제 규칙보다 주변 일관성 우선).

권장 순서:

1. 외부 패키지
2. 내부 모듈
3. Node 내장(`node:*`)

단, 기존 파일이 다른 순서를 쓰고 있으면 해당 파일 스타일을 우선합니다.

### 5-4. 에러 처리

- `catch (error)`에서 에러를 삼키지 말고 이유를 구조화해 반환합니다.
  - 예: `{ ok: false, reason: message }`
- 툴 핸들러는 throw보다 JSON 결과 반환 패턴을 우선합니다.
- 사용자/런타임 안전에 영향 주는 경로는 fail-open/fail-closed 정책을 기존 로직에 맞춰 유지합니다.

### 5-5. 스키마/검증

- 입력 검증은 `zod` 스키마 기반 패턴을 재사용합니다.
- 새 설정 키 추가 시 `src/config/schema.ts` 기본값과 타입 정의를 함께 갱신합니다.

## 6) 테스트 작성 규칙

- `bun:test`의 `describe/it/expect` 패턴을 사용합니다.
- 테스트명은 동작 중심으로 작성합니다.
  - 예: "injects MODE header when missing"
- 버그 수정 시 재현 테스트를 먼저/함께 추가합니다.
- 회귀 위험이 있는 훅/라우팅 코드는 관련 테스트(`plugin-hooks`, `router`, `recovery`)를 반드시 확인합니다.

## 7) 오케스트레이터 도메인 파일 가이드

핵심 변경 지점:

- 라우팅: `src/orchestration/router.ts`
- 세션 상태 전이: `src/state/session-store.ts`
- 정책 가드: `src/risk/policy-matrix.ts`, `src/risk/sanitize.ts`
- 제어 도구: `src/tools/control-tools.ts`
- 설정 스키마: `src/config/schema.ts`

위 파일들은 서로 결합도가 높으므로, 하나를 바꾸면 연관 테스트를 같이 점검합니다.

## 8) 문서/설정 규칙

- 런타임 규약 문서는 `docs/` 기준으로 유지합니다.
- 설정 예시는 실제 기본값(`schema.ts`, `apply.ts`)과 불일치하지 않게 맞춥니다.
- README/문서 예시 커맨드는 실제 스크립트 존재 여부를 확인한 뒤 업데이트합니다.

## 9) 금지/주의 사항

- 사용자 요청 없는 파괴적 git 명령 금지
- 근거 없는 추측성 수정 금지
- 관련 없는 파일 포맷팅 대량 변경 금지
- 테스트 삭제로 문제 숨기기 금지

## 10) Cursor/Copilot 규칙 확인 결과

다음 파일/디렉토리를 확인했지만 현재 레포에는 없습니다.

- `.cursor/rules/`
- `.cursorrules`
- `.github/copilot-instructions.md`

추후 추가되면 이 문서에 우선순위 규칙을 병합하세요.

## 11) 권장 작업 루틴

1. 관련 코드/테스트/설정 파일 먼저 읽기
2. 최소 범위 수정
3. `typecheck` -> 관련 테스트 -> `build`
4. 문서/테스트 누락 여부 확인
5. 변경 이유와 검증 결과를 짧게 기록

## 12) 빠른 체크리스트

- [ ] 요구사항 직접 충족
- [ ] 타입 오류 없음
- [ ] 테스트 통과(최소 영향 범위)
- [ ] 빌드 성공
- [ ] 기존 패턴/네이밍/에러 처리 일관성 유지
- [ ] 문서가 코드와 일치
