# ADR-0005: IPC 계약 파일과 renderer 상태 관리

- 상태: 채택 (Accepted)
- 일자: 2026-09-17
- 관련: `docs/superpowers/specs/2026-09-14-real-vault-design.md` · `docs/superpowers/specs/2026-09-14-obsidian-chrome-design.md`
- 보완: 0단계 설계 §8 의 동결 목록 (이 ADR 이 한 항목을 더한다)

## 배경

0단계 설계 §8 이 동결 목록을 정할 때 7·8단계는 미착수였다. 목록은 `core/` 와 `shared/types.ts`
만 다루고 **main·preload·renderer 3자가 공유하는 것**은 상정하지 않았다. §9 트리도
`src/shared/types.ts` 한 줄뿐이고, `renderer/` 는 _"하위 구성은 그때 확정한다"_ 로 비워 뒀다.

7단계에서 두 자리가 비었다.

1. **채널명과 요청/응답 모양을 어디 둘 것인가.** 세 프로세스가 같은 문자열을 각자 적으면
   오타가 런타임까지 간다. 타입도 마찬가지다 — 셋이 각자 선언하면 IPC 경계에서 갈라진다
2. **renderer 상태를 무엇에 담을 것인가.** eslint zone 이 `renderer → core` 와
   `renderer → main` 을 둘 다 막는다. 화면은 preload 가 열어 준 것만 보므로,
   그 경계를 한 겹 감싸 둘 자리가 필요하다

## 결정

**1. `src/shared/ipc.ts` 를 만들고 동결한다.**

채널명 상수 7개 · `TreeNode` · `VaultPayload` · `PiecePoolApi`(멤버 8개) 를 둔다.
`shared` 규칙 그대로 타입과 순수 상수만 두고 `node:*` 도 `electron` 도 넣지 않는다.

**0단계 설계 §8 의 동결 목록에 이 파일이 더해진 것으로 읽는다.** 목록이 14곳에서 15곳이 됐다.

**2. renderer 상태는 `zustand` 에 둔다.**

`store/workspace.ts` 하나가 볼트·트리·탭·칸을 쥐고, 컴포넌트는 스토어만 본다.

## 근거

### `shared/ipc.ts` 를 `types.ts` 에 합치지 않은 이유

`shared/types.ts` 는 **도메인 모양**(`Note`·`LinkRef`·`Vault`·`Fm`)이고 `cli/` 도 쓴다.
`ipc.ts` 는 **전송 계약**이고 CLI 와 무관하다. 합치면 `cli/` 가 `PiecePoolApi` 를,
`preload/` 가 `Fm` 을 끌고 들어온다.

동결한 이유는 셋이 같다 — 한쪽이 바꾸면 나머지 둘이 조용히 어긋난다. 타입은 통과하고
채널 문자열만 안 맞아 런타임에 아무 일도 안 일어난다. §8 이 동결로 묶은 것과 같은 실패 모양이다.

### `zustand` 를 고른 이유

- **경계가 이미 그어져 있다.** eslint zone 이 `renderer → core`·`renderer → main` 을 막으므로
  화면은 어차피 비동기 IPC 뒤에 있다. 스토어 하나에 소스를 모아 두면 목 데이터로 UI 를 먼저 짓고
  나중에 IPC 로 갈아끼울 수 있다 — 실제로 그렇게 지었다 (2026-09-14 크롬 → 실제 볼트 열기)
- **Context + reducer 로는 부족했다.** 탭·칸 상태가 초당 여러 번 바뀌는데(드래그·리사이즈),
  Context 는 값이 바뀌면 구독자 전체를 다시 그린다. 셀렉터로 구독 범위를 좁히는 것이 필요하다
- **Redux Toolkit 은 과하다.** 미들웨어·devtools·slice 생성기가 값을 하는 자리가 없다.
  프로세스 하나에 스토어 하나다

## 결과

