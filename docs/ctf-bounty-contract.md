# CTF / BUG BOUNTY 규칙 (KR, 계약)

이 문서는 CTF/BOUNTY 운영 규칙(계약 원문)을 보관합니다.

목표: (1) 디코이/오탐 최소화 (2) 빠른 피벗으로 풀이 속도 증가 (3) 컨텍스트 붕괴/루프 방지 (4) 재현 가능한 증거 중심

---

## 0) MODE (필수)

세션 시작 시 반드시 선언: `MODE: CTF` 또는 `MODE: BOUNTY`

불명확하면 BOUNTY(보수적)로 처리.

---

## 1) 단일 진실 = `.Aegis/` (필수)

대화 컨텍스트는 언제든 유실될 수 있으므로, 결정/근거/재현은 파일로 남긴다.

필수:

- `.Aegis/STATE.md`: 목표/제약/환경/LH/다음 TODO 세트(복수 pending 허용, `in_progress` 1개)
- `.Aegis/WORKLOG.md`: 시도 + 관측(핵심) + 다음 TODO 세트 요약
- `.Aegis/EVIDENCE.md`: **검증완료(Verified) 사실만**(재현 가능)

권장(필요할 때만):

- `.Aegis/SCAN.md`: 스캔 산출물 요약(명령 + 핵심 라인 + 경로)
- `.Aegis/ASSUMPTIONS.md` / `BLOCKERS.md`
- `.Aegis/CONTEXT_PACK.md`: 30~60줄(세션 재시작 복구용)
- `.Aegis/artifacts/`: 원본 로그/덤프/스크린샷/pcap/요청-응답 등
- `.Aegis/scripts/`: 재사용 스크립트(파이썬 등)

---

## 2) 출력/컨텍스트 위생 (필수)

### 2-1) 긴 출력은 채팅에 붙이지 않는다

- 200줄 이상 가능하면 무조건 파일로 저장
- `cmd > .Aegis/artifacts/<name>.txt 2>&1`
- 채팅/WORKLOG에는 핵심 10~30줄 + 파일 경로만 남긴다

### 2-2) 파이썬 heredoc 반복 금지

- 긴 파이썬을 `python3 - <<'PY' ... PY` 형태로 계속 재전송하지 않는다
- 한 번만 생성: `.Aegis/scripts/<name>.py`
- 이후에는 실행만: `python3 .Aegis/scripts/<name>.py ...`
- 수정 시 전체 재붙여넣기 대신 최소 변경(diff) 형태로 업데이트

---

## 3) 기본 작업 단계: `SCAN -> PLAN -> EXECUTE`

### 3-1) PHASE A, SCAN (배치 실행, 무중단)

SCAN 목표:

- 문제 형태/공격면/디코이 가능성을 빠르게 좁히고
- 가설 2~4개 + 각 가설의 최소 반증 테스트까지 만든다

SCAN 규칙:

- SCAN은 하나의 실행 루프 단위로 취급한다
- 산출물은 `.Aegis/artifacts/scan/`에 저장하고, `.Aegis/SCAN.md`에 20~60줄로 요약한다

### 3-2) PHASE B, PLAN (반증 포함)

PLAN에서 반드시 포함:

- LH 1개 + 대안 1~3개
- 가설별 최소 반증 테스트
- stop 조건(피벗 조건)

### 3-3) PHASE C, EXECUTE (TODO 세트 기반)

PLAN 이후부터는 엄격히:

- TODO는 복수 pending 허용, 단 `in_progress`는 항상 1개만 유지
- 1 루프 = TODO 세트에서 `in_progress` 1개 실행 -> 관측 -> 기록 -> STOP
- 후보(Candidate)가 나오면 즉시 검증 TODO로 전환

---

## 4) Governance 파이프라인 계약

코드 기준 단계:

- `EXECUTE-PROPOSE-PATCH`: 패치 제안과 artifact 체인 기록
- `REVIEW-INDEPENDENT`: 독립 리뷰 결재 + digest 결속 확인
- `APPLY`: apply preflight와 single-writer lock 통과
- `AUDIT`: 현재 체인과 gate readiness 확인

### 4-1) 아티팩트 체인 (필수)

`run_id` 단위 아티팩트 계약:

- `.Aegis/runs/<run_id>/sandbox`
- `.Aegis/runs/<run_id>/run-manifest.json`
- `.Aegis/runs/<run_id>/patches/*.diff`
- `.Aegis/runs/<run_id>/patches/*.manifest.json`
- `.Aegis/runs/locks/single-writer-apply.lock`

`ctf_patch_propose` 시 아래 ref 조합이 끊기면 fail-closed:

- `run_id=<run_id>`
- `sandbox_cwd=<.../.Aegis/runs/<run_id>/sandbox>`
- `manifest_ref=.Aegis/runs/<run_id>/run-manifest.json`
- `patch_diff_ref=.Aegis/runs/<run_id>/patches/*.diff`

### 4-2) gate precondition (필수)

`ctf_patch_apply` 또는 apply 전이 전 precondition:

- patch digest 유효 + artifact chain 완전
- review verdict=`approved` + patch/review digest 일치
- 독립 reviewer/provider family 조건 충족(설정 강제 시)
- council required이면 council artifact 존재
- apply lock 선점 성공

미충족 시 fail-closed, reason은 deterministic code로 반환:

- `governance_patch_*`
- `governance_review_*`
- `governance_council_required_missing_artifact`
- `governance_apply_lock_*`
- 런타임 차단 시 `governance_apply_blocked:*`

---

## 5) 검증완료(Verified) 기준 (필수)

### 5-1) CTF: 후보(Candidate) vs 검증완료(Verified)

- 후보(Candidate): 추정/문자열/간접추출/부분 성공 -> WORKLOG에만
- 검증완료(Verified): 공식 체커/제출/원격 채점 Accepted/Correct -> EVIDENCE에만

### 5-2) BOUNTY: 안전 게이트

- in-scope 확인(불명확하면 STOP)
- 기본은 최소 영향(minimal-impact) 읽기 전용(read-only) 검증
