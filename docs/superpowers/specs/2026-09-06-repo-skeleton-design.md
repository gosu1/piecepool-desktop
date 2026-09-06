# PiecePool Desktop — 0단계 레포 골격 — 설계

- 날짜: 2026-09-06
- 상태: 설계 승인됨 (구현 계획 대기)
- 대상: `C:\Users\dhkda\dev\piecepool-desktop` (GitHub `gosu1/piecepool-desktop`)
- 상위 문서: `2026-09-05-electron-rebuild-design.md` — 재구축 전체 설계.
  이 문서는 그 11.3의 **0단계**만 다룬다. 이하 상위 문서의 절은 `상위 §2.3` 형식으로 인용한다.

## 1. 상위 설계와 달라진 전제

상위 문서는 새 저장소 `dev/piecepool-next`를 1인이 순차로 짓는 것을 암묵적 전제로 한다.
실제는 다르고, 그 차이가 0단계의 임무를 바꾼다.

|        | 상위 문서                   | 실제                                   |
| ------ | --------------------------- | -------------------------------------- |
| 저장소 | `dev/piecepool-next` (신규) | `dev/piecepool-desktop` (README 3커밋) |
| 인원   | 1인 순차                    | **2인 병렬**                           |

개발자 2인의 역할:

- **A — 문서 → wiki.** 인제스트 경로. 상위 §11.3의 1~5단계
- **B — wiki → query.** 쿼리 세션과 수확. 상위 §11.3의 6단계

README의 6인 역할표와 "gem 기능"은 이번 범위에서 다루지 않는다.
저장소 폴더명은 `piecepool-desktop`이지만 **패키지·앱 이름은 `piecepool`** 이다(상위 §12).

## 2. 0단계의 임무 — `core/` 전체가 아니라 A↔B 경계면

초안은 "`core/` 전체의 시그니처를 확정한다"였다. 검토 결과 과녁이 어긋났다.

**B는 A에 단방향으로 의존한다.** 상위 §8.1이 "쓰기 경로는 언제나 `ingest` 하나뿐"이라
못 박았고, B의 수확이 `ingest`를 재호출하기 때문이다. 두 사람이 실제로 부딪히는 면은 5개뿐이다.

나머지 `core/` 모듈(`llm/` · `agent/loop.ts` · `index/watch.ts` · `git/restore.ts` 등)은
A 또는 B **단독 소유**이며 상대에게 노출되지 않는다. 지금 시그니처를 고정해도 병렬성이 늘지 않고,
4~6단계에서 바뀔 때 "0단계에서 정한 것"이라는 관성만 남는다.
이를 **거짓 안정성**이라 부르고 피한다 — 스텁을 두 등급으로 나누는 이유다(§8).

특히 `git/restore.ts`는 상위 §4.3의 실패 모드가 **사용자 왕복 상호작용**(파일 단위 선택)이다.
콜백인지 2-phase(계획 반환 → 적용)인지가 7단계 IPC 설계에 걸려 있어 지금 정하면 확실히 틀린다.

## 3. 경계면 5개 — 이 문서의 핵심

각 항목은 "타입 체크는 통과하지만 상대가 쓸 수 없는" 형태가 되는 지점이다.
컴파일러가 잡아주지 않으므로 여기서 못 박는다.

### 3.1 `IngestSource` — B의 착수를 가로막던 지점

`ingest.run(file: string)` 형태면 B는 대화 로그를 넘길 방법이 없다.
상위 §8.1은 "전용 프롬프트를 두지 않는다 … 출처가 세션 파일이라는 사실만
**호출부가 인자로 넘겨** 8.2의 각주를 달게 한다"고 요구한다.

```ts
// src/core/agent/tasks/ingest.ts
type IngestSource =
  | { kind: "file"; path: string } // 볼트 밖 PDF/.md (상위 §1.1)
  | { kind: "session"; id: string; log: string }; // 수확 (상위 §8.1)

export function run(
  v: Vault,
  src: IngestSource,
  o?: {
    onProgress?: OnProgress;
    /** 툴이 아니라 호출부가 쓴 파일. 커밋 경로에 함께 넣는다 (§3.3). */
    extraPaths?: NotePath[];
  },
): Promise<IngestResult>;

// IngestResult.written 은 이 커밋에 들어간 전체 경로다 = 툴이 쓴 것 U extraPaths.
// 되돌리기가 이 목록을 그대로 받으므로 커밋 단위와 어긋나면 안 된다.
```

