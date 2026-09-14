# PiecePool Desktop — 실제 볼트 열기 — 설계

- 날짜: 2026-09-14
- 상태: 설계 승인됨 (구현 계획 대기)
- 상위 문서: `2026-09-05-electron-rebuild-design.md` — 재구축 전체 설계.
  이 문서는 그 11.3의 **7단계(IPC)와 1단계(vault) 일부**를 다룬다. 상위 문서의 절은 `상위 §4.1` 형식으로 인용한다.
- 선행: `2026-09-14-obsidian-chrome-design.md` — 목 데이터 위의 좌측 크롬. 그 목을 실물로 갈아끼우는 것이 이 조각이다.

## 1. 무엇을 만드나

사용자가 폴더를 고르면 그 폴더의 실제 마크다운 트리가 사이드바에 뜬다.

앞 조각의 `MOCK_TREE`(`src/renderer/store/workspace.ts`)를 지우고, 같은 자리에 IPC로 받은 트리를 넣는다.
컴포넌트는 한 줄도 고치지 않는다 — 앞 조각이 모든 상태를 스토어 뒤에 둔 것이 이 교체를 위해서였다.

파일 **내용**은 아직 읽지 않는다. 클릭하면 여전히 경로만 표시된다.

## 2. 결정 다섯

| 항목      | 결정                                       | 기각한 것                        | 근거                                        |
| --------- | ------------------------------------------ | -------------------------------- | ------------------------------------------- |
| 볼트 열기 | **읽기만.** `git init` 하지 않는다         | 상위 §4.1 대로 전부 / 열 때 묻기 | "사용자 폴더를 무단으로 바꾸지 않는다"      |
| preload   | vite lib 모드로 단일 `.cjs`                | electron-vite 도입 / 손으로 작성 | 지금 도는 것을 건드리지 않는다              |
| 트리 내용 | `.md` 와 폴더만. 점으로 시작하는 폴더 제외 | 모든 파일 / `.md` + PDF          | 옵시디언 기본 동작                          |
| 읽기 시점 | 열 때 전체를 한 번에                       | 펼칠 때마다 그 폴더만            | 실제 볼트가 `.md` 15장·10장 규모다          |
| 재시작    | 마지막 폴더를 자동으로 다시 연다           | 항상 선택 화면 / 최근 목록       | 옵시디언식. 개발 중 매번 고르지 않아도 된다 |

### 2.1 `openVault` 를 명세대로 구현하지 않는 이유

`src/core/vault/open.ts` 스텁의 주석은 "`.git` 이 없으면 init 하고, `.piecepool/.gitignore` 를 정비한다" 로 적혀 있다.
이번 조각은 그 중 **폴더 존재 확인과 `Vault` 생성만** 구현한다.

폴더를 구경하려고 열었을 뿐인데 그 폴더에 `.git` 과 `.piecepool` 이 생기는 것은
CLAUDE.md "제품이 지키는 여섯" 4번(사용자의 폴더 구조를 무단으로 바꾸지 않는다)에 걸린다.
`isomorphic-git` 설치(3단계)도 딸려온다.

git 초기화는 **에이전트가 처음 쓸 때** 붙인다. 그때가 안전망이 실제로 필요해지는 시점이다.
스텁 주석을 그에 맞게 고치고, 남은 몫을 주석에 남긴다.

### 2.2 preload 가 왜 별도 빌드를 요구하나

`src/main/index.ts` 의 `BrowserWindow` 는 `sandbox` 를 명시하지 않으므로 Electron 기본값 `true` 가 걸린다.
**샌드박스 preload 는 ESM 을 쓸 수 없고 단일 CommonJS 파일이어야 한다.**
`main` 이 쓰는 Node type stripping 도, `renderer` 가 쓰는 vite 번들도 이 형식을 만들어 주지 않는다.

vite lib 모드 설정 하나를 더 두어 `src/preload/index.ts` → `out/preload/index.cjs` 로 묶는다.
`electron-vite`(상위 §112 가 채택)는 패키징을 시작할 때 3타깃을 한꺼번에 정리하며 도입한다.

## 3. 데이터가 흐르는 길

```
renderer            preload              main                  core
─────────           ─────────            ─────────             ─────────
store.pickVault()
  → window.piecepool.pickVault()
                    → invoke("vault:pick")
                                         → dialog.showOpenDialog()
                                         → openVault(경로)   → 폴더 존재 확인
                                         → 마지막 경로 저장
                                         → readTree(v)       → 디스크 순회
                    ←──────── Result<VaultPayload> ────────
  ← 스토어에 넣는다
```

**renderer 는 경로를 보내지 않는다.** "폴더를 골라 줘" 와 "지금 볼트를 줘" 두 마디뿐이고,
경로는 `main` 이 쥔다. 렌더러가 임의 경로를 밀어 넣을 통로가 애초에 없다.

