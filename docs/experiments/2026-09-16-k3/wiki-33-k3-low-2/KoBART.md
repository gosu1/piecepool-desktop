---
aliases: [kobart-summarization]
sources: ["[[2026-08-28-exp-001 KoBART 재현]]"]
created: 2026-09-16
compiledAt: 2026-09-16T04:19:21.756Z
hashes:
  요약: 00c8d7f4
  토크나이저 주의점: b480a190
  기록: c8501a31
---

# KoBART

> SKT의 한국어 BART 모델. 요약 데모가 있으며, 허깅페이스 토크나이저와 원래 토크나이저가 특수 토큰 처리가 다르다.

## 토크나이저 주의점

허깅페이스 토크나이저 대신 원래 KoBART 토크나이저(kobart_tokenizer)를 써야 한다. 특수 토큰이 다르게 들어가서 문장 앞이 잘린다. [[exp-001]]에서 이 때문에 데모 수치 재현에 실패했다.

## 기록

- 2026-08-28 허깅페이스 토크나이저 대신 원래 KoBART 토크나이저(kobart_tokenizer)를 써야 한다 ← [[2026-08-28-exp-001 KoBART 재현#exp-001 KoBART 요약 baseline 재현]]
