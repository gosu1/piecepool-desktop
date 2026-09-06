# PiecePool Desktop

자료를 넣으면 LLM 에이전트가 읽고 **위키를 만들어 관리하는** 데스크톱 앱.
React + Electron 셸, macOS · Windows 지원.

옵시디언이 IDE라면 LLM이 프로그래머이고 위키가 코드베이스다 —
자료를 색인만 하는 게 아니라, 에이전트가 기존 페이지를 읽고 갱신·교차링크·중복제거한다.

> **지금 상태: 0단계.** 폴더와 배선만 있고 기능은 전부 비어 있다.
> 실행하면 `unimplemented: ...` 로 죽는 게 정상이다.

---

## 먼저 알아야 할 것 넷

코드를 5분만 만져도 부딪히는 것들이다.

### 1. 볼트와 코드 레포는 완전히 다른 폴더다

```
dev/piecepool-desktop/    ← 이 저장소. 앱 코드
사용자가고른폴더/           ← "볼트". 사용자의 마크다운 노트. 별개의 git 저장소
```

볼트는 앱이 만들지 않는다. 사용자가 옵시디언처럼 폴더를 고른다.
기존 옵시디언 볼트를 그대로 열 수도 있다.
`core/git/` 은 **볼트의** git 을 다루는 코드다. 이 저장소의 git 이 아니다.

### 2. `core/` 는 자기를 누가 부르는지 모른다

```
cli/  ──┐
        ├──▶  core/     (역방향 import 금지 — lint 가 막는다)
main/ ──┘
```

`core/` 는 순수 Node 엔진이다. Electron 을 띄우지 않고 `node` 로 돌릴 수 있고,
그래서 테스트도 임시 폴더만 만들면 vitest 에서 그대로 돈다.

진행 상황은 `console.log` 가 아니라 `onProgress` 콜백으로 나간다.

```ts
ingest(file, { onProgress: (p) => void })
// CLI      → console.log 를 넘긴다
// Electron → win.webContents.send 를 넘긴다
// 엔진은 어느 쪽인지 모른다
```

이 경계가 지켜지면 나중에 Electron 을 붙이는 일이 **호출자를 하나 더 다는 일**로 끝난다.

### 3. 거의 전부 스텁이다

```ts
export async function readNote(v: Vault, p: NotePath): Promise<Note> {
  throw new Error("unimplemented: core/vault/notes.readNote");
}
```

에러 메시지에 위치가 박혀 있으니, 실행해서 죽는 자리가 곧 다음에 채울 자리다.
실동작하는 건 `core/assets.ts` · `core/prompts/load.ts` · `main/ipc.ts` 세 개뿐이다.

### 4. 문법 제약 두 개

`node` 가 `.ts` 를 직접 실행하기 때문에 (타입만 지우고 코드를 만들지 않는다) 생기는 제약이다.

```ts
import { readNote } from "./notes.ts";   // ✅ .ts 확장자를 반드시 붙인다
import { readNote } from "./notes";      // ❌ Node 는 확장자를 추론하지 않는다

enum Kind { A, B }                        // ❌ 런타임에 죽는다 — 유니온이나 as const 를 쓴다
class C { constructor(readonly x: T) {} } // ❌ 파라미터 프로퍼티도 죽는다
```

셋 다 lint 가 잡는다. 외우지 않아도 된다.

---

## 왜 이렇게 만들었나

이전 버전은 Tauri + Rust 였고 지식 모델이 달랐다. 둘 다 바꿨다.

| | 이전 | 지금 | 이유 |
|---|---|---|---|
| 셸 | Tauri + Rust | Electron + TS | Rust 4,800줄을 유지할 이유가 없어졌다 |
| 지식 모델 | 관계 타입 12종 + `relations.json` | 타입 없는 `[[]]` 링크 | 관계의 의미는 스키마가 아니라 링크 주변 산문이 담는다 |
| LLM 쓰기 | JSON 제안 → 검증 → 앱이 반영 | **에이전트가 파일을 직접 편집** | 파이프라인이 통째로 사라진다 |
| 진실의 소재 | `relations.json` + 마크다운 | **마크다운 파일만** | 옵시디언으로 열면 그냥 보인다 |
| 안전망 | 저장 전 검증 게이트 | **볼트 git 커밋 + 되돌리기** | 아래 참조 |