- (+) 채널명 오타가 타입 에러가 된다. `preload` 가 `PiecePoolApi` 를 구현하므로
  화이트리스트에서 빠뜨린 멤버도 컴파일에서 잡힌다
- (+) `PiecePoolApi` 가 곧 공격 표면의 목록이다. 무엇이 renderer 에 열려 있는지 한 파일에서 센다
- (−) **동결 목록이 두 문서에 나뉜다.** 0단계 설계 §8 과 이 ADR 을 같이 봐야 15곳이 다 나온다.
  CLAUDE.md §3 이 두 곳을 모두 가리키게 했다
- (−) `zustand` 스토어가 하나뿐이라 `workspace.ts` 가 327줄까지 자랐다. 칸·탭이 더 늘면 쪼갠다

## 미결

- **`core/vault/notes.ts` 의 `readRaw`** — 동결 파일(`retitleNote` 제외 전체)에 새 export 가
  더해졌다. 기존 시그니처는 그대로지만 공개 표면이 늘었고 IPC 를 타고 renderer 까지 간다.
  상대 개발자 합의가 필요하다

## 대안

- **채널명을 main 과 preload 에 각각 적는다**: 0단계 설계가 `shared/types.ts` 하나로 막으려던
  그 실패다. 문자열은 타입이 없어 어긋나도 아무도 안 잡는다
- **renderer 상태를 Context 로**: 위 근거 참조. 드래그 중 전체 리렌더가 값이다
- **상태 라이브러리 없이 `useState` 만**: 사이드바 너비·탭 목록·칸 구조를 props 로 내리면
  `Shell → Pane → TabStrip` 3단 prop drilling 이 된다

## 추가 — 정리 채널 (2026-09-17)

3·4단계가 끝나 정리와 되돌리기를 화면에 잇는 채널이 필요해졌다. `shared/ipc.ts` 에 일곱을 더한다 —
`vault:tree` · `ingest:pending` · `ingest:sync` · `ingest:progress`(main → renderer 이벤트) · `restore:plan` ·
`restore:apply` · `key:has` · `key:set`. 타입은 `RestorePlan` · `IngestCommit` · `IngestSummary`.
왕민이 프론트를 넘긴 뒤(09-17)라 합의는 인계로 갈음한다.

- **renderer 가 경로를 보내는 두 번째 자리가 생겼다.** `restore:apply` 의 경로 목록이다. main 은
  문자열인지만 보고, 그 커밋이 건드린 경로인지는 `core/git/restore` 가 확인해 아니면 거부한다
- **키는 한 방향이다.** `key:set` 은 값을 main 으로 보내고 safeStorage 에 두며, 되읽는 채널은 없다.
  renderer 는 `key:has` 의 불리언만 안다. 과금을 앱이 맡는 방식이 정해지면 이 둘은 사라진다
- **진행은 요청한 창으로만 보낸다.** `ingest:sync` 를 부른 `webContents` 에 `ingest:progress` 를 쏜다.
  창이 여럿이어도 엉뚱한 창에 진행이 가지 않는다
- **git 신원은 묻지 않는다.** 처음 안은 `git:identity` 채널로 이름을 받는 것이었으나 사용자가
  "무슨 이름을 넣으라는 건가" 로 거부했다(09-17). 봉인 커밋의 작성자는 볼트에 git 이름이 있으면 그것,
  없으면 OS 계정 이름이다. 상위 §4.3 의 "앱이 임의 신원을 지어내지 않는다" 는 "지어내지 않되 묻지도 않는다"
  로 읽는다 — 로그인한 이름은 지어낸 것이 아니다
- 트리거는 명시적 [정리하기] 버튼이다. 편집기가 생기면 "노트가 식었을 때" 자동으로 바꾸는 안을 벤치마킹으로
  검토했다(Notion autofill 의 편집 뒤 5분, Smart Connections 의 일시정지). 결과는 OS 알림 + 앱 안 토스트
