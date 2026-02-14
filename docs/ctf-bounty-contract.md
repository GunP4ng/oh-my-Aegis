# CTF / BUG BOUNTY Rules (KR, Contract)

이 문서는 CTF/BOUNTY 운영 규칙(계약 원문)을 보관합니다.

목표: (1) 디코이/오탐 최소화 (2) 빠른 피벗으로 풀이 속도↑ (3) 컨텍스트 붕괴/루프 방지 (4) 재현 가능한 증거 중심

---

## 0) MODE (필수)

세션 시작 시 반드시 선언: `MODE: CTF` 또는 `MODE: BOUNTY`

불명확하면 BOUNTY(보수적)로 처리.

---

## 1) 단일 진실 = `.sisyphus/` (필수)

대화 컨텍스트는 언제든 유실될 수 있으므로, 결정/근거/재현은 파일로 남긴다.

필수:

- `.sisyphus/STATE.md` : 목표/제약/환경/LH/다음 TODO(1개)
- `.sisyphus/WORKLOG.md` : 시도 + 관측(핵심) + 다음(1개)
- `.sisyphus/EVIDENCE.md` : **검증완료(Verified) 사실만**(재현 가능)

권장(필요할 때만):

- `.sisyphus/SCAN.md` : 스캔 산출물 요약(명령 + 핵심 라인 + 경로)
- `.sisyphus/ASSUMPTIONS.md` / `BLOCKERS.md`
- `.sisyphus/CONTEXT_PACK.md` : 30~60줄(세션 재시작 복구용)
- `.sisyphus/artifacts/` : 원본 로그/덤프/스크린샷/pcap/요청-응답 등
- `.sisyphus/scripts/` : 재사용 스크립트(파이썬 등)

---

## 2) 출력/컨텍스트 위생 (필수)

### 2-1) “긴 출력”은 채팅에 붙이지 않는다

- **200줄 이상 가능**하면 무조건 파일로:
  - `cmd > .sisyphus/artifacts/<name>.txt 2>&1`
  - 채팅/WORKLOG에는 **핵심 10~30줄 + 파일 경로**만 남긴다.

### 2-2) 파이썬 heredoc 반복 금지

- 긴 파이썬을 `python3 - <<'PY' ... PY` 형태로 계속 재전송하지 않는다(코드 자체가 컨텍스트를 잠식).
- 한 번만 생성: `.sisyphus/scripts/<name>.py`
- 이후에는 실행만: `python3 .sisyphus/scripts/<name>.py ...`
- 수정 시 “전체 재붙여넣기” 대신 **최소 변경(diff)** 형태로 업데이트.

---

## 3) 작업 단계(중요): SCAN -> PLAN -> EXECUTE

### 3-1) PHASE A — SCAN (배치 실행, 무중단) (필수)

SCAN 목표:

- “지금 풀어야 하는 문제의 형태/공격면/디코이 가능성”을 빠르게 좁히고,
- **가설 2~4개 + 각 가설의 최소 반증 테스트**까지 만든다.

SCAN 규칙:

- SCAN은 **하나의 TODO**로 취급한다. (여러 개 명령 실행 OK)
- 모든 산출물은 `.sisyphus/artifacts/scan/`에 저장하고, `.sisyphus/SCAN.md`에 20~60줄로 요약한다.

### 3-2) PHASE B — PLAN (반증 포함, 필수)

PLAN에서 반드시 포함:

- LH 1개 + 대안 1~3개
- **가설별 최소 반증 테스트**
- stop 조건(피벗 조건)

### 3-3) PHASE C — EXECUTE (1 TODO, 필수)

PLAN 이후부터는 엄격히:

- **1 루프 = 1 TODO**만 실행 -> 관측 -> 기록 -> STOP
- 후보(Candidate)가 나오면 즉시 검증 TODO로 전환

---

## 4) 검증완료(Verified) 기준 (필수)

### CTF: 후보(Candidate) vs 검증완료(Verified) (전 분야 공통)

- 후보(Candidate): 추정/문자열/간접추출/부분 성공 -> WORKLOG에만
- 검증완료(Verified): 공식 체커/제출/원격 채점 Accepted/Correct -> EVIDENCE에만

### BOUNTY: 안전 게이트

- in-scope 확인(불명확하면 STOP)
- 기본은 최소 영향(minimal-impact) 읽기 전용(read-only) 검증