**안전망이 바뀐 게 핵심이다.** 파일이 유일한 진실이면 저장을 막을 근거가 없다 —
사용자가 옵시디언으로 직접 고친 파일도 똑같이 유효해야 하니까.
그래서 "막기" 대신 "되돌리기" 로 간다. 검증은 나중에 `lint` 가 보고하는 관찰로 내려간다.
깨진 링크는 에러가 아니라 할 일 목록의 한 줄이다.

---

## 코드 구조

```
src/
├─ shared/     타입과 상수만. fs·window 금지 (Node·브라우저가 함께 쓴다)
│
├─ core/       ★ 엔진. 순수 Node. 호출자를 모른다
│  ├─ vault/     볼트 읽기·쓰기. paths.ts 가 경로 탈출을 막는 유일한 지점
│  ├─ index/     [[]] 파싱 → 링크·백링크. 파생 캐시라 지워도 된다
│  ├─ git/       볼트의 git. 커밋과 되돌리기
│  ├─ ingest/    PDF·마크다운에서 텍스트 뽑기
│  ├─ agent/     에이전트 루프 · 툴 6종 · 작업 4종
│  ├─ llm/       Gemini
│  └─ prompts/   프롬프트 4종 (.md 파일. 런타임에 읽는다)
│
├─ cli/        얇은 진입점. onProgress 로 console.log 를 넘긴다
├─ main/       Electron main (7단계에 채운다)
├─ preload/    contextBridge 화이트리스트 (7단계)
└─ renderer/   React UI (8단계)
```

### 에이전트가 하는 일

| 작업 | 하는 일 | 커밋 |
|---|---|---|
| `ingest` | 새 자료를 읽고 페이지 갱신·생성·교차링크 | 1개 |
| `processInbox` | `inbox/` 단편 메모를 위키로 편입 | 1개 |
| `lint` | 깨진 링크·고아·중복·미검증 문단 보고 | 수정 시 1개 |
| `query` | 위키를 근거로 답변 (**읽기 전용 툴만**) | 없음 |

쓰기 경로는 언제나 `ingest` 하나뿐이다.
쿼리 세션 내용도 사용자가 [위키에 반영] 을 누르면 `ingest` 를 거쳐 들어간다.

### 볼트 안은 이렇게 생겼다

```
사용자가고른폴더/
├─ .git/          앱이 관리. 계정 불필요 (isomorphic-git)
├─ wiki/          위키 페이지
├─ inbox/         미정리 메모
├─ sources/       원본 파일과 추출 텍스트
└─ .piecepool/    인덱스 캐시 · 세션 로그
```

---

## 시작하기

```bash
npm ci
npm run lint         # 경계 규칙 검사
npm run typecheck
npm test
npm run ingest -- <볼트폴더> <파일>    # unimplemented 로 죽는다 (정상)
```

Node 22.12 이상이 필요하다 (`.nvmrc` 참조). `electron` 과 `react` 는 아직 설치하지 않았다 —
7·8단계에서 넣는다.

---

## 지금 어디까지 왔나

| 단계 | 내용 | 상태 |
|---|---|---|
| 0 | 레포 골격 | **완료** |
| 1 | `vault/` — 볼트 읽기·쓰기 | |
| 2 | `index/` — 링크 파싱·백링크 | |
| 3 | `git/` — 커밋과 되돌리기 | ← 4단계보다 **먼저** 해야 한다 |
| 4 | `ingest` + `agent` | PDF 를 넣으면 위키가 생긴다 |
| 5 | `lint` · `processInbox` | |
| 6 | 쿼리 세션 + 수확 | |
| 7 | Electron 셸 | |
| 8 | 편집 UI · 그래프 뷰 | |

