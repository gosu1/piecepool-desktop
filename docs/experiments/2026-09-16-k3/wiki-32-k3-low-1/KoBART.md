---
sources: ["[[2026-08-28-exp-001 KoBART 재현]]", "[[2026-09-03-exp-002 baseline 재현 성공]]"]
created: 2026-09-16
compiledAt: 2026-09-16T02:51:07.631Z
hashes:
  요약: 3f3a94d6
  토크나이저 주의: da5e7c15
  기록: 1463ff87
---

# KoBART

> SKT의 한국어 BART 모델. 요약 데모가 있고, 전용 토크나이저(kobart_tokenizer)를 써야 제대로 동작한다.

## 토크나이저 주의

허깅페이스 토크나이저를 쓰면 특수 토큰이 다르게 들어가 문장 앞이 잘린다. 원래 KoBART 토크나이저(kobart_tokenizer)를 써야 한다. [[exp-001]]에서 이 문제로 데모 수치([[ROUGE]]-1 0.52 / [[ROUGE]]-L 0.47)보다 한참 낮은 0.31 / 0.29가 나왔고, [[exp-002]]에서 토크나이저를 고치자 0.50 / 0.46으로 재현됐다.

## 기록

- 2026-08-28 KoBART 요약 데모의 수치는 ROUGE-1 0.52 / ROUGE-L 0.47이다 ← [[2026-08-28-exp-001 KoBART 재현#exp-001 KoBART 요약 baseline 재현]]