열린 `Vault` 는 `main/ipc.ts` 의 모듈 변수 하나가 쥔다. 창이 하나뿐이므로 그 이상이 필요 없다.

**실패는 화면에 보인다.** 폴더를 읽지 못하면(권한·삭제 등) `wrap()` 이 `Result` 의 실패 쪽으로
`AppError` 를 담아 보내고, 사이드바는 트리 자리에 그 `message` 를 띄운다.
조용히 빈 트리로 떨어뜨리지 않는다 — 빈 볼트와 읽기 실패는 다른 상태다.

## 4. 파일

| 파일                              | 상태      | 하는 일                                            |
| --------------------------------- | --------- | -------------------------------------------------- |
| `src/shared/ipc.ts`               | **신규**  | 채널명과 요청/응답 타입. `TreeNode` 가 여기로 이사 |
| `src/core/vault/open.ts`          | 스텁 채움 | 폴더 존재 확인 후 `Vault` 반환. git 없음           |
| `src/core/vault/tree.ts`          | **신규**  | 디스크 순회. 심볼릭 링크 폴더는 따라가지 않는다    |
| `src/main/ipc.ts`                 | 스텁 채움 | 핸들러 2개. 기존 `wrap()` 으로 감싼다              |
| `src/main/recent.ts`              | **신규**  | `userData` 에 마지막 볼트 경로 하나                |
| `src/main/index.ts`               | 수정      | `preload` 경로 지정 · `registerHandlers()` 호출    |
| `src/preload/index.ts`            | 스텁 채움 | `contextBridge` 화이트리스트 2개                   |
| `vite.preload.config.ts`          | **신규**  | preload 를 단일 `.cjs` 로                          |
| `src/renderer/store/workspace.ts` | 수정      | `MOCK_TREE` 제거. 볼트 상태와 IPC 호출 추가        |
| `src/renderer/app/Sidebar.tsx`    | 수정      | 하단 볼트 전환기 · 빈 상태                         |
| `src/renderer/app/FileTree.tsx`   | 수정      | 화면에 그릴 때 `.md` 를 뗀다                       |

`src/shared/` 는 CLAUDE.md §1 이 "동결" 로 분류한 폴더다. 다만 `shared/ipc.ts` 는
`main/ipc.ts` 첫 줄 주석이 **"채널명과 요청/응답 타입은 shared/ipc.ts 에 둔다(아직 없음)"** 로
예고해 둔 파일이므로, 새로 정하는 것이 아니라 예정된 자리를 채우는 것으로 본다.

## 5. IPC 계약

채널 2개. 둘 다 `Result<T>` 를 돌려준다 — `main/ipc.ts` 의 `wrap()` 이 이미 그 형태다.

| 채널         | 요청 | 응답                   | 하는 일                                      |
| ------------ | ---- | ---------------------- | -------------------------------------------- |
| `vault:pick` | 없음 | `VaultPayload \| null` | 폴더 선택 창을 띄운다. 취소하면 `null`       |
| `vault:last` | 없음 | `VaultPayload \| null` | 기억된 볼트를 연다. 없거나 사라졌으면 `null` |

새로고침 채널은 두지 않는다. 외부 변경 감시가 범위 밖이므로 다시 읽을 계기가 없다 —
파일 감시를 붙이는 조각에서 그때 만든다.

```ts
export interface VaultPayload {
  root: string; // 절대경로
  name: string; // 폴더 이름. 하단 전환기에 표시한다
  tree: TreeNode[];
}

export interface TreeNode {
  name: string; // 파일명 그대로. `.md` 포함
  path: NotePath; // 볼트 루트 기준 상대경로, POSIX 구분자
  kind: "dir" | "file";
  children?: TreeNode[];
}
```

`TreeNode` 는 앞 조각에서 `renderer/store/workspace.ts` 에 두고 "진짜가 되는 순간
`shared/ipc.ts` 의 응답 타입으로 태어나야 한다" 고 적어 두었다. 지금이 그 순간이다.
스토어는 이 타입을 **재수출**한다 — `FileTree.tsx` 의 import 가 그대로 동작해야 한다.

`vault:pick` 과 `vault:last` 가 트리까지 함께 실어 보내는 이유: 볼트를 열면 트리는 항상 필요하다.
두 번 왕복할 이유가 없다.

## 6. 트리를 읽는 규칙

- 볼트 루트부터 재귀적으로 읽는다
- **제외:** 이름이 `.` 으로 시작하는 디렉터리(`.git` · `.obsidian` · `.piecepool`), `.md` 가 아닌 파일
- **심볼릭 링크 디렉터리는 따라가지 않는다** — 볼트 밖으로 나가거나 순환할 수 있다
- **정렬:** 디렉터리가 먼저, 그 다음 파일. 각 묶음 안에서는 이름순
- 빈 폴더도 보여준다. 사용자가 만든 구조를 앱이 판단해 감추지 않는다