### 3.2 `Written`의 수명 — run 단위 객체

상위 §4.3: "경로 집합은 커밋 단위의 1급 개념이다."
문서는 이것이 전역 싱글턴인지 작업 1회당 객체인지 말하지 않는다.

전역이면 인제스트와 수확이 겹치는 순간 두 경로 집합이 섞여 **한쪽 커밋이 남의 파일까지 add**한다.
상위 §4.3이 막으려던 실패("되돌리면 사용자 작업이 함께 날아간다")와 정확히 같은 형태가
코드 안쪽에서 재현된다.

```ts
// src/core/agent/written.ts
export class Written {
  add(p: NotePath): void;
  paths(): NotePath[];
}
// 전역 인스턴스를 export 하지 않는다. run 단위로 만들어 인자로 흘린다.
```

### 3.3 `commit()`은 경로 배열을 받는다

상위 §4.2가 두 곳에서 "경로 집합 ∪ 호출부가 추가하는 경로"를 명시적으로 요구한다 —
세션 로그와 `.gitignore`는 "툴이 아니라 main이 직접 쓰므로" 경로 집합에 자동으로 들어오지 않는다.

`commit(written)` 형태로 좁히면 B의 수확 커밋이 세션 로그를 담을 수 없다.
같은 이유로 한 층 위의 `ingest.run`도 `extraPaths`를 받아야 한다 —
`run`이 내부에서 커밋하므로 그 자리가 없으면 세션 로그가 두 번째 커밋으로 밀린다.

```ts
// src/core/git/commit.ts
export function commit(
  v: Vault,
  paths: NotePath[], // written.paths() ∪ 호출부가 더한 경로
  author: Author,
  msg: string,
): Promise<string>;
```

### 3.4 툴의 읽기 전용 서브셋

상위 §7.3: "`query` — 위키를 근거로 답변. **읽기 전용 툴만 부여**."
`createTools(vault)` 형태로는 B의 요구를 표현할 수 없다.

```ts
// src/core/agent/tools.ts
export function createTools(v: Vault, w: Written, o: { readOnly?: boolean }): Tool[];
```

### 3.5 `Fm.sources`는 append-only

상위 §8.2는 대화 출신 내용에 두 층의 꼬리표를 요구한다 —
프론트매터 `sources:`에 `.piecepool/sessions/<id>.md` 추가, 문단에 각주 `[^conv-<sessionId>]`.
A가 `sources`를 덮어쓰는 구현을 하면 B의 세션 출처가 조용히 사라진다.

이 규약은 **타입으로 표현할 수 없다** — `string[]`은 대입도 허용한다.
그래서 규약을 API 표면으로 옮긴다.

```ts
// src/core/vault/frontmatter.ts
export function addSource(fm: Fm, source: string): Fm; // 중복 제거 후 append
// setSources 는 만들지 않는다. 덮어쓰는 경로를 구조적으로 없앤다.
```

### 3.6 경계면 밖의 소유권

타입으로 못 박을 수 없어 규약으로 남기는 것:

- **`core/prompts/*.md` 4종의 소유자는 A다.** 상위 §8.1이 "수확은 `ingest` 프롬프트를
  **그대로** 쓴다"고 정했으므로 B는 프롬프트를 고치지 않고 §3.1의 인자로만 개입한다
- **`index/watch.ts`의 자기 쓰기 억제(상위 §6.2)는 A 단독 소유다.** B는 관여하지 않는다

## 4. 데이터 모델 — `src/shared/types.ts`

0단계에서 유일하게 내용이 다 차는 파일이다.

```ts
type NotePath = string; // 볼트 루트 기준 상대경로, POSIX 구분자 고정

interface Vault {
  root: string;
  agentWriteRoot: string;
}

interface Fm {
  title?: string;
  created?: string; // ISO date 문자열
  updated?: string;
  sources?: string[]; // append-only (§3.5)
}

interface Note {
  path: NotePath;
  title: string;
  frontmatter: Fm;
  body: string;
}
interface LinkRef {
  from: NotePath;
  to: string;
  resolved: NotePath | null;
}
interface GraphData {
  nodes: { id: NotePath; title: string }[];
  edges: { source: NotePath; target: NotePath }[];
}

type Progress = { step: string; detail?: string };
type OnProgress = (p: Progress) => void;

type ErrorKind =
  "vault_not_found" | "path_escape" | "parse_failed" | "llm_failed" | "git_failed" | "unknown";
interface AppError {
  kind: ErrorKind;
  message: string;
}
type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };
```

