---
aliases: [kobart-summarization]
sources: ["[[2026-08-28-exp-001 KoBART 재현]]"]
created: 2026-09-16
compiledAt: 2026-09-16T05:05:25.117Z
hashes:
  요약: cee4b458
  토크나이저: 10544bb4
  기록: 0062bde0
---

# KoBART

> SKT 의 한국어 BART 요약 모델(gogamza/kobart-summarization). 허깅페이스 기본 토크나이저로는 특수 토큰이 다르게 들어가 원래 KoBART 토크나이저를 써야 한다.

## 토크나이저

허깅페이스 토크나이저를 쓰면 특수 토큰이 다르게 들어가서 입력 문장 앞이 잘린다. 원래 KoBART 토크나이저(kobart_tokenizer)를 써야 한다. [[exp-001 KoBART 재현]] 에서 이 차이 때문에 [[ROUGE]] 가 데모보다 한참 낮게 나왔다.

## 기록

- 2026-08-28 허깅페이스 토크나이저 대신 원래 KoBART 토크나이저를 써야 한다 ← [[2026-08-28-exp-001 KoBART 재현#exp-001 KoBART 요약 baseline 재현]]
