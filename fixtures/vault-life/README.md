# vault-life — 62장 실험 볼트

컴공 3학년이 2026년 3월~10월에 쓴 노트 62장. 한 사람의 볼트다. 강의 15 · 논문 3 · 일기 14 · 독서 6 · 팀플 6 · 취업 4 · 건강 2 · 요리 3 · 여행 3 · 돈 2 · 잡다 4.

노트 사이를 잇는 줄기: 민지(친구·달리기·부산), 지훈·수아(캡스톤), 무릎(달리기 → 정형외과 → 헬스장), 커피·수면, DETR → 트랜스포머 → ResNet, DP(스터디 → 코딩테스트).

일부러 섞어 둔 것: 프론트매터 없는 일기, 날짜 없는 레시피, 표가 있는 가계부, 체크박스 할일, 헤딩 있는 회의록, 조사가 붙은 이름(`지훈이`).

## 돌리기

```bash
rm -rf fixtures/vault-life/wiki fixtures/vault-life/.piecepool     # cwd 가 wiki/ 안이면 실패한다
node --env-file=.env scripts/demo/index.ts --vault fixtures/vault-life [--embed]
node scripts/demo/analyze.ts fixtures/vault-life run.log
```

- `sources/` 에 PDF 를 넣으면 출처 페이지(`sources/@원본.md`)가 생기고 같이 정리된다. 논문 두 편(arXiv 1706.03762 · 2005.12872)은 로컬에만 둔다 — `.gitignore`
- `fixtures/sessions/*.md` 를 `.piecepool/sessions/` 로 복사하면 수확(세션 로그 → 위키)을 시험할 수 있다. AI 턴에서 온 기록에 `(AI)` 가 붙는다
- 결과와 회차별 지표는 `docs/experiments/2026-09-15-밤샘실험/README.md`
