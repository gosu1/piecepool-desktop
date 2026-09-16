# 그래프 뷰 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 리본의 그래프 버튼을 누르면 볼트 전체의 `[[링크]]` 관계가 하나의 그래프로 뜨고, 노드를 누르면 그 노트가 열린다.

**Architecture:** 링크 색인을 `main` 에서 만든다 — `core/index/` 의 스텁 다섯을 채워 볼트를 훑고, `graph:build` IPC 로 `GraphData` 하나를 renderer 에 건넨다. renderer 는 `d3-force` 로 좌표만 얻고 `<canvas>` 에 직접 그린다. 탭은 파일이 아닌 것을 처음 담으므로 `Tab` 이 판별 유니온이 된다.

**Tech Stack:** Electron 44 · React 19 · zustand · Tailwind v4 · vite · vitest (node) · **d3-force (신규)**

**설계문서:** `docs/superpowers/specs/2026-09-16-graph-view-design.md`

## Global Constraints

모든 태스크에 적용된다.

- **`.ts`/`.tsx` 확장자를 import 에 반드시 붙인다.** `node` 가 `.ts` 를 직접 실행하므로 확장자를 추론하지 않는다
- **`enum`·`namespace`·생성자 파라미터 프로퍼티 금지** (lint 가 잡는다)
- **`verbatimModuleSyntax: true`** — 타입만 쓰는 import 는 반드시 `import type` 이나 인라인 `type` 수식어를 붙인다
- **`src/shared/types.ts` 는 FROZEN.** 읽고 import 만 한다. **한 줄도 고치지 않는다** — `GraphData` 도 `Fm` 도 그대로다
- **FROZEN 파일을 이 계획이 건드리는 범위는 정확히 둘뿐이다:**
  - `src/shared/ipc.ts` — `CHANNEL.graphBuild` 하나 + `PiecePoolApi.buildGraph` 하나 **추가** (Task 3)
  - `src/core/index/links.ts` — `parseLinks` **스텁 본문만** 채운다. **시그니처와 JSDoc 은 그대로** (Task 1)
  - **기존 시그니처를 하나도 바꾸지 않는다.** 바꿔야 할 것 같으면 멈추고 묻는다
- **요청하지 않은 `unimplemented` 스텁을 채우지 않는다.** 이 계획이 채우는 것은 딱 다섯이다 — `normalizeTitle` · `parseLinks` · `resolveLink` · `scanVault` · `toGraph`. `saveIndex` · `loadIndex` · `backlinksOf` · `watchVault` · `readNote` · `frontmatter.parse` 는 **그대로 둔다**
- **`src/core/` 는 `electron` 을 import 할 수 없다** (lint 가 잡는다)
- **`src/renderer/` 는 `core/`·`main/`·`cli/` 를 import 할 수 없다** (lint 가 잡는다). `shared/` 는 가능하다
- **볼트 픽스처는 `mkdtemp` 로 임시 폴더에 만든다.** 이 레포에 커밋해서 검증하지 않는다 (CLAUDE.md §3)
- **DOM 테스트를 만들지 않는다.** `vitest.config.ts` 는 `environment: "node"` · `include: ["src/**/*.test.ts"]` 다. `.tsx` 는 테스트 대상이 아니다 — 화면은 사람이 본다
- **테스트는 66개 / 9파일에서 시작한다.** 태스크별 증가분이 각 태스크에 적혀 있다
- **매 커밋 전 `npx prettier --write .` 을 돌린다.** CI 가 `--check` 로 돈다
- **커밋 메시지**는 Conventional Commits, 타입은 영어 설명은 한국어. 끝에 한 줄을 **문자 그대로** 붙인다

  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```

- **브랜치는 `feat/electron-shell`.** `main` 에 직접 커밋하지 않는다
- **앱을 띄워 확인하는 절차**(Task 6 에만 있다):
  1. `tasklist | grep -ci electron.exe` 가 0인지 확인한다. **0이 아니면 죽이지 말고 멈춰서 보고하라** — 사용자가 앱을 열어 두고 있을 수 있다
  2. `npm start` 하나면 된다. dev 서버까지 함께 뜬다(`scripts/dev.mjs`)
  3. `tasklist | grep -ci electron.exe` 가 **4 근처**인지 확인한다
  4. 출력에서 `Unable to load preload script` 를 grep 한다. **나오면 실패다**
  5. 끝나면 0으로 되돌린다. `netstat -ano | grep ':5173 '` 로 LISTENING 잔여를 확인하고, 남았으면 그 PID 만 죽인다

## 파일 구조

| 파일                                                | 책임                                            | 태스크 |
| --------------------------------------------------- | ----------------------------------------------- | ------ |
| `src/core/index/links.ts`                           | `normalizeTitle` · `parseLinks` · `resolveLink` | 1, 2   |
| `src/core/index/links.test.ts` (신규)               | 정규화 규칙과 링크 문법을 못 박는다             | 1, 2   |
| `src/core/index/scan.ts`                            | `titleOf` · `scanVault` · `toGraph`             | 2      |
| `src/core/index/scan.test.ts` (신규)                | 볼트 픽스처 → 그래프                            | 2      |
| `src/shared/ipc.ts`                                 | `graph:build` 채널과 `buildGraph` 계약          | 3      |
| `src/preload/index.ts`                              | 화이트리스트에 `buildGraph` 추가                | 3      |
| `src/main/ipc.ts`                                   | `graph:build` 핸들러                            | 3      |
| `src/renderer/store/workspace.ts`                   | `Tab` 판별 유니온 · `openGraphTab` · `focusTab` | 4      |
| `src/renderer/store/workspace.test.ts`              | 탭 전이 (기존 수정 + 그래프 탭 추가)            | 4      |
| `src/renderer/app/TabStrip.tsx`                     | `t.path` → `t.id`                               | 4      |
| `src/renderer/app/NoteView.tsx`                     | `kind` 로 분기                                  | 4, 6   |
| `src/renderer/features/graph/layout.ts` (신규)      | d3-force 시뮬 구성 · 차수 · 인접                | 5      |
| `src/renderer/features/graph/layout.test.ts` (신규) | 차수·반지름·인접                                | 5      |
| `src/renderer/features/graph/hit.ts` (신규)         | 화면 좌표 ↔ 시뮬 좌표 · 히트 테스트             | 5      |
| `src/renderer/features/graph/hit.test.ts` (신규)    | 줌·팬이 걸린 상태의 히트 테스트                 | 5      |
| `src/renderer/features/graph/draw.ts` (신규)        | 캔버스에 그린다                                 | 5      |
| `docs/adr/0004-graph-canvas-d3force.md` (신규)      | Cytoscape 를 안 쓰는 근거                       | 5      |
| `src/renderer/features/graph/GraphView.tsx` (신규)  | 캔버스 마운트 · 이벤트 · 새로고침               | 6      |
| `src/renderer/app/Ribbon.tsx`                       | 그래프 버튼                                     | 6      |

**태스크 순서의 이유:** 링크 파싱(Task 1)이 이 조각에서 **가장 조용히 틀리는 부분**이고 뒤의 전부가 그 위에 선다. Task 1–2 는 `core` 순수 함수라 앱 없이 전부 검증된다. 화면(Task 6)을 마지막에 두면 그 앞까지는 `environment: "node"` 로 닫힌다.

## 이 계획이 하지 않는 것

설계 §11 그대로다.

- 로컬 그래프 · 백링크 패널 · 검색 필터 · 설정 패널 · 깊이 슬라이더 · 고아 노드 토글
- 파일 감시 자동 갱신 (`watchVault`) · 색인 디스크 캐시 (`saveIndex`/`loadIndex`)
- 태그 노드 · 첨부파일(PDF) 노드 · 깨진 링크 노드 · 동명 노트 해석
- `[[링크]]` 클릭 이동 · 그래프 탭 재시작 복원 · 노드 위치 저장

---

### Task 1: 링크를 읽어낸다 — `normalizeTitle` · `parseLinks`

이 조각에서 **가장 조용히 틀리는 부분**이다. 코드 펜스 안의 `[[예시]]` 를 링크로 세면 마크다운 문법을 설명하는 위키마다 유령 깨진 링크가 영구히 남는다.

**Files:**

- Modify: `src/core/index/links.ts` (`normalizeTitle`·`parseLinks` 스텁 → 구현. **시그니처와 기존 JSDoc 은 한 글자도 바꾸지 않는다**)
- Create: `src/core/index/links.test.ts`

**Interfaces:**

- Consumes: `LinkRef`·`NotePath` (`src/shared/types.ts`, FROZEN — 읽기만)
- Produces:
  - `normalizeTitle(t: string): string` — NFC → trim → 소문자 → 공백 제거
  - `parseLinks(from: NotePath, body: string): LinkRef[]` — `resolved` 는 항상 `null` 로 둔다. 채우는 것은 `scanVault` 의 몫이다 (Task 2)

**예상 테스트 증가:** +19 (66 → 85)

- [ ] **Step 1: 실패하는 테스트를 먼저 쓴다**

`src/core/index/links.test.ts` 를 만든다.

`````ts
import { describe, expect, it } from "vitest";
import { normalizeTitle, parseLinks } from "./links.ts";

describe("normalizeTitle", () => {
  it("공백을 지운다 — 구 레포 PIE-64 가 이것으로 막힌다", () => {
    expect(normalizeTitle("교착 상태")).toBe(normalizeTitle("교착상태"));
  });

  it("NFD 로 쓴 한글과 NFC 로 쓴 한글을 같은 키로 만든다", () => {
    const nfc = "트랜스포머";
    const nfd = nfc.normalize("NFD");
    expect(nfd).not.toBe(nfc);
    expect(normalizeTitle(nfd)).toBe(normalizeTitle(nfc));
  });

  it("대소문자를 가리지 않는다", () => {
    expect(normalizeTitle("Transformer")).toBe(normalizeTitle("transformer"));
  });

  it("앞뒤 공백과 탭을 지운다", () => {
    expect(normalizeTitle("  CNN\t")).toBe("cnn");
  });
});

