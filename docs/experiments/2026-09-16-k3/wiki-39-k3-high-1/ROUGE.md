---
sources: ["[[2026-08-26-요약 faithfulness 서베이]]", "[[2026-10-03-RLHF 환각 줄이기]]", "[[2026-10-06-exp-007 검증 디코딩]]"]
created: 2026-09-16
compiledAt: 2026-09-16T13:54:17.011Z
hashes:
  요약: 50e15fb9
  한계: 4ce00306
  기록: c34cd44f
---

# ROUGE

> 요약을 평가하는 지표. [[환각]]을 잡아내지 못하며, 환각이 있는 요약이 점수가 더 높기도 하다.

## 한계

ROUGE 는 [[환각]]을 잡지 못한다. [[환각]]이 있는 요약이 ROUGE 점수는 더 높기도 하다. [[On Faithfulness and Factuality in Abstractive Summarization]] 에서는 NLI 기반 평가가 사람 평가와 상관이 더 높았다. NLI 보상으로 RL을 돌려 사실 일관성을 높인 [[Factually Consistent Summarization via RL|Roit et al. 2023]]에서도 일관성이 오르는 대신 ROUGE는 조금 떨어졌다. 추론 시점 완화인 [[exp-007 검증 디코딩|exp-007]]에서도 [[환각]]이 23.5%에서 14.0%로 줄면서 ROUGE-1은 0.50에서 0.48로 소폭 떨어졌다.

## 기록

- 2026-08-26 ROUGE 는 환각을 잡지 못한다 ← [[2026-08-26-요약 faithfulness 서베이]]
- 2026-08-26 환각이 있는 요약이 ROUGE 점수가 더 높기도 하다 ← [[2026-08-26-요약 faithfulness 서베이]]
- 2026-10-06 exp-007에서 환각이 줄면서 ROUGE-1은 0.50에서 0.48로 소폭 떨어졌다 ← [[2026-10-06-exp-007 검증 디코딩#exp-007 검증 디코딩 첫 시도]]