## 7. 화면

```
┌────┬─────────────────────────┐
│ ▣  │ wiki                    │
│    │   concepts              │
│    │     머신러닝             │   ← `.md` 를 떼고 그린다
│    │   index                 │
│    ├─────────────────────────┤
│    │ ⌃⌄  second-brain        │   ← 볼트 전환기 (하단 고정)
└────┴─────────────────────────┘
```

- **볼트 전환기**는 사이드바 하단에 고정한다. 트리가 길어도 항상 보인다
- 누르면 폴더 선택 창이 뜬다. 고르면 그 폴더로 갈아탄다
- 볼트가 없을 때는 같은 자리에 "폴더 열기" 로 표시된다. 동작은 같다
- **파일명에서 `.md` 를 뗀다.** `.md` 만 보여주므로 확장자가 정보를 주지 않는다.
  `TreeNode.path` 는 `.md` 를 유지한다 — 화면에 그릴 때만 뗀다
- 리본에는 폴더 아이콘을 넣지 않는다. 진입점이 둘이면 헷갈린다

## 8. 경로 안전

이번 조각에서는 `src/core/vault/paths.ts`(FROZEN)의 `resolveInVault` 를 구현하지 않는다.
renderer 가 경로를 보내지 않으므로 검증할 입력이 없다.

**파일 내용을 읽기 시작하는 다음 조각의 첫 번째 할 일이 `resolveInVault` 구현이다.**
그 시점부터 renderer 가 보낸 경로가 디스크에 닿는다.

## 9. 테스트

지금까지는 순수 로직만 테스트했다. 이번에는 실제로 파일을 읽는 코드가 생기므로,
임시 폴더에 볼트 픽스처를 만들어 vitest 에서 검증한다.

- `src/core/vault/tree.test.ts`
  - 점으로 시작하는 디렉터리를 건너뛴다
  - `.md` 가 아닌 파일을 제외한다
  - 디렉터리가 파일보다 먼저 오고, 각 묶음은 이름순이다
  - 중첩 폴더가 `children` 으로 들어간다
  - 빈 폴더도 결과에 남는다
  - 심볼릭 링크 디렉터리를 따라가지 않는다 (Windows 에서 링크 생성이 실패하면 건너뛴다)
- `src/core/vault/open.test.ts`
  - 정상 폴더에서 `Vault` 를 만든다
  - 없는 폴더는 `vault_not_found` 로 throw 한다
  - **폴더에 `.git` 이나 `.piecepool` 을 만들지 않는다** — 2.1 의 결정을 못 박는다

DOM 테스트는 만들지 않는다. `vitest.config.ts` 는 `environment: "node"` 이고
`include` 가 `src/**/*.test.ts` 다. 화면은 사람이 본다 (CLAUDE.md §7).

## 10. 통과 조건

- `npx prettier --check .` · `npm run lint` · `npm run typecheck` · `npm test` 전부 통과
- `npm start` 한 번으로 preload 빌드까지 끝난다 (`npm run dev` 는 그대로 따로)
- 창에서
  - 처음 켜면 하단에 "폴더 열기" 가 보인다
  - 누르면 OS 폴더 선택 창이 뜬다
  - `dev/piecepool-vault-personal` 을 고르면 `wiki/` · `inbox/` · `sources/` 가 뜨고 `.obsidian` · `.piecepool` 은 안 보인다
  - 파일명에 `.md` 가 없다
  - 앱을 껐다 켜면 같은 볼트가 그대로 열린다
  - 하단 전환기를 다시 눌러 다른 폴더로 갈아탈 수 있다
- **모양은 사람이 판단한다**

## 11. 범위 밖

파일 내용 읽기 · 에디터 · 파일 감시(외부 변경 자동 반영) · 최근 볼트 **목록**(경로 하나만 기억) ·
git · 인덱스 · 링크 · 그래프 · 새 노트 만들기 · 우클릭 메뉴 · 사이드바 상단 아이콘 줄 ·
`electron-vite` 도입 · 프로덕션 빌드 · CSP

## 12. 따라오는 문서 작업

| 무엇                                            | 왜                                   |
| ----------------------------------------------- | ------------------------------------ |
| CLAUDE.md §1 의 `src/main/` · `src/preload/` 행 | preload 와 ipc 가 더는 스텁이 아니다 |
| CLAUDE.md §5 의 스텁 개수                       | 다시 줄어든다                        |
| README 단계 표의 7단계 행                       | IPC 가 들어왔다                      |
