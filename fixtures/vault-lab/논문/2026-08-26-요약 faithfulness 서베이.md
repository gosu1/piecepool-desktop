---
date: 2026-08-26
kind: 논문
---

Maynez et al. 2020 "On Faithfulness and Factuality in Abstractive Summarization". 주제 잡기 전에 읽음.

핵심

- 추상 요약 모델은 유창하지만 원문에 없는 내용을 만든다 = 환각(hallucination)
- 두 종류: intrinsic (원문 정보를 잘못 조합), extrinsic (원문에 아예 없는 내용 추가)
- XSum에서 사람 평가했더니 생성 요약의 70% 이상에 환각이 있었다고
- ROUGE는 환각을 못 잡는다. 환각 있는 요약이 ROUGE는 더 높기도

extrinsic 환각 중 일부는 사실(fact)이긴 하다. 세상 지식으로 맞는 말. 근데 원문에 없으면 요약으로서는 틀린 거라고 정의. 이 정의를 그대로 쓸지 고민.

한국어에서 같은 현상이 있는지 아무도 안 잰 것 같다. 이게 주제가 될 수 있나.

NLI 기반 평가가 사람 평가와 상관이 제일 높았다고. 이게 나중에 SummaC로 이어지는 듯.