상위 문서에서 바꾼 것과 그 근거:

- **`Vault`를 도입했다.** 상위 §5는 볼트를 경로 문자열로 다루는 것처럼 읽히지만,
  상위 §2.2의 `vault/open.ts`와 상위 §4.1의 "에이전트 쓰기 루트를 설정에서 바꾼다"가 상태를 요구한다.
  `vault: string`으로 확정하면 1~3단계에서 거의 모든 함수가 인자를 하나 더 얻으며 통째로 바뀐다.
  `open.ts`가 `Vault`를 반환하고 나머지가 받는 형태면 필드가 늘어도 시그니처는 그대로다
- **`Fm`은 상위 문서에 정의가 없다.** 상위 §5의 `Note`가 참조만 하고 YAML 예시 4개만 있다.
  **4필드 전부 optional**이어야 한다 — 상위 §4.1이 "임의 옵시디언 볼트를 열면 열람·편집·링크·그래프가
  볼트 전체에 대해 동작한다"고 요구하는데 남의 볼트 노트에는 프론트매터가 아예 없다.
  상위 §5.1("검증은 게이트가 아니라 관찰")이 이를 뒷받침한다
- **`created`/`updated`는 `string`이다.** YAML 예시가 `created: 2026-09-05`(따옴표 없음)이라
  파서가 `Date` 객체로 역직렬화한다. 이 값은 IPC와 상위 §8.2의 각주 로직까지 흐르므로
  ISO 문자열로 고정하고 파서가 정규화한다
- **`ErrorKind`에 `"unknown"`을 더했다.** 상위 §9의 5종에는 폴백이 없다.
  `JSON.parse` 실패·`EACCES`·LLM SDK 내부 예외처럼 `core/`가 만들지 않은 예외가 항상 존재하고,
  0단계의 `unimplemented` 에러가 그 첫 사례다. 폴백이 없으면
  상위 §9가 요구한 "renderer는 `kind`로 분기한다"가 결국 문자열 매칭으로 되돌아간다
- **`Progress`를 객체로 만들었다.** 상위 §11.2 예시는 `(msg) => void`로 문자열이다.
  상위 §2.2가 `main/ipc.ts`에서 `webContents.send`로 흘린다고 정했으므로 7단계 UI가 `step`으로
  분기할 수 있어야 한다. **structured-clone 가능해야 하므로** `Error`나 함수 필드를 넣지 않는다

## 5. 에러 처리 — `Result`는 IPC 경계에서만

상위 §9는 "**IPC 핸들러는** 절대 throw하지 않는다"로 범위를 스스로 IPC에 한정했고,
이유도 "Electron IPC는 예외를 삼킨다"는 IPC 고유 문제다.

> **`core/`는 `throw`한다. `main/ipc.ts`가 `Result`로 감싼다.**

`core/`까지 `Result`를 강제하면 CLI 호출자(상위 §2.2의 0~6단계 주 진입점)가 매 호출마다 언랩해야 하고
스택 트레이스를 잃는다.

`kind`를 런타임에 읽으려면 클래스가 필요한데, 클래스는 상위 §2.6의 "타입과 순수 상수만"에
해당하지 않는다. 따라서 둘로 나눈다.

|        | 위치                  | 내용                                          |
| ------ | --------------------- | --------------------------------------------- |
| 타입   | `src/shared/types.ts` | `ErrorKind` · `AppError` · `Result<T>`        |
| 클래스 | `src/core/errors.ts`  | `class PiecePoolError extends Error { kind }` |

`main/ipc.ts`가 `core/errors`를 import해 `instanceof`로 `kind`를 읽고,
못 읽으면 `"unknown"`으로 떨어뜨린다. `main → core`는 상위 §2.3상 합법 방향이다.

`src/cli/run.ts`도 하나 둔다 — 에러를 메시지와 종료 코드로 바꾸는 자리다.
상위 §11.2의 `process.exit()` 금지는 **엔진 한정**이므로 CLI에서는 합법이다.
이걸 두지 않으면 `cli/*.ts` 5개가 각자 try/catch를 짠다.

## 6. 경계 강제 — ESLint

상위 §2.3은 "ESLint `no-restricted-imports`로 검사한다 — 관습이 아니라 규칙이다"라고 적었다.
**그 규칙만으로는 부족하다는 것을 실측으로 확인했다.**