describe("parseLinks", () => {
  it("맨 링크를 읽는다", () => {
    expect(parseLinks("a.md", "본문 [[CNN]] 끝")).toEqual([
      { from: "a.md", to: "CNN", embed: false, resolved: null },
    ]);
  });

  it("별칭을 가른다", () => {
    expect(parseLinks("a.md", "[[CNN|합성곱 신경망]]")).toEqual([
      { from: "a.md", to: "CNN", embed: false, alias: "합성곱 신경망", resolved: null },
    ]);
  });

  it("소제목 fragment 는 버린다", () => {
    expect(parseLinks("a.md", "[[CNN#구조]]")).toEqual([
      { from: "a.md", to: "CNN", embed: false, resolved: null },
    ]);
  });

  it("블록 id fragment 도 버린다", () => {
    expect(parseLinks("a.md", "[[CNN#^abc123]]")).toEqual([
      { from: "a.md", to: "CNN", embed: false, resolved: null },
    ]);
  });

  it("임베드를 embed 로 표시한다", () => {
    expect(parseLinks("a.md", "![[sources/files/x.pdf]]")).toEqual([
      { from: "a.md", to: "sources/files/x.pdf", embed: true, resolved: null },
    ]);
  });

  it("#page=N 은 page 로 분리한다 — 1-indexed 정수다", () => {
    expect(parseLinks("a.md", "![[sources/files/x.pdf#page=7]]")).toEqual([
      { from: "a.md", to: "sources/files/x.pdf", embed: true, page: 7, resolved: null },
    ]);
  });

  it("괄호가 든 제목을 통째로 담는다", () => {
    expect(parseLinks("a.md", "[[@DETR (2020)]]")[0].to).toBe("@DETR (2020)");
  });

  it("한 줄에 여러 개를 전부 읽는다", () => {
    expect(parseLinks("a.md", "[[가]] 그리고 [[나]]").map((r) => r.to)).toEqual(["가", "나"]);
  });

  it("닫히지 않은 [[ 는 링크가 아니다", () => {
    expect(parseLinks("a.md", "[[열기만 함")).toEqual([]);
  });

  it("빈 링크는 버린다", () => {
    expect(parseLinks("a.md", "[[]] [[   ]] [[|표시]]")).toEqual([]);
  });

  it("코드 펜스 안의 [[예시]] 는 링크가 아니다", () => {
    const body = ["설명", "```md", "[[예시]]", "```", "[[진짜]]"].join("\n");
    expect(parseLinks("a.md", body).map((r) => r.to)).toEqual(["진짜"]);
  });

  it("~~~ 펜스도 막는다", () => {
    const body = ["~~~", "[[예시]]", "~~~", "[[진짜]]"].join("\n");
    expect(parseLinks("a.md", body).map((r) => r.to)).toEqual(["진짜"]);
  });

  it("긴 펜스 안의 짧은 펜스는 블록을 닫지 못한다", () => {
    // 백틱 넷으로 연 블록 안의 백틱 셋은 예제일 뿐이다.
    // CommonMark 는 닫는 런이 여는 런 이상이기를 요구한다.
    const body = ["````", "```", "[[예시]]", "```", "````", "[[진짜]]"].join("\n");
    expect(parseLinks("a.md", body).map((r) => r.to)).toEqual(["진짜"]);
  });

  it("인라인 코드 안의 [[예시]] 는 링크가 아니다", () => {
    expect(
      parseLinks("a.md", "`[[예시]]` 는 문법이고 [[진짜]] 는 링크다").map((r) => r.to),
    ).toEqual(["진짜"]);
  });

  it("닫히지 않은 펜스는 파일 끝까지 삼킨다", () => {
    const body = ["```", "[[예시]]", "[[또예시]]"].join("\n");
    expect(parseLinks("a.md", body)).toEqual([]);
  });
});
`````

- [ ] **Step 2: 실패를 확인한다**

```bash
npx vitest run src/core/index/links.test.ts
```

Expected: FAIL — `unimplemented: core/index/links.normalizeTitle` 과 `unimplemented: core/index/links.parseLinks`

- [ ] **Step 3: 구현한다**

`src/core/index/links.ts` 에서 **두 함수의 본체만** 바꾼다. `// FROZEN:` 머리글·`LinkTargets`·JSDoc·`resolveLink`·`backlinksOf` 는 손대지 않는다.

`normalizeTitle` 의 본체:

```ts
export function normalizeTitle(t: string): string {
  // NFC 를 먼저 태운다 — macOS 는 파일명을 NFD 로 저장하므로 안 하면
  // 같은 한글 제목이 플랫폼마다 다른 키가 된다.
  return t.normalize("NFC").trim().toLowerCase().replace(/\s+/g, "");
}
```

헬퍼를 두고(같은 파일, export 하지 않는다) `parseLinks` 본체를 채운다.

**헬퍼는 `parseLinks` 의 JSDoc 블록 *위*에 둔다** — `normalizeTitle` 과 그 JSDoc 사이다.
JSDoc 바로 아래에 두면 주석 블록이 둘 겹쳐서, 글자를 한 자도 안 바꿨는데도 IDE 와 typedoc 이
그 설명을 헬퍼의 것으로 읽는다. FROZEN 주석이 자기 함수에서 떨어지는 것은 `git diff` 가 못 잡는다.

