---
aliases: [임계 구역]
sources: ["[[2026-09-22-운영체제 4주차]]"]
created: 2026-09-17
compiledAt: 2026-09-16T15:10:41.538Z
hashes:
  요약: 1a7148f1
  해결 조건: 3894921b
  기록: 4caca98b
---

# critical section

> 공유 자원을 건드리는 코드 구간. 동기화가 해결하려는 문제의 중심이고, mutual exclusion·progress·bounded waiting 세 조건을 만족해야 한다.

## 해결 조건

세 가지 조건을 만족해야 한다. mutual exclusion(한 번에 하나만), progress, bounded waiting. [[뮤텍스]] 와 [[세마포어]] 가 이 문제의 해결 도구다.

## 기록

- 2026-09-22 공유 자원을 건드리는 코드 구간이 critical section 이다 ← [[2026-09-22-운영체제 4주차]]
- 2026-09-22 critical section 해결 조건은 mutual exclusion, progress, bounded waiting 세 가지다 ← [[2026-09-22-운영체제 4주차]]
