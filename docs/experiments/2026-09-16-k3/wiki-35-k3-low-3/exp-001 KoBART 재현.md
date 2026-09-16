---
sources: ["[[2026-08-28-exp-001 KoBART 재현]]"]
created: 2026-09-16
compiledAt: 2026-09-16T05:05:25.117Z
hashes:
  요약: cfadfe32
  설정: b8d27c7d
  결과: 530390ac
  원인: 19bad69f
  기록: 2f39237c
---

# exp-001 KoBART 재현

> SKT [[KoBART]] 요약 데모 수치를 재현한 첫 실험. 토크나이저 차이 때문에 [[ROUGE]] 가 데모보다 한참 낮게 나왔고, 원인을 찾아 다음에 다시 돌리기로 했다.

## 설정

gogamza/kobart-summarization 을 AIHub 뉴스 요약 valid 1000개로 돌렸다. max_len 512 / 128, beam 4.

## 결과

[[ROUGE]]-1 0.31 / ROUGE-L 0.29. 데모 페이지 수치는 0.52 / 0.47 이라 한참 낮았다.

## 원인

허깅페이스 토크나이저 대신 원래 [[KoBART]] 토크나이저(kobart_tokenizer)를 써야 한다. 특수 토큰이 다르게 들어가서 문장 앞이 잘리고 있었다. 원인을 찾는 데 2시간 걸렸고, 다음 날 다시 돌리기로 했다. [[한국어 요약의 환각 측정과 완화]] 의 baseline 재현에 해당한다.

## 기록

- 2026-08-28 gogamza/kobart-summarization, AIHub 뉴스 요약 valid 1000개, max_len 512/128, beam 4 로 돌렸다 ← [[2026-08-28-exp-001 KoBART 재현#exp-001 KoBART 요약 baseline 재현]]
- 2026-08-28 ROUGE-1 0.31 / ROUGE-L 0.29 로 데모 페이지(0.52 / 0.47)보다 한참 낮았다 ← [[2026-08-28-exp-001 KoBART 재현#exp-001 KoBART 요약 baseline 재현]]
- 2026-08-28 원인은 토크나이저였고, 원래 KoBART 토크나이저(kobart_tokenizer)를 써야 한다 ← [[2026-08-28-exp-001 KoBART 재현#exp-001 KoBART 요약 baseline 재현]]
- 2026-08-28 특수 토큰이 다르게 들어가서 문장 앞이 잘렸다 ← [[2026-08-28-exp-001 KoBART 재현#exp-001 KoBART 요약 baseline 재현]]
- 2026-08-28 원인을 찾는 데 2시간 걸렸고 다음 날 다시 돌리기로 했다 ← [[2026-08-28-exp-001 KoBART 재현#exp-001 KoBART 요약 baseline 재현]]