| 케이스                                    | `no-restricted-imports` | `import/no-restricted-paths` |
| ----------------------------------------- | ----------------------- | ---------------------------- |
| `import "../../cli/ingest.ts"`            | O                       | O                            |
| `import "../../cli"` (디렉터리)           | **놓침**                | O                            |
| `await import("../../cli/ingest.ts")`     | **놓침**                | O                            |
| `src/core/main/legit.ts` (core 내부 폴더) | **오탐**                | O (정상 통과)                |
| `electron` (bare 패키지)                  | O                       | 대상 아님                    |

원인: `no-restricted-imports`의 `patterns`는 **import 문자열 자체**를 minimatch로 비교한다.
해석된 실제 경로가 아니다. `import/no-restricted-paths`는 파일을 해석해 zone을 판정한다.
**두 규칙은 대체재가 아니라 상호 보완이다.**

배선 규칙:

| 대상            | 규칙                                       | 막는 것                                                                                     |
| --------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| 전역            | `import/no-restricted-paths` (zone 11)     | `core → cli/main/preload/renderer`, `shared → core/cli`, `renderer/preload → core/main/cli` |
| 전역            | `import/no-unresolved`                     | 해석 실패의 침묵 (아래)                                                                     |
| `src/core/**`   | `no-console`                               | 상위 §2.3 "`console.log`를 결과 전달 수단으로 쓰기" 금지                                    |
| `src/core/**`   | `no-restricted-properties`                 | `process.exit` · `process.argv` (상위 §11.2)                                                |
| `src/core/**`   | `@typescript-eslint/no-restricted-imports` | `electron` (bare 패키지)                                                                    |
| `src/shared/**` | `no-restricted-globals`                    | `window` · `document` · `localStorage`                                                      |
| `src/shared/**` | `@typescript-eslint/no-restricted-imports` | `node:*` · `electron` (`allowTypeImports: true`)                                            |
| `src/cli/**`    | `no-console: off`                          | 상위 §2.2 "onProgress = console.log"                                                        |

반드시 지켜야 할 세 가지 — 전부 실측으로 확인했다.

- **`tseslint.configs.recommended`를 spread 한다.** 없으면 파서가 TypeScript가 아니다.
  평범한 import만 있는 파일에서는 "동작하는 것처럼" 보이다가 첫 `import type`에서 파싱 에러가 난다
- **`import/no-unresolved`를 함께 켠다.** `import/no-restricted-paths`는 해석에 실패한 import를
  조용히 통과시킨다. 스텁뿐인 0단계가 정확히 그 조건이다
- **`@typescript-eslint/no-unused-vars`에 `args: "none"`을 준다.**
  `core/` 전체가 unimplemented 스텁이라 미사용 인자가 필연인데 기본 설정은 `_` 접두사를
  인정하지 않아 전 파일이 빨개진다. TS의 `noUnusedParameters`는 인정하므로 불일치가 혼란을 키운다

한계: `globalThis.process.argv`와 `globalThis.window`는 잡히지 않는다(실측).
이 규칙들은 샌드박스가 아니라 가드레일이다.

상위 §2.6이 요구한 "`shared/`는 타입과 순수 상수만"은 `no-restricted-globals`가
**유일한 방어선**이다 — `tsconfig.web.json`이 `shared`를 DOM lib과 함께 포함하므로
타입 레벨에서는 `window`가 합법이다.

## 7. 빌드·실행 배선

**패키지** — `"type": "module"`, `name: "piecepool"`, `engines.node: ">=22.18"`, `.nvmrc` = `22.18`.
`.gitignore`에 `node_modules/` · `out/` · `*.tsbuildinfo`를 넣는다 — `out/`은 7단계
electron-vite의 기본 `outDir`이다. 지금 넣으면 공짜, 나중이면 실수로 커밋된 산출물을 지우는
커밋이 하나 생긴다.

**CLI 실행** — `node src/cli/ingest.ts` (플래그 없음).
Node 22.18은 타입 스트리핑이 unflag 상태라 `.ts`를 그대로 실행한다. `tsx`는 필요 없다.

대가는 규약 두 개다.

- **모든 상대 import에 `.ts` 확장자를 명시한다.** Node는 확장자를 추론하지 않고
  TS 관행인 `.js` → `.ts` 매핑도 하지 않는다. tsconfig에 `allowImportingTsExtensions: true`가 따라온다
