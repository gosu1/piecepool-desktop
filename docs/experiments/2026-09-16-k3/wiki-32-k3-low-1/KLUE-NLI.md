---
sources: ["[[2026-09-05-SummaC]]", "[[2026-09-15-exp-004 SummaC 한국어]]"]
created: 2026-09-16
compiledAt: 2026-09-16T02:58:33.509Z
hashes:
  요약: ab28fc1a
  활용: b24d0793
  기록: 7463118e
---

# KLUE-NLI

> 한국어 NLI 데이터셋. klue/roberta-large로 학습한 모델이 허깅페이스에 있어 [[SummaC]]-ZS를 한국어에 그대로 적용핼 볼 수 있다.

## 활용

klue/roberta-large로 학습한 모델이 허깅페이스에 있다. [[exp-004]]에서 이걸로 [[SummaC]]-ZS를 한국어에 그대로 돌려 정확도 0.72를 억었다. 약점도 확인됐다: 숫자가 바뀐 경우(예: "3명 사망" vs "5명 사망")를 entailment 0.6 정도로 주어 잘 못 잡는데, 학습 데이터에 숫자 대조가 적어서인 듯하다.

## 기록

- 2026-09-05 KLUE-NLI로 학습한 klue/roberta-large 모델이 허깅페이스에 있다 ← [[2026-09-05-SummaC]]
