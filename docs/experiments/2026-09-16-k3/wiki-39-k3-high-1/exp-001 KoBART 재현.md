---
aliases: [exp-001]
sources: ["[[2026-08-28-exp-001 KoBART 재현]]", "[[2026-09-03-exp-002 baseline 재현 성공]]"]
created: 2026-09-16
compiledAt: 2026-09-16T12:12:23.957Z
hashes:
  요약: 60761e0d
  설정: d3994dd0
  결과: 778de117
  원인: b1b4cab9
  기록: d0031e1b
---

# exp-001 KoBART 재현

> SKT [[KoBART]] 요약 데모 수치 재현 실험. 첫 시도에서 [[ROUGE]] 가 데모보다 한참 낮게 나왔고, 원인은 토크나이저였다.

## 설정

gogamza/kobart-summarization 모델로 AIHub 뉴스 요약 valid 1000개를 돌렸다. max_len 512 / 128, beam 4. 목표는 데모 페이지의 수치 재현이다.

## 결과

[[ROUGE]]-1 0.31 / [[ROUGE]]-L 0.29. 데모 페이지는 0.52 / 0.47이라 한참 낮다.

## 원인

원인을 찾는 데 2시간 걸렸는데 토크나이저였다. 허깅페이스 토크나이저 대신 원래 [[KoBART]] 토크나이저(kobart_tokenizer)를 써야 한다. 특수 토큰이 다르게 들어가서 문장 앞이 잘렸다. 원래 토크나이저로 다시 돌린 [[exp-002 baseline 재현]] 에서 데모 수치 재현에 성공했다. 이 실험은 [[한국어 요약의 환각 측정과 완화]] 의 baseline 재현 계획의 일부다.

## 기록

- 2026-08-28 gogamza/kobart-summarization 으로 AIHub 뉴스 요약 valid 1000개에서 데모 수치 재현을 시도했다 ← [[2026-08-28-exp-001 KoBART 재현#exp-001 KoBART 요약 baseline 재현]]
- 2026-08-28 ROUGE-1 0.31 / ROUGE-L 0.29로 데모 페이지의 0.52 / 0.47보다 한참 낮았다 ← [[2026-08-28-exp-001 KoBART 재현#exp-001 KoBART 요약 baseline 재현]]
- 2026-08-28 수치가 낮은 원인을 찾는 데 2시간 걸렸고 토크나이저가 원인이었다 ← [[2026-08-28-exp-001 KoBART 재현#exp-001 KoBART 요약 baseline 재현]]
- 2026-08-28 허깅페이스 토크나이저 대신 원래 KoBART 토크나이저를 써야 하며, 특수 토큰이 다르게 들어가 문장 앞이 잘렸다 ← [[2026-08-28-exp-001 KoBART 재현#exp-001 KoBART 요약 baseline 재현]]