- **`enum` · `namespace` · 파라미터 프로퍼티를 쓰지 않는다.**
  strip-only 모드에서 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`로 죽는다.
  **`no-restricted-syntax`로 강제한다** — 구현 중 실제로 이 셋에 걸렸다.
  문서에만 적어두면 지켜지지 않는다

이 제약은 규율로도 작용한다 — 7단계 electron-vite 번들링과 어긋날 문법을 미리 배제한다.
`tsx`는 devDependency로만 두어 `enum`이 필요해지면 갈아탈 여지를 남긴다.

**tsconfig 분할** — 이유는 Electron이 아니라 `lib`/`types` 격리다.
`core/`는 DOM 없이 `types: ["node"]`여야 `window`를 쓰면 컴파일 에러가 나고,
`renderer/`는 `types: []`여야 `process`가 새어들지 않는다. Electron 도입 전에 이미 필요하다.

| 파일                | include                                | lib / types         |
| ------------------- | -------------------------------------- | ------------------- |
| `tsconfig.json`     | `shared` `core` `cli` `main` `preload` | ES2023 / `["node"]` |
| `tsconfig.web.json` | `shared` `renderer`                    | ES2023+DOM / `[]`   |

별도 `tsconfig.base.json` 을 두지 않는다 — 에디터가 `tsconfig.json` 을 찾으므로
그 파일이 base 겸 node 타깃을 맡고 web 이 extends 한다. 파일 하나가 준다.

`shared`가 **양쪽에** 들어가는 것이 의도다 — 두 lib 세트 아래에서 모두 컴파일되는지가
"플랫폼 중립"의 진짜 정의이고, 덤으로 `renderer/`가 비어 있을 때의 TS18003을 막는다.

`typecheck` = `tsc -p tsconfig.json && tsc -p tsconfig.web.json`.
**project references(`tsc -b`)를 쓰지 않는다** — `noEmit`이라 build 모드가 기대하는 `.js`가
영영 생기지 않아 매번 "out of date"로 전량 재빌드한다. 캐싱 이득이 0이고
`.tsbuildinfo` 2개를 루트에 떨군다. 단순한 쪽이 동등하게 빠르다(실측 6.9초, 차이 없음).

**vitest** — `environment: "node"`, `include: ["src/**/*.test.ts"]`.
기본 include는 `.spec.ts`도 잡아 7단계 Playwright e2e를 집어삼킨다. 처음부터 `.test.ts`만 잡는다.

**의존성 버전** — `eslint-plugin-import@2.32.0`은 ESLint 10을 지원하지 않아
deprecated된 9.39.5로 끌어내려진다. **`eslint-plugin-import-x` + ESLint 10**으로 간다.
새 레포가 deprecated 버전으로 시작할 이유가 없다.

참고: 구 레포에는 ESLint가 아예 없다. 팀에 처음 도입되는 도구다.

## 8. 스텁 규약 — 두 등급

```ts
export async function readNote(v: Vault, path: NotePath): Promise<Note> {
  throw new Error("unimplemented: core/vault/notes.readNote");
}
```

메시지에 위치를 박아 실행하면 빈 곳이 어디인지 바로 보이게 한다.
스타일은 이식하는 `.prettierrc.json`을 따른다 — 세미콜론 O, 큰따옴표.

**동결(frozen)** — 변경하려면 상대 개발자와 합의한다.

`shared/types.ts` 전체 · §3의 경계면 5개 · `agent/tools.ts` 6종(상위 §7.2가 시그니처를
문자 그대로 제시) · `vault/paths.ts`(상위 §9) · `vault/notes.ts`(상위 §2.2·§6.3) ·
`vault/frontmatter.ts` · `index/links.ts`(상위 §6.1이 문법 4종을 완전히 규정) ·
`ingest/pdf.ts`(상위 §7.1) · `agent/tasks/*` 진입점(상위 §7.3)

**가배치(provisional)** — 파일과 폴더만 만들고 인자를 쓰지 않는다.
주석 `// OWNER: <A|B> — 시그니처 미확정, N단계에서 확정`을 단다.

`llm/{gemini,stream}.ts`(상위 문서에 호출 형태·스트리밍 계약·툴콜 프로토콜이 한 줄도 없다) ·
`agent/loop.ts`(루프 종료 조건·최대 반복·중단이 없다) · `index/watch.ts`(억제 등록/해제 API 미정) ·
`git/restore.ts`(§2 참조) · `ingest/store.ts`(명명 충돌·중복 인제스트 규칙 없음) ·
세션 로그 스키마 · lint 리포트 타입

## 9. 트리

상위 §2.2에서 0단계 항목만 발췌한 것이다. 1:1이 아니다 — 제외 목록은 §14에 있다.

```
piecepool-desktop/
├─ package.json
├─ tsconfig.json / tsconfig.web.json
├─ eslint.config.js
├─ vitest.config.ts
├─ .editorconfig  .prettierrc.json  .prettierignore  .nvmrc
├─ .gitattributes  .gitignore  LICENSE
├─ .github/workflows/ci.yml
│
├─ src/
│  ├─ shared/types.ts                 # 유일하게 내용이 다 찬 파일 (§4)
│  ├─ core/
│  │  ├─ errors.ts                    # PiecePoolError (§5)
│  │  ├─ assets.ts                    # assetPath() — 실동작 (§10)
│  │  ├─ vault/{paths,notes,frontmatter,open}.ts
│  │  ├─ index/{scan,links,watch}.ts
│  │  ├─ git/{repo,commit,restore}.ts
│  │  ├─ ingest/{pdf,markdown,store}.ts
│  │  ├─ agent/{loop,tools,written}.ts
│  │  ├─ agent/tasks/{ingest,inbox,lint,query,harvest}.ts
│  │  ├─ llm/{gemini,stream}.ts
│  │  └─ prompts/{load.ts, ingest.md, inbox.md, lint.md, query.md}
│  ├─ cli/{run,ingest,lint,inbox,query,reindex}.ts
│  ├─ main/{index,ipc,keys}.ts        # 7단계. electron 을 import 하지 않는다
│  ├─ preload/index.ts                # 7단계
│  └─ renderer/main.ts                # 8단계. 하위 구성은 그때 확정한다
│
└─ docs/
   ├─ superpowers/specs/2026-09-05-electron-rebuild-design.md   # 이식
   ├─ superpowers/specs/2026-09-06-repo-skeleton-design.md      # 이 문서
   ├─ adr/0001-electron-shell-llm-wiki.md
   └─ adr/legacy/                                               # 구 레포 ADR 7건 (§11)
```

테스트는 대상 옆에 둔다 — `links.ts` 옆 `links.test.ts`(상위 §2.2).

`main/` · `preload/` · `renderer/`도 `.gitkeep`이 아니라 스텁을 둔다.
`.gitkeep`은 git이 빈 폴더를 추적하지 못해 쓰는 우회책이지 구조를 표현하는 수단이 아니고,
빈 폴더로 두면 (a) `core/`는 스텁인데 여기만 다른 규칙이 되고,
(b) `tsconfig`의 `include`가 대상 없이 헛돌며,
(c) `core → main` lint zone을 **검증할 수 없다**. 실제로 스텁을 넣은 뒤에야 zone 8개가 발효했다 —
`core → main/preload/renderer` 3개와, `renderer`·`preload`가 target 인 5개다.

두 가지 선은 긋는다.

- **`electron`을 import하지 않는다.** 설치하지 않은 패키지를 import하면
  `import-x/no-unresolved`가 즉시 에러다. 스텁은 electron 없이 성립한다
- **`renderer/` 하위 폴더(`app/` `features/` `ds/` `store/`)를 만들지 않는다.**
  상위 §2.2가 구성을 "⑧에서 확정"이라 명시했다. 지금 만들면 §2의 거짓 안정성이다

엔트리 파일명은 `index.ts`로 예약한다 — electron-vite가 기본 엔트리로 찾는 이름이다.
electron-vite 기본 템플릿의 renderer는 `src/renderer/index.html` + `src/renderer/src/` 구조라
평평한 `src/renderer/`와 다르다. 7단계에 한 번 확인할 지점이다.

## 10. `assets.ts` — 0단계의 유일한 실동작 코드

상위 §2.4는 `core/prompts/*.md`와 pdf.js CMap이 "7단계에서 처음 깨진다"고 경고하며
원인을 asar로 지목한다. **진단이 정확하지 않다.** Electron은 `fs.readFile`을 패치해
asar 아카이브를 가상 디렉터리로 취급하므로 asar 자체는 원인이 아니다.

실제로 깨지는 지점은 둘이다.

1. **`"type": "module"`에서 `__dirname`이 존재하지 않는다**(실측: throws).
   `import.meta.dirname`(Node 20.11+)을 써야 한다
2. **번들러가 `.md`를 산출물에 복사하지 않는다.** import되지 않는 파일이라 JS 그래프에 없다.
   경로 계산이 틀린 게 아니라 파일이 존재하지 않아 깨진다

```ts
// src/core/assets.ts
import path from "node:path";
export function assetPath(rel: string): string {
  return path.join(import.meta.dirname, rel); // 0단계: 소스 트리 기준
}
```

7단계에 **이 한 파일만** 고친다. 프롬프트를 읽는 태스크 5개가 각자 경로를 계산하면
그때 5곳을 고쳐야 하고, 하나를 빠뜨리면 패키징 후에야 발견된다.

이 헬퍼가 투기적 코드가 아닌 이유는 0단계에 **실제 소비처가 있기 때문**이다.
`core/prompts/load.ts`가 자리표시자 `.md`를 실제로 읽고, `assets.test.ts`가 그 읽기를 검증한다.
이것이 §13의 "진짜 테스트 1개"를 겸하며, 상위 §10이 요구한 CMap 스모크 테스트의 원형이 된다.

**pdf.js CMap 대응은 하지 않는다.** `ingest/pdf.ts`가 아직 스텁이고,
해결책(`extraResources` · `asarUnpack`)이 0단계에 없는 `electron-builder.yml`에 달려 있다.
같은 `assetPath`를 경유하게만 해두면 4단계에 한 곳에서 처리된다.

## 11. 구 레포에서 이식하는 것

상위 §12.3의 표를 대조한 결과다.

| 대상                 | 구 레포 경로                                    | 비고                                             |
| -------------------- | ----------------------------------------------- | ------------------------------------------------ |
| 상위 설계문서        | `docs/superpowers/specs/2026-09-05-*.md`        | 그대로                                           |
| **ADR 원문 7건**     | `docs/adr/000{3,4,5,6,7,9}·0010`                | `docs/adr/legacy/`로. 상단에 `상태: 대체됨` 배너 |
| 에디터 설정          | `.editorconfig` · `.prettierrc.json` · `.nvmrc` | 그대로                                           |
| **`.gitattributes`** | `.gitattributes`                                | Rust/toml 행 제외. PIE-5 주석 유지               |
| 라이선스             | `LICENSE`                                       | 그대로                                           |

**ADR이 7건인 이유** — 상위 문서가 세 곳에서 서로 다른 ADR을 지목한다.
상위 §1.2는 `0004·0006·0009`, 상위 §12.3은 `0003·0005·0007·0010`("3건"이라 적고 4개를 나열),
상위 §12.4는 `0005·0010`. 합집합 7건을 취한다. 복사는 비용이 없고,
상위 §1.3의 계승 표가 `ADR-0010`의 실측 14개와 `ADR-0003`을 직접 참조하므로
원문이 없으면 4·7단계에서 근거를 잃는다.

**`.gitattributes`는 상위 §12.3 표에 없다.** 문서의 누락으로 본다.
구 레포의 이 파일에는 CRLF 때문에 실제로 터졌던 사고가 주석으로 기록돼 있다 —
"frontmatter split이 CRLF를 못 찾아 문서가 무소음 실종된 회귀". 개발자 2명이 모두 Windows이고
CI는 Linux다. 이식 대상인 `.editorconfig`와 `.prettierrc.json`은 **git 체크아웃 결과를
통제하지 못한다.** 상위 §1.3("재구축의 실패 모드는 이미 값을 치른 교훈을 다시 사는 것")에 해당한다.

**순수 파서(`src/lib/`)는 이식하지 않는다.** 상위 §11.3의 0단계 정의는 "12.3의 이식"을 포함하고
파서 행에는 단계 표시가 없으므로 형식상 0단계 대상이다. 의도적으로 좁힌다 —
§8의 "본체는 `throw unimplemented`"와 "동작하는 파서를 이식한다"는 서로 배타적이고,
상위 §6.1이 링크 문법을 옵시디언 규칙으로 다시 정의했으므로 기존 `wikilink.ts`를 그대로 쓸 수 없다.
상위 §1.2의 "내용은 승계하되 새로 쓰는 것"에 해당한다.
실제 소비처가 생기는 **2단계**(`index/links.ts`)와 상위 §6.3 rename으로 미룬다.

## 12. CI

상위 §12.2대로 최소로 시작한다. 워크플로 1개 —
`npm ci` → `prettier --check` → `lint` → `typecheck` → `test`.

`prettier --check`를 넣는 이유: 없으면 아무도 포맷 드리프트를 못 잡고,
처음 `npm run format`을 돌리는 사람이 무관한 대량 diff를 만든다. 2인 병렬의 첫 충돌 지점이다.
push와 PR 양쪽. Node는 `.nvmrc` 고정.

`ssot-check` · lychee link-check · `release-please`는 가져오지 않는다.
브랜치 보호 규칙은 강제하지 않고 관습으로 둔다(feature 브랜치 → PR) — 2인 팀에서
승인 강제는 자기 PR을 자기가 머지하는 절차만 늘린다.

## 13. 통과 조건

```
npm ci && npx prettier --check . && npm run lint && npm run typecheck && npm test        → 전부 초록
npm run ingest -- <볼트> x.pdf   → "unimplemented: core/vault/open.openVault" 로 죽는다
경계 위반 코드를 일부러 넣으면 → lint 가 잡는다
```

성공이 아니라 **`unimplemented`로 죽는 것**을 조건으로 삼는 이유:
성공을 조건으로 하면 0단계에 로직을 넣고 싶어진다. 실패 메시지를 조건으로 하면
"배선만 확인"이라는 범위가 저절로 지켜진다.

실측으로 확인된 함정 두 개를 여기서 넘는다.

- **`npm test`는 테스트가 0개면 종료 코드 1이다.** `passWithNoTests`로 덮지 않고
  **진짜 테스트 1개**(`assets.test.ts`, §10)를 넣는다. 플래그를 켜두면 나중에 `include` 패턴이
  깨지거나 테스트 위치가 바뀌었을 때 CI가 조용히 초록이 된다
- **`npm run typecheck`는 `renderer/`가 비면 TS18003으로 실패한다**(실측 EXIT=2).
  `tsconfig.web.json`의 `include`에 `src/shared`를 넣어 해결한다 — 회피책이 아니라
  §7이 설명한 원래 원하는 구성이다

## 14. 하지 않는 것

|                                                                      | 시점                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------ |
| `docs/contracts/` 4종                                                | 해당 단계에서. 상위 §2.5는 명명 규칙일 뿐 시점 규정이 아니다 |
| `prompts/*.md` 내용                                                  | 4~6단계. 0단계는 자리표시자만                                |
| `src/lib/` 순수 파서 이식                                            | 2단계 (§11)                                                  |
| `src/ds/` 시각 언어 이식                                             | 8단계 (상위 §12.3이 명시)                                    |
| Electron 의존성 설치                                                 | 7단계                                                        |
| `electron.vite.config.ts` · `electron-builder.yml` · `shared/ipc.ts` | 7단계                                                        |
| `e2e/`                                                               | 8단계                                                        |
| pdf.js CMap 배선                                                     | 4단계 (§10)                                                  |
| 테스트 픽스처 헬퍼 · asset manifest                                  | 소비처가 생길 때                                             |

## 15. 상위 설계문서로부터의 의도적 이탈

되짚을 수 있도록 한곳에 모은다.

| 이탈                | 상위 문서                    | 이 문서                               | 근거                                                       |
| ------------------- | ---------------------------- | ------------------------------------- | ---------------------------------------------------------- |
| 폴더 경계 강제 수단 | §2.3 `no-restricted-imports` | `import/no-restricted-paths` 추가     | 실측 — 동적·디렉터리 import 누락, 내부 폴더 오탐 (§6)      |
| `Progress` 형태     | §11.2 문자열                 | `{ step, detail? }` 객체              | 7단계 UI가 `step`으로 분기 (§4)                            |
| `ErrorKind`         | §9 5종                       | `"unknown"` 추가                      | 폴백 없으면 상위 §9의 `kind` 분기가 무너짐 (§4)            |
| 볼트 표현           | §5 암묵적 경로 문자열        | `Vault` 인터페이스                    | 상위 §2.2 `open.ts`·상위 §4.1 쓰기 루트가 상태를 요구 (§4) |
| 자산 함정의 원인    | §2.4 asar                    | ESM `__dirname` 부재 + 번들러 미복사  | asar은 `fs.readFile`이 패치돼 무해 (§10)                   |
| 0단계 이식 범위     | §11.3 "12.3의 이식"          | 순수 파서 제외, `.gitattributes` 추가 | §11                                                        |
| ADR 이식 건수       | §1.2·§12.3·§12.4 불일치      | 합집합 7건                            | §11                                                        |
| zone 방향           | §2.3 방향만 서술             | 11개 (양방향)                         | `target: core` 만으로는 `renderer → core` 가 안 막힌다     |
| 미사용 인자         | —                            | `args: "none"`                        | 0단계는 전부 스텁이라 미사용 인자가 필연                   |
| CI 게이트           | §12.2 lint·typecheck·test    | + `prettier --check`                  | 없으면 포맷 드리프트를 아무도 못 잡는다                    |
