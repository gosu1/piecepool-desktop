// FROZEN: 파일 전체 — A↔B 경계면 + 툴 6종 (0단계 설계 §3.4·§8)
import type { Vault } from "../../shared/types.ts";
import type { Written } from "./written.ts";
import { readRaw } from "../vault/notes.ts";
import { readTree } from "../vault/tree.ts";
import { flatten, scanVault } from "../index/scan.ts";
import { backlinksOf } from "../index/links.ts";
import { buildIndex, search, type WikiIndex } from "../index/search.ts";

/** 상위 §7.2 가 이름과 인자를 문자 그대로 제시한 6종. */
export type ToolName =
  "list_notes" | "read_note" | "write_note" | "search" | "backlinks" | "delete_note";

/**
 * 쿼리 세션이 받는 집합. 쓰기 2종만 빠진다 —
 * 상위 §4.1 이 "읽기(read_note·search·backlinks)는 처음부터 볼트 전체를 본다" 고,
 * 상위 §7.2 가 "write_note / delete_note 는 vault/paths.ts 를 통과해야 한다" 고 규정한다.
 */
export type ReadOnlyToolName = Exclude<ToolName, "write_note" | "delete_note">;

// 4단계에 Tool 로 툴콜 스키마 같은 선택 필드가 추가되는 것은
// 동결 파기가 아니라 예정된 증분이다. 6단계(쿼리)가 그 시점이다.
// args 는 LLM 이 준 신뢰할 수 없는 JSON 이라 런타임 검증을 거친다 —
// 검증 실패는 던지지 않고 { error } 로 돌려준다. 던지면 세션이 죽고,
// 돌려주면 AI 가 고쳐 다시 부른다.

export interface Tool {
  name: ToolName;
  run(args: Record<string, unknown>): Promise<unknown>;
  /** LLM 에게 보낼 툴 정의. `parameters` 는 JSON Schema. */
  schema?: { description: string; parameters: Record<string, unknown> };
}

/** LLM 이 준 값에서 문자열을 꺼낸다. 없거나 딴 타입이면 이유를 돌려준다. */
function str(args: Record<string, unknown>, key: string): string | { error: string } {
  const v = args[key];
  if (typeof v !== "string") return { error: `${key} 는 문자열이어야 한다` };
  return v;
}

/**
 * `wiki/*` 같은 아주 작은 glob 만 받는다. `*` 는 `/` 를 넘지 않는다.
 *
 * export 는 테스트 전용이다 — Windows 는 `?` 를 파일명에 못 써서 list_notes 를
 * 통해서는 이스케이프를 재현할 수 없다.
 */
export function globToRe(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|?[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${esc}$`);
}

/**
 * 툴 6종: list_notes · read_note · write_note · search · backlinks · delete_note
 *
 * 읽기는 볼트 전체를 본다. 쓰기는 agentWriteRoots 아래만 —
 * 즉 에이전트는 볼트 전체를 근거로 삼되 정해진 곳에만 쓴다.
 * sources/files/ 는 쓰기 금지다.
 *
 * readOnly 는 쿼리 세션용이다. 대화 중에는 위키를 고치지 않고,
 * 반영은 세션 끝의 수확에서 ingest 를 통해 일어난다.
 */
export function createTools(v: Vault, w: Written, o?: { readOnly?: boolean }): Tool[] {
  if (o?.readOnly !== true) {
    throw new Error("unimplemented: core/agent/tools.createTools");
  }

  // 색인은 처음 쓸 때 한 번 만들어 세션 동안 재사용한다.
  let wiki: WikiIndex | null = null;
  let links: Awaited<ReturnType<typeof scanVault>> | null = null;

  const tools: Tool[] = [
    {
      name: "search",
      schema: {
        description:
          "위키를 낱말로 찾는다. 절 단위로 점수가 높은 것부터 발췌와 함께 돌려준다. 0건이면 다른 말로 다시 불러 본다.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["query"],
          properties: { query: { type: "string" }, limit: { type: "number" } },
        },
      },
      async run(args) {
        const q = str(args, "query");
        if (typeof q !== "string") return q;
        wiki ??= await buildIndex(v);
        const limit = typeof args.limit === "number" ? args.limit : undefined;
        const hits = search(wiki, q, { limit });
        return hits.length === 0 ? { hits: [], note: "0건" } : { hits };
      },
    },
    {
      name: "read_note",
      schema: {
        description: "노트 원문을 통째로 읽는다. search 의 발췌로 모자랄 때 쓴다.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["path"],
          properties: { path: { type: "string" } },
        },
      },
      async run(args) {
        const p = str(args, "path");
        if (typeof p !== "string") return p;
        try {
          return { text: await readRaw(v, p) };
        } catch (e: unknown) {
          const code = (e as NodeJS.ErrnoException).code;
          if (code === "ENOENT") return { error: `없는 파일이다: ${p}` };
          return { error: `볼트 밖 경로이거나 읽을 수 없다: ${p}` };
        }
      },
    },
    {
      name: "backlinks",
      schema: {
        description: "이 노트를 가리키는 노트들을 돌려준다.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["path"],
          properties: { path: { type: "string" } },
        },
      },
      async run(args) {
        const p = str(args, "path");
        if (typeof p !== "string") return p;
        links ??= await scanVault(v);
        return { paths: backlinksOf(p, links.links) };
      },
    },
    {
      name: "list_notes",
      schema: {
        description:
          "노트 경로를 나열한다. glob 은 `wiki/*` 처럼 쓴다. search 가 0건일 때 어떤 페이지가 있는지 보는 데 쓴다.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: { glob: { type: "string" } },
        },
      },
      async run(args) {
        const all = flatten(await readTree(v));
        if (args.glob === undefined) return { paths: all };
        const g = str(args, "glob");
        if (typeof g !== "string") return g;
        const re = globToRe(g);
        return { paths: all.filter((p) => re.test(p)) };
      },
    },
  ];

  return tools;
}
