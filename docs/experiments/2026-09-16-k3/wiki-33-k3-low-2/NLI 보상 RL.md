---
aliases: [Roit et al. 2023, Factually Consistent Summarization via RL with Textual Entailment Feedback]
sources: ["[[2026-10-03-RLHF 환각 줄이기]]"]
created: 2026-09-16
compiledAt: 2026-09-16T04:47:29.848Z
hashes:
  요약: e038bcdc
  방법: aef3155b
  내 검증 디코딩과 비교: 73361241
  기록: 42ce9cfb
---

# NLI 보상 RL

> Roit et al. 2023의 [[환각]] 완화 방법. NLI 점수를 보상으로 써서 PPO로 요약 모델을 학습한다. 학습 시점의 방법이라 추론 시점인 [[검증 디코딩]]과 대비된다.

## 방법

Roit et al. 2023 "Factually Consistent Summarization via RL with Textual Entailment Feedback". NLI 점수를 보상으로 써서 RL(PPO)로 요약 모델을 학습한다. 사실 일관성이 오르고 [[ROUGE]]는 조금 떨어지며, 사람 평가에서도 좋아졌다.

## 내 검증 디코딩과 비교

내 [[검증 디코딩]]([[exp-007]])은 추론에서 하는데 이쪽은 학습에 넣는다. 이쪽이 근본적이지만 PPO 안정화가 어렵고, 랩 GPU로는 무리일 것 같다. [[교수님]] 말씀대로 추론 시점 방법으로 먼저 결과를 내고 학습 방법은 후속으로 미루는 게 맞는 것 같다. 관련 연구 절에는 Maynez(정의) → [[FactCC]]/[[SummaC]]/[[AlignScore]](지표) → [[CLIFF]]/[[검증 디코딩]](줄이기, 추론) → Roit(줄이기, 학습) 순으로 넣을 것이다.

## 기록

- 2026-10-03 Roit et al. 2023은 NLI 점수를 보상으로 써서 RL(PPO)로 학습한다 ← [[2026-10-03-RLHF 환각 줄이기]]
- 2026-10-03 사실 일관성이 오르고 ROUGE는 조금 떨어지며 사람 평가에서도 좋아졌다 ← [[2026-10-03-RLHF 환각 줄이기]]
- 2026-10-03 검증 디코딩은 추론에서, Roit은 학습에 넣으며 Roit이 근본적이지만 PPO 안정화가 어렵다 ← [[2026-10-03-RLHF 환각 줄이기]]
- 2026-10-03 랩 GPU로는 PPO 학습이 무리일 것 같다 ← [[2026-10-03-RLHF 환각 줄이기]]
- 2026-10-03 관련 연구 절을 Maynez(정의) → 지표 → 추론 시점 줄이기 → 학습 줄이기 순으로 쓸 것이다 ← [[2026-10-03-RLHF 환각 줄이기]]
