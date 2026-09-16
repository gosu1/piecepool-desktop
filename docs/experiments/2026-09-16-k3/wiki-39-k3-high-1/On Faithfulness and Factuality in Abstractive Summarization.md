---
aliases: [Maynez et al. 2020]
sources: ["[[2026-08-26-요약 faithfulness 서베이]]", "[[2026-09-05-SummaC]]"]
created: 2026-09-16
compiledAt: 2026-09-16T12:18:11.307Z
hashes:
  요약: ecd03bef
  핵심 내용: 59437985
  읽은 맥락: 846f8b90
  기록: 64dafd7c
---

# On Faithfulness and Factuality in Abstractive Summarization

> Maynez et al. 2020 의 [[추상 요약]] faithfulness 논문. [[환각]]을 intrinsic 과 extrinsic 으로 나누고, [[XSum]] 에서 생성 요약의 70% 이상에 환각이 있음을 사람 평가로 보였다. 주제를 잡기 전에 읽었다.

## 핵심 내용

[[추상 요약]] 모델은 유창하지만 원문에 없는 내용을 만드는 [[환각]]이 있으며, 이를 intrinsic(원문 정보를 잘못 조합)과 extrinsic(원문에 아예 없는 내용 추가)으로 나눈다. [[XSum]] 에서 사람 평가를 했더니 생성 요약의 70% 이상에 [[환각]]이 있었다. [[ROUGE]] 는 [[환각]]을 잡지 못하고 환각이 있는 요약이 [[ROUGE]] 점수가 더 높기도 하며, NLI 기반 평가가 사람 평가와 상관이 가장 높았다. 이 NLI 기반 평가가 [[SummaC]] 로 이어졌다.

## 읽은 맥락

주제를 잡기 전에 읽었다. extrinsic [[환각]] 중 세상 지식으로는 맞는 사실을 원문에 없다는 이유로 틀렸다고 정의하는 부분을 그대로 쓸지 고민하고 있다.

## 기록

- 2026-08-26 XSum 에서 사람 평가를 했더니 생성 요약의 70% 이상에 환각이 있었다 ← [[2026-08-26-요약 faithfulness 서베이]]
- 2026-08-26 NLI 기반 평가가 사람 평가와 상관이 가장 높았다 ← [[2026-08-26-요약 faithfulness 서베이]]
- 2026-08-26 NLI 기반 평가가 나중에 SummaC 로 이어지는 것으로 보인다 ← [[2026-08-26-요약 faithfulness 서베이]]
- 2026-08-26 주제를 잡기 전에 이 논문을 읽었다 ← [[2026-08-26-요약 faithfulness 서베이]]