```ts
/**
 * 코드 펜스와 인라인 코드를 **같은 길이의 공백**으로 지운다.
 * 길이를 유지하는 이유: 나중에 링크 위치(offset)가 필요해질 때 통째로 밀리지 않는다.
 */
function blankCode(body: string): string {
  const lines = body.split("\n");
  let fenceChar: string | null = null;
  let fenceLen = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^\s*(`{3,}|~{3,})/.exec(line);

    if (fenceChar === null) {
      if (m !== null) {
        fenceChar = m[1][0];
        fenceLen = m[1].length;
        lines[i] = " ".repeat(line.length);
        continue;
      }
      // 백틱 런의 길이가 같은 쌍만 인라인 코드다.
      lines[i] = line.replace(/(`+)[^\n]*?\1/g, (s) => " ".repeat(s.length));
      continue;
    }

    // 펜스 안이다. 닫으려면 같은 문자에 길이가 여는 쪽 이상이어야 한다 —
    // 백틱 넷으로 연 블록 안의 백틱 셋짜리 예제는 그 블록을 닫지 못한다(CommonMark).
    if (m !== null && m[1][0] === fenceChar && m[1].length >= fenceLen) fenceChar = null;
    lines[i] = " ".repeat(line.length);
  }

  return lines.join("\n");
}

/** `!` 여부 + `[[…]]` 안쪽. 대괄호와 줄바꿈은 안쪽에 들어올 수 없다. */
const LINK = /(!?)\[\[([^\]\n]+)\]\]/g;

export function parseLinks(from: NotePath, body: string): LinkRef[] {
  const refs: LinkRef[] = [];

  for (const m of blankCode(body).matchAll(LINK)) {
    const embed = m[1] === "!";

    // 별칭을 먼저 가른다 — 표시 텍스트에 # 가 있어도 fragment 로 오해하지 않는다.
    const bar = m[2].indexOf("|");
    const aliasRaw = bar === -1 ? "" : m[2].slice(bar + 1).trim();
    let to = (bar === -1 ? m[2] : m[2].slice(0, bar)).trim();

    let page: number | undefined;
    const hash = to.indexOf("#");
    if (hash !== -1) {
      const pm = /^page=(\d+)$/.exec(to.slice(hash + 1));
      if (pm !== null) page = Number(pm[1]);
      to = to.slice(0, hash).trim();
    }

    if (to === "") continue;

    refs.push({
      from,
      to,
      embed,
      ...(aliasRaw === "" ? {} : { alias: aliasRaw }),
      ...(page === undefined ? {} : { page }),
      resolved: null,
    });
  }

  return refs;
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npx vitest run src/core/index/links.test.ts
```

Expected: PASS — 19 tests

- [ ] **Step 5: 전체 검증**

```bash
npx prettier --write . && npm run lint && npm run typecheck && npm test
```

Expected: 전부 통과. `Tests 85 passed (85)`

- [ ] **Step 6: 커밋**

```bash
git add src/core/index/links.ts src/core/index/links.test.ts
git commit -F - <<'MSG'
feat: [[링크]] 를 읽고 제목을 정규화한다

코드 펜스와 인라인 코드 안의 [[예시]] 는 링크가 아니다 — raw 문자열을
받으므로 직접 걸러야 한다. 지울 때 같은 길이의 공백으로 치환해 오프셋을 지킨다.
normalizeTitle 은 공백을 지운다 — 구 레포 PIE-64("교착상태" vs "교착 상태").

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: 볼트를 훑어 그래프를 만든다 — `resolveLink` · `scanVault` · `toGraph`

**Files:**

- Modify: `src/core/index/links.ts` (`resolveLink` 스텁 → 구현)
- Modify: `src/core/index/scan.ts` (`scanVault`·`toGraph` 스텁 → 구현, `titleOf` 추가)
- Modify: `src/core/index/links.test.ts` (`resolveLink` 묶음 추가)
- Create: `src/core/index/scan.test.ts`

**Interfaces:**

- Consumes:
  - `normalizeTitle`·`parseLinks` (Task 1)
  - `readTree(v: Vault): Promise<TreeNode[]>` (`src/core/vault/tree.ts` — 이미 동작한다)
  - `readRaw(v: Vault, p: NotePath): Promise<string>` (`src/core/vault/notes.ts` — 이미 동작한다)
  - `LinkTargets` (`src/core/index/links.ts` — `{ titles: Map<string, NotePath>; files: Set<NotePath> }`)
  - `VaultIndex` (`src/core/index/scan.ts` — `{ targets: LinkTargets; links: LinkRef[] }`)
- Produces:
  - `resolveLink(from: NotePath, to: string, t: LinkTargets): NotePath | null`
  - `titleOf(p: NotePath): string` — basename 에서 `.md` 를 뗀 것 (설계 §4.5)
  - `scanVault(v: Vault): Promise<VaultIndex>`
  - `toGraph(ix: VaultIndex): GraphData`

**예상 테스트 증가:** +23 (85 → 108)

- [ ] **Step 1: `resolveLink` 테스트를 먼저 쓴다**

`src/core/index/links.test.ts` 의 맨 끝에 붙인다. 파일 맨 위 import 도 함께 고친다.

```ts
// 파일 맨 위 import 를 이렇게 바꾼다
import { normalizeTitle, parseLinks, resolveLink } from "./links.ts";
import type { LinkTargets } from "./links.ts";
```

```ts
describe("resolveLink", () => {
  const targets: LinkTargets = {
    titles: new Map([
      [normalizeTitle("CNN"), "wiki/CNN.md"],
      [normalizeTitle("교착 상태"), "wiki/교착상태.md"],
    ]),
    files: new Set(["wiki/CNN.md", "wiki/교착상태.md", "sources/files/x.pdf"]),
  };

  it("제목으로 해석한다", () => {
    expect(resolveLink("a.md", "CNN", targets)).toBe("wiki/CNN.md");
  });

  it("공백이 달라도 같은 노트로 해석한다", () => {
    expect(resolveLink("a.md", "교착상태", targets)).toBe("wiki/교착상태.md");
  });

  it("경로로도 해석한다", () => {
    expect(resolveLink("a.md", "sources/files/x.pdf", targets)).toBe("sources/files/x.pdf");
  });

  it("없는 대상은 null 이다 — 깨진 링크다", () => {
    expect(resolveLink("a.md", "없는것", targets)).toBeNull();
  });
});
```

- [ ] **Step 2: `scanVault`·`toGraph` 테스트를 쓴다**

`src/core/index/scan.test.ts` 를 만든다.

```ts
import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isUnreadable, scanVault, titleOf, toGraph } from "./scan.ts";
import type { Vault } from "../../shared/types.ts";

/** 픽스처 볼트. files 는 `상대경로 → 내용` 이다. */
async function fixture(files: Record<string, string>): Promise<Vault> {
  const root = await mkdtemp(join(tmpdir(), "pp-scan-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body, "utf8");
  }
  return { root, agentWriteRoots: ["wiki"] };
}

describe("titleOf", () => {
  it("폴더를 떼고 .md 를 뗀다", () => {
    expect(titleOf("wiki/개념/트랜스포머.md")).toBe("트랜스포머");
  });

  it("확장자 대소문자를 가리지 않는다", () => {
    expect(titleOf("README.MD")).toBe("README");
  });
});

describe("scanVault", () => {
  it("모든 .md 를 targets 에 담는다", async () => {
    const v = await fixture({ "wiki/CNN.md": "", "inbox/메모.md": "" });
    const ix = await scanVault(v);
    expect([...ix.targets.files].sort()).toEqual(["inbox/메모.md", "wiki/CNN.md"]);
  });

  it("숨김 폴더의 .md 는 담지 않는다", async () => {
    const v = await fixture({ "wiki/CNN.md": "", ".piecepool/sessions/s.md": "" });
    const ix = await scanVault(v);
    expect([...ix.targets.files]).toEqual(["wiki/CNN.md"]);
  });

  it("링크를 해석해 resolved 를 채운다", async () => {
    const v = await fixture({ "wiki/A.md": "[[B]] 와 [[없는것]]", "wiki/B.md": "" });
    const ix = await scanVault(v);
    expect(ix.links.map((l) => [l.to, l.resolved])).toEqual([
      ["B", "wiki/B.md"],
      ["없는것", null],
    ]);
  });

  it("동명 노트는 먼저 들어온 것이 이긴다", async () => {
    const v = await fixture({ "wiki/A.md": "", "inbox/A.md": "", "wiki/z.md": "[[A]]" });
    const ix = await scanVault(v);
    // readTree 는 폴더를 이름순으로 내므로 inbox/ 가 wiki/ 보다 먼저다.
    expect(ix.links[0].resolved).toBe("inbox/A.md");
  });
});

describe("toGraph", () => {
  it("노드 수가 볼트의 .md 수와 같다 — 링크가 없어도 남는다", async () => {
    const v = await fixture({ "wiki/A.md": "", "wiki/B.md": "", "wiki/고아.md": "" });
    const g = toGraph(await scanVault(v));
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["wiki/A.md", "wiki/B.md", "wiki/고아.md"]);
    expect(g.edges).toEqual([]);
  });

  it("노드 title 은 파일명에서 .md 를 뗀 것이다", async () => {
    const v = await fixture({ "wiki/개념/트랜스포머.md": "" });
    const g = toGraph(await scanVault(v));
    expect(g.nodes[0]).toEqual({ id: "wiki/개념/트랜스포머.md", title: "트랜스포머" });
  });

  it("깨진 링크는 엣지가 되지 않는다", async () => {
    const v = await fixture({ "wiki/A.md": "[[없는것]]" });
    expect(toGraph(await scanVault(v)).edges).toEqual([]);
  });

  it("자기 자신 링크는 엣지가 되지 않는다", async () => {
    const v = await fixture({ "wiki/A.md": "[[A]]" });
    expect(toGraph(await scanVault(v)).edges).toEqual([]);
  });

  it("A→B 와 B→A 를 엣지 하나로 접는다", async () => {
    const v = await fixture({ "wiki/A.md": "[[B]]", "wiki/B.md": "[[A]]" });
    expect(toGraph(await scanVault(v)).edges).toEqual([
      { source: "wiki/A.md", target: "wiki/B.md" },
    ]);
  });

  it("같은 대상을 여러 번 링크해도 엣지 하나다", async () => {
    const v = await fixture({ "wiki/A.md": "[[B]] 그리고 또 [[B]]", "wiki/B.md": "" });
    expect(toGraph(await scanVault(v)).edges).toHaveLength(1);
  });

  it("임베드도 엣지가 된다 — 관계에 타입이 없다", async () => {
    const v = await fixture({ "wiki/A.md": "![[B]]", "wiki/B.md": "" });
    expect(toGraph(await scanVault(v)).edges).toEqual([
      { source: "wiki/A.md", target: "wiki/B.md" },
    ]);
  });
});

describe("isUnreadable", () => {
  it("사라진 파일은 건너뛴다", () => {
    expect(isUnreadable({ code: "ENOENT" })).toBe(true);
  });

  it("권한이 막힌 파일은 건너뛴다", () => {
    expect(isUnreadable({ code: "EACCES" })).toBe(true);
  });

  it("code 가 없는 평범한 에러는 버그 신호다", () => {
    expect(isUnreadable(new Error("boom"))).toBe(false);
  });

  it("모르는 code 는 버그 신호다", () => {
    expect(isUnreadable({ code: "EUNEXPECTED" })).toBe(false);
  });

  it("null 에서 터지지 않는다", () => {
    expect(isUnreadable(null)).toBe(false);
  });

  it("객체가 아니면 false 다", () => {
    expect(isUnreadable("ENOENT")).toBe(false);
  });
});
```

`scanVault` 가 예외를 **올려보내는** 쪽은 통합 테스트로 덮지 않는다. 임시 폴더 픽스처만으로
`readRaw` 에서 건너뛰지 않을 예외를 플랫폼 가리지 않고 확정적으로 일으킬 방법이 없고,
그러자고 목을 들이면 이 레포의 테스트 방식(실제 볼트 픽스처)이 무너진다.
판단 로직 자체는 위 여섯 케이스가 못 박는다.

- [ ] **Step 3: 실패를 확인한다**

```bash
npx vitest run src/core/index/
```

Expected: FAIL — `unimplemented: core/index/links.resolveLink` · `unimplemented: core/index/scan.scanVault` · `titleOf is not a function`

- [ ] **Step 4: `resolveLink` 를 구현한다**

`src/core/index/links.ts` 의 `resolveLink` **본체만** 바꾼다. JSDoc 은 그대로 두고 아래 한 문단을 그 끝에 덧붙인다.

```ts
/**
 * (기존 JSDoc 그대로 — 지우지 않는다)
 *
 * 지금은 `from` 을 쓰지 않는다. 동명 노트는 맵에 먼저 들어온 것이 이기고,
 * 모호성 보고는 lint 규칙의 몫이다 (2026-09-16 그래프 뷰 설계 §4.3).
 */
export function resolveLink(from: NotePath, to: string, t: LinkTargets): NotePath | null {
  return t.titles.get(normalizeTitle(to)) ?? (t.files.has(to) ? to : null);
}
```

- [ ] **Step 5: `scan.ts` 를 구현한다**

`src/core/index/scan.ts` 를 통째로 이렇게 만든다. `VaultIndex` 와 주석은 그대로다.

```ts
import type { GraphData, LinkRef, NotePath, Vault } from "../../shared/types.ts";
import type { TreeNode } from "../../shared/ipc.ts";
import type { LinkTargets } from "./links.ts";
import { normalizeTitle, parseLinks, resolveLink } from "./links.ts";
import { readTree } from "../vault/tree.ts";
import { readRaw } from "../vault/notes.ts";

/** 파생 캐시다. 지우면 재빌드한다 — 복구 절차가 따로 없다. */
export interface VaultIndex {
  targets: LinkTargets;
  links: LinkRef[];
}

/**
 * 파일명이 곧 제목이다 (옵시디언 규칙).
 *
 * VaultIndex 는 정규화된 제목만 들고 있어 원문을 복구할 수 없다.
 * 그래프 노드의 title 을 위해 필드를 더하는 대신 경로에서 되만든다.
 */
export function titleOf(p: NotePath): string {
  return (p.split("/").pop() ?? p).replace(/\.md$/i, "");
}

/** 트리에서 파일 경로만 평탄화해 뽑는다. */
function flatten(nodes: TreeNode[]): NotePath[] {
  const out: NotePath[] = [];
  for (const n of nodes) {
    if (n.kind === "file") out.push(n.path);
    else if (n.children !== undefined) out.push(...flatten(n.children));
  }
  return out;
}

/**
 * 읽다가 사라졌거나 못 읽는 파일인가.
 *
 * 경로는 방금 readTree 가 나열한 것이다. 그 사이에 지워지거나(ENOENT)
 * 권한이 막는(EACCES·EPERM) 일은 실제로 있고, 그 한 장 때문에 그래프 전체가
 * 안 뜨는 쪽이 더 나쁘다. **그 밖의 예외는 우리 버그다** — 삼키면 노트가
 * 아무 신호 없이 그래프에서 사라져 원인까지 거슬러 올라갈 단서가 남지 않는다.
 */
export function isUnreadable(e: unknown): boolean {
  if (typeof e !== "object" || e === null || !("code" in e)) return false;
  const code = (e as { code: unknown }).code;
  return (
    code === "ENOENT" ||
    code === "EACCES" ||
    code === "EPERM" ||
    code === "EISDIR" ||
    code === "ENOTDIR"
  );
}

/**
 * 볼트를 훑어 링크 색인을 만든다.
 *
 * 순회는 readTree 를 그대로 쓴다 — .md 만·숨김 폴더 제외·심볼릭 링크 제외·POSIX 경로가
 * 이미 거기 있다. 같은 규칙을 다시 짜면 두 벌이 조용히 갈라진다.
 */
export async function scanVault(v: Vault): Promise<VaultIndex> {
  const paths = flatten(await readTree(v));

  const titles = new Map<string, NotePath>();
  for (const p of paths) {
    const key = normalizeTitle(titleOf(p));
    // 먼저 들어온 것이 이긴다. 동명 보고는 lint 의 몫이다.
    if (!titles.has(key)) titles.set(key, p);
  }
  const targets: LinkTargets = { titles, files: new Set(paths) };

  const links: LinkRef[] = [];
  for (const p of paths) {
    let body: string;
    try {
      body = await readRaw(v, p);
    } catch (e) {
      // 못 읽는 한 장은 건너뛴다. 그 밖의 예외는 버그 신호라 그대로 올려보낸다.
      if (!isUnreadable(e)) throw e;
      continue;
    }
    for (const ref of parseLinks(p, body)) {
      links.push({ ...ref, resolved: resolveLink(p, ref.to, targets) });
    }
  }

  return { targets, links };
}

export async function saveIndex(v: Vault, ix: VaultIndex): Promise<void> {
  throw new Error("unimplemented: core/index/scan.saveIndex");
}

export async function loadIndex(v: Vault): Promise<VaultIndex | null> {
  throw new Error("unimplemented: core/index/scan.loadIndex");
}

/**
 * 그래프는 링크에서 파생된다. 저장하지 않는다.
 *
 * 방향이 없으므로 A→B 와 B→A 는 같은 엣지다 — 두 선이 겹쳐 굵어 보이면 거짓 신호다.
 */
export function toGraph(ix: VaultIndex): GraphData {
  const nodes = [...ix.targets.files].map((p) => ({ id: p, title: titleOf(p) }));

  const seen = new Set<string>();
  const edges: GraphData["edges"] = [];
  for (const l of ix.links) {
    if (l.resolved === null || l.resolved === l.from) continue;
    // NUL(\0) 로 잇는다 — 경로에 들어갈 수 없는 문자라 두 경로가 섞이지 않는다.
    const [a, b] = l.from < l.resolved ? [l.from, l.resolved] : [l.resolved, l.from];
    const key = `${a}\0${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: l.from, target: l.resolved });
  }

  return { nodes, edges };
}
```

- [ ] **Step 6: 통과를 확인한다**

```bash
npx vitest run src/core/index/
```

Expected: PASS — 42 tests (links 23 + scan 19)

- [ ] **Step 7: 전체 검증**

```bash
npx prettier --write . && npm run lint && npm run typecheck && npm test
```

Expected: `Tests 108 passed (108)`

- [ ] **Step 8: 커밋**

```bash
git add src/core/index/
git commit -F - <<'MSG'
feat: 볼트를 훑어 링크 그래프를 만든다

순회는 readTree 를 재사용한다 — .md 만·숨김 폴더 제외 규칙을 두 벌로 만들지 않는다.
노드 title 은 파일명에서 뽑는다. VaultIndex 에는 정규화된 제목만 있어 원문이 없다.
방향이 없으므로 A→B 와 B→A 는 엣지 하나로 접는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 3: `graph:build` 로 건넨다

배선이라 단위 테스트가 없다. **통과 조건은 `typecheck` + `lint` 이고, 실동작은 Task 6 의 앱 확인이 잡는다.**

**Files:**

- Modify: `src/shared/ipc.ts` (**FROZEN — 아래 두 곳에 추가만 한다**)
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc.ts`

**Interfaces:**

- Consumes: `scanVault`·`toGraph` (Task 2), `GraphData` (`src/shared/types.ts`), `PiecePoolError` (`src/core/errors.ts`), `wrap` (`src/main/ipc.ts` 에 이미 있다)
- Produces: `window.piecepool.buildGraph(): Promise<Result<GraphData>>` — renderer 가 Task 6 에서 부른다

**예상 테스트 증가:** +0 (108 유지)

- [ ] **Step 1: `shared/ipc.ts` 에 채널과 계약을 더한다**

**추가만 한다. 기존 줄을 고치지 않는다.**

맨 위 import 에 `GraphData` 를 더한다:

```ts
import type { GraphData, NotePath, Result } from "./types.ts";
```

`CHANNEL` 에 한 줄:

```ts
export const CHANNEL = {
  vaultPick: "vault:pick",
  vaultLast: "vault:last",
  noteRead: "note:read",
  graphBuild: "graph:build",
  windowMinimize: "window:minimize",
  windowToggleMaximize: "window:toggleMaximize",
  windowClose: "window:close",
} as const;
```

`PiecePoolApi` 의 `readRaw` 아래에 한 항목:

```ts
/**
 * 링크 색인에서 파생한 그래프. **인자가 없다** — 열린 볼트 전체가 대상이다.
 * 경로를 받지 않으므로 resolveInVault 가 지키는 표면이 늘지 않는다.
 */
buildGraph: () => Promise<Result<GraphData>>;
```

- [ ] **Step 2: preload 화이트리스트에 더한다**

`src/preload/index.ts` 의 `api` 객체에 `readRaw` 다음 줄로:

```ts
    buildGraph: () => ipcRenderer.invoke(CHANNEL.graphBuild),
```

같은 파일의 주석 **두 줄**을 사실에 맞춘다. 숫자가 둘 다 들어 있다 — 하나만 고치면 다른 하나가 거짓으로 남는다.

```ts
 * 지금 열어 주는 것은 여덟이다.
 *
 * `readRaw` 만 renderer 에서 경로를 받는다 — 나머지 일곱은 인자가 없다.
```

- [ ] **Step 3: main 핸들러를 단다**

`src/main/ipc.ts` 의 import 에 한 줄 더한다:

```ts
import { scanVault, toGraph } from "../core/index/scan.ts";
```

`registerHandlers` 의 JSDoc 을 사실에 맞춘다:

```ts
/** vault 둘, 그래프 하나, 창 조작 셋을 등록한다. 창 조작은 돌려줄 값이 없어 단방향이다. */
```

`noteRead` 핸들러 **다음**에 붙인다:

```ts
ipcMain.handle(CHANNEL.graphBuild, () =>
  wrap(async () => {
    // 인자가 없다 — 검증할 경로가 없고, 대상은 지금 열린 볼트 전체다.
    if (opened === null) {
      throw new PiecePoolError("vault_not_found", "볼트가 열려 있지 않다");
    }
    return toGraph(await scanVault(opened));
  }),
);
```

- [ ] **Step 4: 검증**

```bash
npx prettier --write . && npm run lint && npm run typecheck && npm test
```

Expected: 전부 통과. `Tests 108 passed (108)`

- [ ] **Step 5: FROZEN 변경 범위를 눈으로 확인한다**

```bash
git diff src/shared/ipc.ts
```

Expected: **추가된 줄만 보인다.** 기존 줄이 하나라도 `-` 로 나오면 멈추고 보고한다.

- [ ] **Step 6: 커밋**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/ipc.ts
git commit -F - <<'MSG'
feat: graph:build 로 그래프를 renderer 에 건넨다

renderer 가 경로를 보내지 않는 채널이다 — 인자가 없어 resolveInVault 가
지키는 표면이 늘지 않는다. 볼트가 안 열려 있으면 note:read 와 같은 에러로 떨어진다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 4: 탭이 파일 아닌 것도 담는다

`Tab` 을 판별 유니온으로 바꾼다. 이 태스크가 끝나도 **그래프 탭을 열 방법은 아직 없다** — 리본 버튼은 Task 6 이다. 여기서 확인하는 것은 **기존 탭 동작이 하나도 안 깨졌다**는 것이다.

**Files:**

- Modify: `src/renderer/store/workspace.ts`
- Modify: `src/renderer/store/workspace.test.ts`
- Modify: `src/renderer/app/TabStrip.tsx`
- Modify: `src/renderer/app/NoteView.tsx`

**Interfaces:**

- Consumes: `NotePath` (`src/shared/types.ts`)
- Produces:
  - `GRAPH_TAB_ID: "graph"` · `noteTabId(p: NotePath): string`
  - `Tab = NoteTab | GraphTab` — `NoteTab` 은 `{ kind: "note"; id: string; path: NotePath; title: string; body: string | null; error: string | null; seq: number }`, `GraphTab` 은 `{ kind: "graph"; id: "graph"; title: "그래프" }`
  - 스토어: `activeTab: string | null` · `openTab(path, title): Promise<void>` (**시그니처 유지**) · `openGraphTab(): void` · `focusTab(id: string): void` · `closeTab(id: string): void`

**예상 테스트 증가:** +5 (108 → 113). 기존 탭 테스트는 `path` → `id` 로 **고쳐 쓴다**

- [ ] **Step 1: 실패하는 테스트를 먼저 쓴다**

`src/renderer/store/workspace.test.ts` 의 import 에 더한다:

```ts
import {
  applied,
  clampWidth,
  GRAPH_TAB_ID,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  noteTabId,
  stripFrontmatter,
  useWorkspace,
} from "./workspace.ts";
```

`describe("탭")` 안의 다섯 곳을 바꾼다. **바꾸는 줄은 이것이 전부다.**

| 지금                                                   | 바꾼 뒤                                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `expect(s.activeTab).toBe("wiki/a.md");`               | `expect(s.activeTab).toBe(noteTabId("wiki/a.md"));`                                          |
| `closeTab("wiki/b.md");`                               | `closeTab(noteTabId("wiki/b.md"));`                                                          |
| `closeTab("wiki/a.md");` (세 곳)                       | `closeTab(noteTabId("wiki/a.md"));`                                                          |
| `expect(s.tabs.map((t) => t.path)).toEqual([...])`     | `expect(s.tabs.map((t) => t.id)).toEqual([noteTabId("wiki/a.md"), noteTabId("wiki/c.md")]);` |
| `expect(...activeTab).toBe("wiki/c.md" / "wiki/b.md")` | `...toBe(noteTabId("wiki/c.md"))` / `...toBe(noteTabId("wiki/b.md"))`                        |

마지막 테스트("닫았다가 다시 연 탭에…")의 끝 세 줄은 유니온을 좁혀야 한다 — `body` 는 `NoteTab` 에만 있다:

```ts
const tabs = useWorkspace.getState().tabs;
expect(tabs).toHaveLength(1);
const [tab] = tabs;
expect(tab.kind === "note" ? tab.body : null).toBe("새 본문");
```

파일 끝에 새 묶음을 붙인다:

```ts
describe("그래프 탭", () => {
  it("연 적 없으면 새로 만들고 활성으로 둔다", () => {
    useWorkspace.getState().openGraphTab();
    const s = useWorkspace.getState();
    expect(s.tabs).toEqual([{ kind: "graph", id: GRAPH_TAB_ID, title: "그래프" }]);
    expect(s.activeTab).toBe(GRAPH_TAB_ID);
  });

  it("두 번 눌러도 탭이 둘이 되지 않는다", () => {
    const { openGraphTab } = useWorkspace.getState();
    openGraphTab();
    openGraphTab();
    expect(useWorkspace.getState().tabs).toHaveLength(1);
  });

  it("노트 탭과 키 공간이 겹치지 않는다", () => {
    useWorkspace.setState({
      tabs: [
        {
          kind: "note",
          id: noteTabId("graph"),
          path: "graph",
          title: "graph",
          body: "",
          error: null,
          seq: 1,
        },
      ],
      activeTab: noteTabId("graph"),
    });
    useWorkspace.getState().openGraphTab();
    expect(useWorkspace.getState().tabs).toHaveLength(2);
  });

  it("focusTab 은 그래프 탭에서 selected 를 건드리지 않는다", () => {
    useWorkspace.setState({
      tabs: [
        {
          kind: "note",
          id: noteTabId("a.md"),
          path: "a.md",
          title: "a",
          body: "",
          error: null,
          seq: 1,
        },
        { kind: "graph", id: GRAPH_TAB_ID, title: "그래프" },
      ],
      activeTab: noteTabId("a.md"),
      selected: "a.md",
    });
    useWorkspace.getState().focusTab(GRAPH_TAB_ID);
    const s = useWorkspace.getState();
    expect(s.activeTab).toBe(GRAPH_TAB_ID);
    expect(s.selected).toBe("a.md");
  });

  it("볼트를 바꾸면 그래프 탭도 함께 닫힌다", () => {
    useWorkspace.getState().openGraphTab();
    const next = applied({
      ok: true,
      value: { root: "/새볼트", name: "새볼트", tree: [] },
    });
    expect(next.tabs).toEqual([]);
    expect(next.activeTab).toBeNull();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx vitest run src/renderer/store/workspace.test.ts
```

Expected: FAIL — `openGraphTab is not a function` 등

- [ ] **Step 3: 스토어를 고친다**

`src/renderer/store/workspace.ts` 에서 `Tab` 선언부터 `closeTab` 까지를 바꾼다. `stripFrontmatter`·`clampWidth`·`call`·`pickVault`·`loadLastVault` 는 그대로다.

`Tab` 선언 자리:

```ts
/** 그래프 탭은 하나뿐이라 id 가 곧 상수다. */
export const GRAPH_TAB_ID = "graph";

/**
 * 탭 신원. NotePath 와 키 공간을 물리적으로 가른다 —
 * NotePath 는 string 별칭이라 `path | "graph"` 로는 타입이 충돌을 못 잡는다.
 */
export function noteTabId(p: NotePath): string {
  return `note:${p}`;
}

/** 열린 노트 탭 하나. 읽는 중에는 body·error 가 둘 다 null 이다. */
export interface NoteTab {
  kind: "note";
  id: string;
  path: NotePath;
  title: string;
  body: string | null;
  error: string | null;
  /** 이 탭을 연 요청의 세대. 응답이 자기 세대의 탭에만 담기게 한다. */
  seq: number;
}

/** 그래프 탭. 파일이 아니라 경로가 없다. */
export interface GraphTab {
  kind: "graph";
  id: "graph";
  title: "그래프";
}

export type Tab = NoteTab | GraphTab;
```

`WorkspaceState` 의 탭 관련 네 줄:

```ts
  tabs: Tab[];
  /** 활성 탭의 id. NotePath 가 아니다 — 파일이 아닌 탭이 있다. */
  activeTab: string | null;
  openTab: (path: NotePath, title: string) => Promise<void>;
  openGraphTab: () => void;
  focusTab: (id: string) => void;
  closeTab: (id: string) => void;
```

`openTab`·`closeTab` 을 바꾸고 둘을 더한다:

```ts
  openTab: async (path, title) => {
    const id = noteTabId(path);

    // 이미 열려 있으면 다시 읽지 않는다. 파일 감시가 없어 다시 읽어도
    // 최신이라는 보장이 없고, 보던 글이 갑자기 바뀌는 쪽이 더 나쁘다.
    if (get().tabs.some((t) => t.id === id)) {
      set({ activeTab: id, selected: path });
      return;
    }

    const seq = ++tabSeq;
    set((s) => ({
      tabs: [...s.tabs, { kind: "note", id, path, title, body: null, error: null, seq }],
      activeTab: id,
      selected: path,
    }));

    let body: string | null = null;
    let error: string | null = null;
    try {
      const r = await window.piecepool.readRaw(path);
      if (r.ok) body = stripFrontmatter(r.value);
      else error = r.error.message;
    } catch (e) {
      // preload 가 없으면 여기로 온다. 탭은 열린 채 이유를 보여 준다.
      error = `앱 내부 연결이 끊겼다: ${String(e)}`;
    }

    // 세대까지 같아야 담는다. 그 사이에 닫혔거나 다시 열렸으면 이 응답은 낡은 것이다.
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.kind === "note" && t.id === id && t.seq === seq ? { ...t, body, error } : t,
      ),
    }));
  },

  openGraphTab: () =>
    set((s) => ({
      tabs: s.tabs.some((t) => t.id === GRAPH_TAB_ID)
        ? s.tabs
        : [...s.tabs, { kind: "graph", id: GRAPH_TAB_ID, title: "그래프" }],
      activeTab: GRAPH_TAB_ID,
    })),

  focusTab: (id) =>
    set((s) => {
      const t = s.tabs.find((x) => x.id === id);
      if (t === undefined) return {};
      // 그래프 탭에는 경로가 없다 — 트리 선택을 건드리지 않는다.
      return t.kind === "note" ? { activeTab: id, selected: t.path } : { activeTab: id };
    }),

  closeTab: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return {};
      const tabs = s.tabs.filter((t) => t.id !== id);
      // 닫은 탭이 활성이었을 때만 옮긴다. 오른쪽 이웃, 없으면 왼쪽.
      const activeTab =
        s.activeTab === id ? (tabs[idx]?.id ?? tabs[idx - 1]?.id ?? null) : s.activeTab;
      return { tabs, activeTab };
    }),
```

초기 상태와 `applied()` 는 **그대로 둔다** — `tabs: []` · `activeTab: null` 이 유니온에도 그대로 맞다.

- [ ] **Step 4: `TabStrip.tsx` 를 고친다**

`openTab` 을 `focusTab` 으로 바꾼다 — 이미 열린 탭을 다시 누르는 자리라 경로가 필요 없다.

```tsx
const focusTab = useWorkspace((s) => s.focusTab);
```

`map` 안의 네 자리:

```tsx
        const active = t.id === activeTab;
        return (
          <div
            key={t.id}
            ...
          >
            <button
              type="button"
              onClick={() => focusTab(t.id)}
              ...
            >
              {t.title}
            </button>
            <button
              type="button"
              onClick={() => closeTab(t.id)}
              ...
```

`const openTab = useWorkspace((s) => s.openTab);` 줄은 **지운다** (`noUnusedLocals` 가 잡는다).

- [ ] **Step 5: `NoteView.tsx` 를 좁힌다**

```tsx
const tab = tabs.find((t) => t.id === activeTab) ?? null;

if (tab === null) {
  return (
    <div className="grid flex-1 place-items-center text-sm text-ink-muted">열린 파일 없음</div>
  );
}

// 그래프 탭은 아직 열 방법이 없다. Task 6 에서 <GraphView/> 가 이 자리에 들어온다.
if (tab.kind !== "note") return null;
```

나머지(`tab.error`·`tab.body`·`<pre>`)는 그대로다.

- [ ] **Step 6: 통과를 확인한다**

```bash
npx vitest run src/renderer/store/workspace.test.ts
```

Expected: PASS — 기존 탭 테스트 + 새 그래프 탭 5개

- [ ] **Step 7: 전체 검증**

```bash
npx prettier --write . && npm run lint && npm run typecheck && npm test
```

Expected: `Tests 113 passed (113)`

- [ ] **Step 8: 커밋**

```bash
git add src/renderer/store/workspace.ts src/renderer/store/workspace.test.ts src/renderer/app/TabStrip.tsx src/renderer/app/NoteView.tsx
git commit -F - <<'MSG'
refactor: 탭이 파일 아닌 것도 담는다

Tab 을 판별 유니온으로 바꾸고 신원을 path 에서 id 로 옮긴다.
NotePath 는 string 별칭이라 `path | "graph"` 로는 타입이 충돌을 못 잡는다 —
접두사로 두 키 공간을 물리적으로 가른다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 5: 그리기 전의 순수 부품 — 배치 · 히트 · 그리기

`d3-force` 가 여기서 들어온다. **DOM 을 만지지 않는 세 파일**이라 `environment: "node"` 에서 그대로 테스트한다.

**Files:**

- Create: `src/renderer/features/graph/layout.ts`
- Create: `src/renderer/features/graph/layout.test.ts`
- Create: `src/renderer/features/graph/hit.ts`
- Create: `src/renderer/features/graph/hit.test.ts`
- Create: `src/renderer/features/graph/draw.ts`
- Create: `docs/adr/0004-graph-canvas-d3force.md`
- Modify: `package.json` (`d3-force` · `@types/d3-force`)
- Modify: `CLAUDE.md` (§9 표의 "그래프 렌더링" 줄)

**Interfaces:**

- Consumes: `GraphData`·`NotePath` (`src/shared/types.ts`)
- Produces:
  - `layout.ts` — `SimNode` · `SimEdge` · `Layout` · `degrees(g)` · `radiusOf(degree)` · `adjacency(g)` · `buildLayout(g, w, h)`
  - `hit.ts` — `View` · `toWorld(v, sx, sy)` · `hitNode(nodes, v, sx, sy)`
  - `draw.ts` — `Palette` · `Scene` · `LABEL_ZOOM` · `draw(ctx, w, h, s)`

**예상 테스트 증가:** +15 (113 → 128)

- [ ] **Step 1: 의존성을 설치한다**

```bash
npm i d3-force && npm i -D @types/d3-force
```

Expected: `package.json` 의 `dependencies` 에 `d3-force`, `devDependencies` 에 `@types/d3-force`

- [ ] **Step 2: ADR 을 쓴다**

`docs/adr/0004-graph-canvas-d3force.md` 를 만든다.

```markdown
# ADR-0004: 그래프 렌더링 — Canvas 2D + d3-force

- 상태: 채택 (Accepted)
- 일자: 2026-09-16
- 대체: `docs/adr/legacy/0006-graph-rendering-cytoscape.md` (상태: 대체됨)
- 관련: `docs/superpowers/specs/2026-09-16-graph-view-design.md`

## 배경

legacy ADR-0006 은 Cytoscape.js 를 채택했다. 그 근거는 원문 그대로 **"타입 있는 지식 그래프
(12 RelationType, strength/confidence)"** 와 **"노드 클릭·타입별 색상·strength 두께·
Subject/RelationType 필터"** 였다. D3 를 기각한 이유도 _"저수준이라 직접 구현 부담"_ 이었다.

재구축에서 지식 모델이 **타입 없는 `[[]]` 링크**로 바뀌었다(README 비교표 · ADR-0001).
`RelationType` 도 `strength` 도 `confidence` 도 없다. 그 근거가 통째로 사라졌다.

## 결정

**노드 배치는 `d3-force`, 그리기는 Canvas 2D 직접.** `cytoscape` 는 넣지 않는다.

## 근거

- 남은 요구는 "원과 선을 그리고 줌·팬·드래그" 뿐이다. Cytoscape 의 셀렉터·스타일시트 엔진이
  값을 하는 자리가 없다
- 구 레포도 실제로는 **좌표를 d3-force 가 만들고 Cytoscape 는 그리기만** 했다
  (`src/lib/CytoscapeGraph.tsx`). 절반은 이미 d3 였다
- `d3-force` 를 남기는 이유는 **Barnes-Hut quadtree** 하나다. 반발력을 직접 짜면 O(n²) 이고,
  quadtree 를 직접 지으면 `d3-force` 를 다시 쓰는 것만 못하다
- 색을 `--ds-*` 토큰에서 읽으므로 Cytoscape 스타일시트와 Tailwind 토큰을 잇는 층이 사라진다

## 결과

- (+) 의존성이 넷에서 둘로 준다 (`cytoscape`·`@types/cytoscape` 제거)
- (+) 두 모델(cy 요소 ↔ 시뮬 노드) 사이 좌표 동기화가 사라진다
- (+) 그리기 규칙이 `draw.ts` 순수 함수 하나에 모인다
- (−) 노드 라벨 충돌 회피·엣지 라우팅 같은 것을 나중에 원하면 직접 짜야 한다
- (−) 수천 노드에서의 렌더 성능은 실측하지 않았다. 실측 볼트는 15~62장이다

## 대안

- **Cytoscape 유지**: 근거가 사라진 결정을 관성으로 지고 간다. 400KB 와 두 모델 동기화가 값이다
- **라이브러리 0개**: 반발력이 O(n²) 이라 수백 노드부터 버벅인다
```

- [ ] **Step 3: CLAUDE.md §9 표를 고친다**

"그래프 렌더링" 줄 하나만 바꾼다.

```markdown
| 그래프 렌더링 | Canvas 2D + d3-force. Cytoscape 는 안 쓴다 | [ADR-0004](docs/adr/0004-graph-canvas-d3force.md) |
```

- [ ] **Step 4: `layout.test.ts` 를 먼저 쓴다**

`src/renderer/features/graph/layout.test.ts` 를 만든다.

```ts
import { describe, expect, it } from "vitest";
import { adjacency, buildLayout, degrees, radiusOf } from "./layout.ts";
import type { GraphData } from "../../../shared/types.ts";

/** A—B, A—C. A 가 허브다. D 는 고아다. */
const g: GraphData = {
  nodes: [
    { id: "A.md", title: "A" },
    { id: "B.md", title: "B" },
    { id: "C.md", title: "C" },
    { id: "D.md", title: "D" },
  ],
  edges: [
    { source: "A.md", target: "B.md" },
    { source: "A.md", target: "C.md" },
  ],
};

describe("degrees", () => {
  it("양쪽 끝을 모두 센다", () => {
    const d = degrees(g);
    expect(d.get("A.md")).toBe(2);
    expect(d.get("B.md")).toBe(1);
  });

  it("고아 노드는 0 이다 — 빠지지 않는다", () => {
    expect(degrees(g).get("D.md")).toBe(0);
  });
});

describe("radiusOf", () => {
  it("고아도 보이는 크기를 갖는다", () => {
    expect(radiusOf(0)).toBe(4);
  });

  it("연결이 많을수록 커진다", () => {
    expect(radiusOf(4)).toBeGreaterThan(radiusOf(1));
  });
});

describe("adjacency", () => {
  it("양방향으로 담는다 — 방향이 없다", () => {
    const a = adjacency(g);
    expect([...(a.get("A.md") ?? [])].sort()).toEqual(["B.md", "C.md"]);
    expect([...(a.get("B.md") ?? [])]).toEqual(["A.md"]);
  });

  it("고아 노드도 빈 집합으로 들어 있다", () => {
    expect(adjacency(g).get("D.md")).toEqual(new Set());
  });
});

describe("buildLayout", () => {
  it("노드마다 degree 를 실어 준다", () => {
    const { sim, nodes } = buildLayout(g, 800, 600);
    // 시뮬은 만들자마자 타이머를 돌린다. 테스트 프로세스를 붙잡지 않도록 곧바로 세운다.
    sim.stop();
    expect(nodes.map((n) => [n.id, n.degree])).toEqual([
      ["A.md", 2],
      ["B.md", 1],
      ["C.md", 1],
      ["D.md", 0],
    ]);
  });

  it("엣지 수를 그대로 옮긴다", () => {
    const { sim, edges } = buildLayout(g, 800, 600);
    sim.stop();
    expect(edges).toHaveLength(2);
  });
});
```

- [ ] **Step 5: `hit.test.ts` 를 쓴다**

`src/renderer/features/graph/hit.test.ts` 를 만든다.

```ts
import { describe, expect, it } from "vitest";
import { hitNode, toWorld } from "./hit.ts";
import type { View } from "./hit.ts";
import type { SimNode } from "./layout.ts";

const nodes: SimNode[] = [
  { id: "A.md", title: "A", degree: 0, x: 100, y: 100 },
  { id: "B.md", title: "B", degree: 0, x: 300, y: 100 },
];

const IDENTITY: View = { zoom: 1, panX: 0, panY: 0 };

describe("toWorld", () => {
  it("변환이 없으면 화면 좌표가 곧 시뮬 좌표다", () => {
    expect(toWorld(IDENTITY, 50, 70)).toEqual({ x: 50, y: 70 });
  });

  it("팬을 되돌린다", () => {
    expect(toWorld({ zoom: 1, panX: 20, panY: 10 }, 50, 70)).toEqual({ x: 30, y: 60 });
  });

  it("줌을 되돌린다", () => {
    expect(toWorld({ zoom: 2, panX: 0, panY: 0 }, 50, 70)).toEqual({ x: 25, y: 35 });
  });
});

describe("hitNode", () => {
  it("노드 위를 짚는다", () => {
    expect(hitNode(nodes, IDENTITY, 100, 100)?.id).toBe("A.md");
  });

  it("빈 곳은 null 이다", () => {
    expect(hitNode(nodes, IDENTITY, 200, 300)).toBeNull();
  });

  it("줌과 팬이 걸린 상태에서도 맞는 노드를 짚는다", () => {
    // 시뮬 (300,100) 은 zoom 2 · pan(50,20) 에서 화면 (650,220) 이다.
    const v: View = { zoom: 2, panX: 50, panY: 20 };
    expect(hitNode(nodes, v, 650, 220)?.id).toBe("B.md");
  });

  it("좌표가 아직 없는 노드는 건너뛴다", () => {
    const pending: SimNode[] = [{ id: "X.md", title: "X", degree: 0 }];
    expect(hitNode(pending, IDENTITY, 0, 0)).toBeNull();
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

```bash
npx vitest run src/renderer/features/graph/
```

Expected: FAIL — `Cannot find module './layout.ts'`

- [ ] **Step 7: `layout.ts` 를 만든다**

```ts
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import type { GraphData, NotePath } from "../../../shared/types.ts";

/**
 * 시뮬이 좌표를 실어 주는 노드.
 *
 * x·y 가 optional 인 것은 tick 을 기다려야 해서가 아니다 — forceSimulation 이
 * 팩토리 안에서 동기적으로 초기 좌표를 넣으므로 buildLayout 이 반환하는 순간 이미 있다.
 * buildLayout 을 거치지 않고 손으로 만든 노드 때문에 열어 둔다.
 */
export interface SimNode extends SimulationNodeDatum {
  id: NotePath;
  title: string;
  /** 연결 수. 반지름을 정한다. */
  degree: number;
}

/**
 * forceLink 가 문자열을 노드 객체로 **제자리에서 바꿔 넣는다** — 둘 다 받는 타입이어야 한다.
 * d3 의 SimulationLinkDatum 을 명시적으로 확장한다. 모양만 맞춰 두면
 * forceSimulation<SimNode, SimEdge> 의 제약에서 걸린다.
 */
export interface SimEdge extends SimulationLinkDatum<SimNode> {
  source: NotePath | SimNode;
  target: NotePath | SimNode;
}

export interface Layout {
  sim: Simulation<SimNode, SimEdge>;
  nodes: SimNode[];
  edges: SimEdge[];
}

/** 연결 수. 반지름이 이것을 쓴다. 고아 노드도 0 으로 들어 있다. */
export function degrees(g: GraphData): Map<NotePath, number> {
  const d = new Map<NotePath, number>();
  for (const n of g.nodes) d.set(n.id, 0);
  for (const e of g.edges) {
    d.set(e.source, (d.get(e.source) ?? 0) + 1);
    d.set(e.target, (d.get(e.target) ?? 0) + 1);
  }
  return d;
}

/** 고아도 보여야 하므로 바닥이 4 다. */
export function radiusOf(degree: number): number {
  return 4 + Math.sqrt(degree);
}

/** hover 강조가 쓰는 이웃 목록. 방향이 없으므로 양쪽에 담는다. */
export function adjacency(g: GraphData): Map<NotePath, Set<NotePath>> {
  const a = new Map<NotePath, Set<NotePath>>();
  for (const n of g.nodes) a.set(n.id, new Set<NotePath>());
  for (const e of g.edges) {
    a.get(e.source)?.add(e.target);
    a.get(e.target)?.add(e.source);
  }
  return a;
}

/**
 * 힘 넷으로 배치한다. alpha 로 스스로 식어 멈추므로 정지 상태 CPU 는 0 이다.
 * 호출한 쪽이 반드시 sim.stop() 으로 끝낸다 — 안 세우면 타이머가 남는다.
 */
export function buildLayout(g: GraphData, w: number, h: number): Layout {
  const deg = degrees(g);
  const nodes: SimNode[] = g.nodes.map((n) => ({
    id: n.id,
    title: n.title,
    degree: deg.get(n.id) ?? 0,
  }));
  const edges: SimEdge[] = g.edges.map((e) => ({ source: e.source, target: e.target }));

  const sim = forceSimulation<SimNode, SimEdge>(nodes)
    .force(
      "link",
      forceLink<SimNode, SimEdge>(edges)
        .id((n) => n.id)
        .distance(60),
    )
    .force("charge", forceManyBody<SimNode>().strength(-120))
    .force("center", forceCenter(w / 2, h / 2))
    // 반지름 + 여백만큼 떨어뜨린다. 허브가 이웃을 덮지 않는다.
    .force(
      "collide",
      forceCollide<SimNode>((n) => radiusOf(n.degree) + 4),
    );

  return { sim, nodes, edges };
}
```

- [ ] **Step 8: `hit.ts` 를 만든다**

```ts
import type { SimNode } from "./layout.ts";
import { radiusOf } from "./layout.ts";

/** 캔버스 변환. 그리기와 히트 테스트가 반드시 같은 값을 본다. */
export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

/** 화면 좌표 → 시뮬 좌표. draw 가 거는 translate·scale 의 역이다. */
export function toWorld(v: View, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - v.panX) / v.zoom, y: (sy - v.panY) / v.zoom };
}

/**
 * 화면 좌표 아래의 노드. 없으면 null.
 * 겹치면 나중에 그려진 것이 위에 있으므로 배열 뒤에서부터 본다.
 */
export function hitNode(nodes: SimNode[], v: View, sx: number, sy: number): SimNode | null {
  const { x, y } = toWorld(v, sx, sy);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    // buildLayout 이 낸 노드는 항상 좌표가 있다. 손으로 만든 노드만 여기 걸린다.
    if (n.x === undefined || n.y === undefined) continue;
    // 작은 노드를 누르기 쉽도록 여유를 준다. 월드 단위라 화면에서는 2*zoom px 다 —
    // 반지름도 같이 확대되므로 손끝 감각은 줌과 무관하게 일정하다.
    const r = radiusOf(n.degree) + 2;
    if ((n.x - x) ** 2 + (n.y - y) ** 2 <= r * r) return n;
  }
  return null;
}
```

- [ ] **Step 9: `draw.ts` 를 만든다**

테스트하지 않는다 — 픽셀은 사람이 본다(§12.2). 순수 함수로 두는 이유는 `GraphView` 가 상태만 넘기고 그리기 규칙은 여기 한 곳에 모으기 위해서다.

```ts
import type { NotePath } from "../../../shared/types.ts";
import type { SimEdge, SimNode } from "./layout.ts";
import { radiusOf } from "./layout.ts";
import type { View } from "./hit.ts";

/** 색 묶음. GraphView 가 --ds-* 토큰을 읽어 넘긴다 — 여기서 색을 하드코딩하지 않는다. */
export interface Palette {
  node: string;
  active: string;
  edge: string;
  label: string;
}

/** 라벨이 드러나는 줌 문턱. 평소에는 구조만 보인다. */
export const LABEL_ZOOM = 1.1;

/** 강조 밖의 것에 남기는 불투명도. */
const DIM_NODE = 0.2;
const DIM_EDGE = 0.12;

export interface Scene {
  nodes: SimNode[];
  edges: SimEdge[];
  view: View;
  palette: Palette;
  /** 활성 노트. 트리·탭에서 고른 것이다. */
  active: NotePath | null;
  /** 지금 가리킨 노드와 그 이웃. hover 가 없으면 비어 있다. */
  lit: Set<NotePath>;
}

export function draw(ctx: CanvasRenderingContext2D, w: number, h: number, s: Scene): void {
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(s.view.panX, s.view.panY);
  ctx.scale(s.view.zoom, s.view.zoom);

  const dim = s.lit.size > 0;

  // 엣지 먼저 — 노드가 그 위에 얹힌다.
  // 선 굵기를 줌으로 나눈다. 안 하면 확대할수록 선이 굵어져 그래프가 뭉갠다.
  ctx.lineWidth = 1 / s.view.zoom;
  ctx.strokeStyle = s.palette.edge;
  for (const e of s.edges) {
    const a = e.source as SimNode;
    const b = e.target as SimNode;
    if (a.x === undefined || a.y === undefined || b.x === undefined || b.y === undefined) continue;
    ctx.globalAlpha = !dim || (s.lit.has(a.id) && s.lit.has(b.id)) ? 1 : DIM_EDGE;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  const zoomed = s.view.zoom >= LABEL_ZOOM;
  ctx.font = `${11 / s.view.zoom}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  for (const n of s.nodes) {
    if (n.x === undefined || n.y === undefined) continue;
    const on = !dim || s.lit.has(n.id);
    ctx.globalAlpha = on ? 1 : DIM_NODE;

    const r = radiusOf(n.degree);
    ctx.fillStyle = n.id === s.active ? s.palette.active : s.palette.node;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fill();

    // 확대했거나, 지금 가리킨 무리에 들었을 때만 이름이 나온다.
    if (zoomed || (dim && s.lit.has(n.id))) {
      ctx.fillStyle = s.palette.label;
      ctx.fillText(n.title, n.x, n.y + r + 2 / s.view.zoom);
    }
  }

  ctx.restore();
  ctx.globalAlpha = 1;
}
```

- [ ] **Step 10: 통과를 확인한다**

```bash
npx vitest run src/renderer/features/graph/
```

Expected: PASS — 15 tests

- [ ] **Step 11: 전체 검증**

```bash
npx prettier --write . && npm run lint && npm run typecheck && npm test
```

Expected: `Tests 128 passed (128)`

- [ ] **Step 12: 커밋**

```bash
git add package.json package-lock.json src/renderer/features/graph/ docs/adr/0004-graph-canvas-d3force.md CLAUDE.md
git commit -F - <<'MSG'
feat: 그래프 배치·히트·그리기를 순수 함수로 짓는다

d3-force 는 Barnes-Hut quadtree 때문에 쓴다. 그리기는 Canvas 2D 직접이다 —
Cytoscape 를 고른 근거(타입 엣지·필터)가 관계 타입과 함께 사라졌다. ADR-0004.
DOM 을 안 만지는 세 파일이라 environment: node 에서 그대로 테스트한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 6: 화면에 붙인다 — `GraphView` · 리본 버튼

여기서 처음으로 사람이 눈으로 본다.

**Files:**

- Create: `src/renderer/features/graph/GraphView.tsx`
- Modify: `src/renderer/app/NoteView.tsx` (자리표시 → `<GraphView/>`)
- Modify: `src/renderer/app/Ribbon.tsx` (`RibbonButton` 추출 + 그래프 버튼)

**Interfaces:**

- Consumes: `bridge` (`src/renderer/bridge.ts`), `useWorkspace`·`GRAPH_TAB_ID`·`RIBBON_WIDTH` (`src/renderer/store/workspace.ts`), Task 5 의 세 모듈
- Produces: `GraphView` — `{ hidden: boolean }` 하나를 받는 컴포넌트

**예상 테스트 증가:** +0 (128 유지). `.tsx` 는 테스트 대상이 아니다

- [ ] **Step 1: `GraphView.tsx` 를 만든다**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { bridge } from "../../bridge.ts";
import { useWorkspace } from "../../store/workspace.ts";
import { buildLayout } from "./layout.ts";
import type { Layout, SimNode } from "./layout.ts";
import { draw } from "./draw.ts";
import type { Palette } from "./draw.ts";
import { hitNode, toWorld } from "./hit.ts";
import type { View } from "./hit.ts";
import type { GraphData, NotePath } from "../../../shared/types.ts";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
/** 이만큼 안 움직이면 드래그가 아니라 클릭이다. */
const CLICK_SLOP = 3;

/** hover 가 없을 때 넘기는 빈 집합. 프레임마다 새로 만들지 않는다. */
const NOTHING_LIT = new Set<NotePath>();

/** --ds-* 토큰을 읽는다. 색을 하드코딩하면 테마가 바뀔 때 따라오지 않는다. */
function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  return {
    node: cs.getPropertyValue("--ds-ink-2").trim(),
    active: cs.getPropertyValue("--ds-primary").trim(),
    edge: cs.getPropertyValue("--ds-hairline").trim(),
    label: cs.getPropertyValue("--ds-ink-muted").trim(),
  };
}

/**
 * 볼트 전체의 [[링크]] 그래프.
 *
 * 좌표·변환·hover 는 전부 ref 에 둔다 — 상태로 두면 프레임마다 리렌더가 돈다.
 * 화면에 글자로 나가는 것(상태 문구)만 useState 다.
 *
 * hidden 인 동안에도 마운트는 유지된다(NoteView.tsx) — 탭을 오가도 배치와 pan/zoom 을
 * 잃지 않기 위해서다. 실제로 안 그리는 것은 rAF 루프 안의 가드 하나로 충분하다.
 */
export function GraphView({ hidden }: { hidden: boolean }) {
  const openTab = useWorkspace((s) => s.openTab);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const layoutRef = useRef<Layout | null>(null);
  const paletteRef = useRef<Palette | null>(null);
  const viewRef = useRef<View>({ zoom: 1, panX: 0, panY: 0 });
  const hoverRef = useRef<NotePath | null>(null);
  const dragRef = useRef<{ node: SimNode | null; x: number; y: number; moved: boolean } | null>(
    null,
  );
  /** load() 호출 세대. openTab 의 seq 와 같은 역할 — 낡은 응답이 새 레이아웃을 못 짓게 막는다. */
  const genRef = useRef(0);
  /** rAF 루프가 매 프레임 읽는 최신 hidden 값. prop 을 직접 읽으면 루프를 다시 걸어야 한다. */
  const hiddenRef = useRef(hidden);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setStatus("loading");
    layoutRef.current?.sim.stop();
    layoutRef.current = null;

    // 이 호출의 세대를 찜해 둔다. await 도중 언마운트되거나 StrictMode 가 다시 돌면
    // genRef 가 앞서 나가고, 그러면 이 호출은 아래에서 자신이 낡았음을 안다.
    const gen = ++genRef.current;

    let g: GraphData;
    try {
      const r = await bridge?.buildGraph();
      if (gen !== genRef.current) return;
      if (r === undefined) {
        setStatus("error");
        setMessage("앱 내부 연결이 끊겼다");
        return;
      }
      if (!r.ok) {
        setStatus("error");
        setMessage(r.error.message);
        return;
      }
      g = r.value;
    } catch (e) {
      if (gen !== genRef.current) return;
      setStatus("error");
      setMessage(`앱 내부 연결이 끊겼다: ${String(e)}`);
      return;
    }

    const host = hostRef.current;
    layoutRef.current = buildLayout(g, host?.clientWidth ?? 800, host?.clientHeight ?? 600);
    if (host !== null) paletteRef.current = readPalette(host);
    viewRef.current = { zoom: 1, panX: 0, panY: 0 };
    hoverRef.current = null;
    setMessage(`${g.nodes.length}개 노트 · ${g.edges.length}개 연결`);
    setStatus("ready");
  }, []);

  useEffect(() => {
    void load();
    // 이 컴포넌트는 그래프 탭이 있는 한 hidden 으로만 바뀌고 마운트는 유지된다
    // (NoteView.tsx) — 여기서 세우는 것은 탭을 "닫아" 진짜 언마운트될 때뿐이다.
    // 탭을 잠깐 떠나는 동안에도 시뮬은 계속 돌아 배치를 지킨다(hidden 이면 rAF 가 안 그릴 뿐이다).
    // sim.stop() 은 this 를 돌려주므로 () => sim.stop() 은 Destructor 타입(void 만 허용)에 안 맞는다 — 블록으로 버린다.
    return () => {
      // 세대를 먼저 올려 진행 중인 load() 를 무효화한다 — 그래야 언마운트 후
      // 늦게 도착한 응답이 아무도 세우지 않을 시뮬레이션을 새로 짓지 않는다.
      genRef.current++;
      layoutRef.current?.sim.stop();
    };
  }, [load]);

  // 매 프레임 읽는 hiddenRef 를 최신 prop 값으로 맞춘다 — 루프 자체는 다시 걸지 않는다.
  useEffect(() => {
    hiddenRef.current = hidden;
  }, [hidden]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      // display:none 인 host 는 clientWidth/Height 가 0 이다 — 그 값으로 백버퍼를 키우면
      // 캔버스가 0×0 이 되어 다음에 보일 때 그림이 사라진다. 읽기 전에 막는다.
      if (hiddenRef.current) return;
      const cv = canvasRef.current;
      const host = hostRef.current;
      const lay = layoutRef.current;
      const palette = paletteRef.current;
      if (cv === null || host === null || lay === null || palette === null) return;

      // 백버퍼를 DPR 로 키운다. 안 하면 고DPI 에서 흐려진다.
      const dpr = window.devicePixelRatio || 1;
      const w = host.clientWidth;
      const h = host.clientHeight;
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (cv.width !== bw || cv.height !== bh) {
        cv.width = bw;
        cv.height = bh;
      }

      const ctx = cv.getContext("2d");
      if (ctx === null) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const hover = hoverRef.current;
      draw(ctx, w, h, {
        nodes: lay.nodes,
        edges: lay.edges,
        view: viewRef.current,
        palette,
        // 프레임마다 스토어에서 직접 읽는다. 구독하면 트리 선택이 바뀔 때마다
        // 리렌더가 도는데, 그릴 사람은 이 루프라 얻는 것이 없다.
        active: useWorkspace.getState().selected,
        lit:
          hover === null ? NOTHING_LIT : new Set<NotePath>([hover, ...(lay.adj.get(hover) ?? [])]),
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  /** 캔버스 좌상단 기준 좌표. clientX 를 그대로 쓰면 사이드바 너비만큼 밀린다. */
  const local = (e: { clientX: number; clientY: number }, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  const onWheel = (e: ReactWheelEvent<HTMLCanvasElement>) => {
    const v = viewRef.current;
    const { sx, sy } = local(e, e.currentTarget);
    const before = toWorld(v, sx, sy);
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * Math.exp(-e.deltaY / 400)));
    // 커서 아래의 점이 제자리에 있도록 pan 을 되민다.
    viewRef.current = { zoom, panX: sx - before.x * zoom, panY: sy - before.y * zoom };
  };

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const lay = layoutRef.current;
    if (lay === null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { sx, sy } = local(e, e.currentTarget);
    const node = hitNode(lay.nodes, viewRef.current, sx, sy);
    if (node !== null) {
      // 잡은 노드를 손가락에 고정하고 시뮬을 재가열한다.
      lay.sim.alphaTarget(0.3).restart();
      node.fx = node.x;
      node.fy = node.y;
    }
    dragRef.current = { node, x: sx, y: sy, moved: false };
  };

  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const lay = layoutRef.current;
    if (lay === null) return;
    const { sx, sy } = local(e, e.currentTarget);
    const d = dragRef.current;

    if (d === null) {
      hoverRef.current = hitNode(lay.nodes, viewRef.current, sx, sy)?.id ?? null;
      return;
    }

    if (Math.abs(sx - d.x) + Math.abs(sy - d.y) > CLICK_SLOP) d.moved = true;

    if (d.node !== null) {
      const w = toWorld(viewRef.current, sx, sy);
      d.node.fx = w.x;
      d.node.fy = w.y;
    } else {
      const v = viewRef.current;
      viewRef.current = { zoom: v.zoom, panX: v.panX + (sx - d.x), panY: v.panY + (sy - d.y) };
      d.x = sx;
      d.y = sy;
    }
  };

  /** 포인터가 캔버스를 벗어나면 pointermove 가 더 안 온다 — 안 지우면 마지막 hover 가 영영 남는다. */
  const onLeave = () => {
    hoverRef.current = null;
  };

  const onUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const lay = layoutRef.current;
    const d = dragRef.current;
    // 상태를 먼저 되돌린다 — releasePointerCapture 는 pointerCancel 이 만드는
    // 상황에서 throw 할 수 있고, 뒤에 두면 드래그가 무장 상태로 남는다.
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (lay === null || d === null) return;

    lay.sim.alphaTarget(0);
    if (d.node === null) return;

    // 놓으면 다시 물리에 맡긴다. 못 박아 두면 그래프가 조금씩 굳는다.
    d.node.fx = null;
    d.node.fy = null;
    if (!d.moved) void openTab(d.node.id, d.node.title);
  };

  return (
    <div
      ref={hostRef}
      // hidden 이면 display:none — rAF 가드(위)와 짝을 이뤄 안 보이는 캔버스를 0×0 으로 만들지 않는다.
      className={`relative min-h-0 flex-1 overflow-hidden ${hidden ? "hidden" : ""}`}
    >
      <canvas
        ref={canvasRef}
        onWheel={onWheel}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={onLeave}
        className="block h-full w-full"
      />

      <div className="absolute left-3 top-3 flex items-center gap-2 text-xs text-ink-muted">
        <button
          type="button"
          onClick={() => void load()}
          disabled={status === "loading"}
          className="rounded border border-hairline bg-chrome px-2 py-1 hover:bg-fill-subtle disabled:opacity-60"
        >
          새로고침
        </button>
        {status === "ready" && <span>{message}</span>}
        {status === "loading" && <span>읽는 중…</span>}
      </div>

      {status === "error" && (
        <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-danger">
          {message}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `NoteView.tsx` 를 고친다**

import 를 더하고:

```tsx
import { GraphView } from "../features/graph/GraphView.tsx";
```

그래프 탭이 있는 한 `<GraphView/>` 를 계속 마운트해 두고, 활성 탭이 아닐 때만 `hidden` 으로
숨긴다 — 언마운트하면 재스캔·재배치로 pan/zoom 과 노드 위치를 잃는다(§8). `noteBody(tab)` 은
`tab.kind === "graph"` 일 때 `null` 을 반환해 그 자리를 비워 준다.

```tsx
{
  graphOpen && <GraphView hidden={tab === null || tab.kind !== "graph"} />;
}
{
  noteBody(tab);
}
```

- [ ] **Step 3: `Ribbon.tsx` 에 버튼을 단다**

파일 전체를 이렇게 만든다.

```tsx
import type { ReactNode } from "react";
import { IS_MAC } from "../bridge.ts";
import { GRAPH_TAB_ID, RIBBON_WIDTH, useWorkspace } from "../store/workspace.ts";

/**
 * 리본 아이콘 하나.
 * `app-no-drag` 가 필요한 이유: 상단 32px 이 창을 끄는 띠라 안 붙이면 눌러도 창만 끌린다.
 * `relative z-10` 은 부모 <nav> 가 이미 갖고 있다.
 */
function RibbonButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-current={active === true ? "true" : undefined}
      className={`app-no-drag grid h-8 w-8 place-items-center rounded ${
        active === true
          ? "bg-fill-subtle text-ink"
          : "text-ink-muted hover:bg-fill-subtle hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** 좌측 아이콘 바. 사이드바 토글과 그래프 둘이다. */
export function Ribbon() {
  const sidebarOpen = useWorkspace((s) => s.sidebarOpen);
  const toggleSidebar = useWorkspace((s) => s.toggleSidebar);
  const openGraphTab = useWorkspace((s) => s.openGraphTab);
  const graphActive = useWorkspace((s) => s.activeTab === GRAPH_TAB_ID);

  return (
    <nav
      aria-label="리본"
      style={{ width: RIBBON_WIDTH }}
      className={`relative z-10 flex shrink-0 flex-col items-center gap-1 border-r border-hairline bg-chrome ${
        // macOS 는 왼쪽 위에 OS 신호등이 있다. 첫 버튼을 그 아래로 내린다.
        IS_MAC ? "pt-10" : "pt-2"
      }`}
    >
      <RibbonButton
        label={sidebarOpen ? "사이드바 접기" : "사이드바 펼치기"}
        onClick={toggleSidebar}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        >
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
          <line x1="6" y1="2.5" x2="6" y2="13.5" />
        </svg>
      </RibbonButton>

      <RibbonButton label="그래프" active={graphActive} onClick={openGraphTab}>
        {/* 구 레포 GraphIcon — 점 셋과 잇는 선. */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
        >
          <circle cx="4" cy="4.2" r="1.8" />
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="8" cy="12" r="1.8" />
          <path d="M5.4 5.5 7.2 10.2M10.9 6.4 9 10.4M5.8 4.4h4.4" />
        </svg>
      </RibbonButton>
    </nav>
  );
}
```

- [ ] **Step 4: 기계 검증**

```bash
npx prettier --write . && npm run lint && npm run typecheck && npm test
```

Expected: `Tests 128 passed (128)`

- [ ] **Step 5: 앱을 띄워 눈으로 본다**

Global Constraints 의 "앱을 띄워 확인하는 절차" 를 그대로 따른다. 확인할 것:

1. 리본에 **아이콘이 둘**이고, 그래프 아이콘이 사이드바 토글 **아래**에 있다
2. 폴더를 열지 않은 상태에서 그래프를 누르면 **"볼트가 열려 있지 않다"** 가 뜬다
3. 볼트(`~/dev/piecepool-vault-personal` 또는 실험 볼트)를 열고 그래프를 누르면
   - 탭 줄에 **"그래프"** 탭이 생긴다
   - 점이 뜨고 뭉쳤다가 **멈춘다** (계속 떨리면 실패다)
   - 왼쪽 위 문구의 노트 수가 볼트의 `.md` 수와 맞는다
4. 휠로 확대하면 **커서 아래 점이 제자리에** 있고, 확대하면 **이름이 드러난다**
5. 빈 곳을 끌면 화면이 따라오고, **점을 끌면 이웃이 따라오다 놓으면 제자리로** 돌아간다
6. 점에 마우스를 올리면 **그 점과 이웃만 밝고 나머지는 흐려진다**
7. 점을 **클릭**(끌지 않고)하면 그 노트의 탭이 열린다
8. 그래프 탭을 닫았다 리본으로 다시 열어도 **탭이 하나**다
9. 볼트를 바꾸면 그래프 탭이 **사라진다**
10. 그래프 탭에서 노트 탭으로 옮긴 뒤 **CPU 사용률이 내려간다** (작업 관리자)

- [ ] **Step 6: 스크린샷을 요청한다**

CLAUDE.md §7 — 비포·애프터 스크린샷은 사용자가 찍는다. **리본 버튼**과 **그래프 탭** 두 장을 요청하고, 받기 전에는 리뷰를 요청하지 않는다.

- [ ] **Step 7: 커밋**

```bash
git add src/renderer/features/graph/GraphView.tsx src/renderer/app/NoteView.tsx src/renderer/app/Ribbon.tsx
git commit -F - <<'MSG'
feat: 리본을 누르면 볼트 전체의 링크 그래프가 뜬다

좌표·변환·hover 는 ref 에 둔다 — 상태로 두면 프레임마다 리렌더가 돈다.
탭을 떠나도 시뮬은 세우지 않는다. 컴포넌트를 그래프 탭이 있는 한 계속 마운트해 두고
hidden 으로만 숨기므로, 세울 곳은 진짜 언마운트뿐이다 — alpha 가 스스로 식어 CPU 를 지킨다.
점을 끌었다 놓으면 fx/fy 를 풀어 다시 물리에 맡긴다 — 못 박으면 그래프가 굳는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## 끝난 뒤

- `npm ci && npx prettier --check . && npm run lint && npm run typecheck && npm test` 를 **CI 순서 그대로** 한 번 더 돌린다
- 설계문서(`docs/superpowers/specs/2026-09-16-graph-view-design.md`)의 상태를 `구현 완료` 로 고친다
- README 의 "실동작하는 건 …" 줄이 거짓이 됐는지 확인한다 — `core/index/` 가 부분 동작한다
- PR 설명은 **올리는 사람이 직접 쓴다** (CLAUDE.md §8)