3단계가 4단계보다 앞인 게 중요하다.
안전망 없이 에이전트에게 쓰기 권한을 주면 첫 실수에서 볼트를 복구할 방법이 없다.

### 작업 분담

두 갈래가 6단계에서 다시 만난다.

```
A: 문서 → wiki          B: wiki → query
   ingest/pdf.ts           agent/tasks/query.ts
   agent/tasks/ingest.ts   수확 · 세션 로그 · 출처 각주
        │                       │
        └───────┬───────────────┘
          공유:  vault/  index/  git/  agent/  llm/
```

B 는 A 를 기다릴 필요가 없다. 위키는 그냥 마크다운 폴더라
**옵시디언으로 손수 쓴 볼트**로 개발하면 된다.

두 사람이 부딪히는 지점은 다섯 개뿐이고, 전부 시그니처가 정해져 있다.
한쪽이 바꾸면 다른 쪽에 타입 에러가 난다.

| 무엇 | 어디 | 왜 |
|---|---|---|
| `IngestSource` | `agent/tasks/ingest.ts` | 파일 경로만 받으면 B 가 대화 로그를 넘길 수 없다 |
| `Written` | `agent/written.ts` | 전역이면 두 작업의 커밋 경로가 섞인다 |
| `commit(paths[])` | `git/commit.ts` | 세션 로그는 툴이 아니라 호출부가 쓴다 |
| `createTools(readOnly)` | `agent/tools.ts` | query 는 읽기 전용 툴만 받는다 |
| `addSource` | `vault/frontmatter.ts` | 덮어쓰면 상대의 출처가 사라진다 |

---

## 규칙 — 전부 lint 가 강제한다

외울 필요 없다. 어기면 `npm run lint` 가 잡는다.

| 규칙 | 이유 |
|---|---|
| `core/` → `cli`·`main`·`preload`·`renderer` import 금지 | 엔진은 호출자를 모른다 |
| `core/` 에서 `console.log`·`process.exit`·`process.argv` 금지 | 실행 환경을 엔진에 심지 않는다 |
| `shared/` 에서 `node:*`·`window`·`document` 금지 | 양쪽이 함께 쓰므로 |
| `shared/` → `core/` 역방향 import 금지 | `fs` 가 renderer 번들로 새어든다 |
| `.ts` 확장자 필수 · `enum`·`namespace`·파라미터 프로퍼티 금지 | `node` 가 `.ts` 를 직접 실행하므로 |

에러는 `core/` 에서 `throw` 하고 **IPC 경계에서만** `Result` 로 감싼다
(`main/ipc.ts` 의 `wrap()`). Electron IPC 가 예외를 삼키기 때문이지,
예외를 안 쓰기 때문이 아니다.

---

## 역할

| 사람 | GitHub | 담당 |
| --- | --- | --- |
| 박서준 | @gosu1 | 테크리드, gem 기능 |
| 윤세훈 | @dbstpgns789-eng | 입력, 위키 |
| 왕민 | @kingmin-1225 | 위키, 세션 |
| 오준서 | @O6west | UI/UX, gem 기능 |
| 윤무진 | @ChangSik88 | UI/UX, gem 기능 |
| 정현우 | @Black-Tiger-h | UI/UX, gem 기능 |

---

## 더 읽을 것

이 README 로 부족할 때만 보면 된다.

| 문서 | 언제 |
|---|---|
| [재구축 설계](docs/superpowers/specs/2026-09-05-electron-rebuild-design.md) | 기능 판단이 필요할 때. 볼트 구조·링크 규칙·에이전트 동작의 근거 |
| [0단계 골격 설계](docs/superpowers/specs/2026-09-06-repo-skeleton-design.md) | "왜 이렇게 배선했지?" 싶을 때. 설정 하나하나의 이유 |
| [ADR-0001](docs/adr/0001-electron-shell-llm-wiki.md) | 재구축 결정 요약 |
| [구 레포 ADR](docs/adr/legacy/) | PDF 추출·OCR 등 이전에 값을 치른 판단들 (상태: 대체됨) |
