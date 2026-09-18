// 툴콜 루프 — 가짜 LLM 으로 네트워크 없이 확인한다.
import { describe, expect, it } from "vitest";
import type { CallUsage, ToolCall } from "../llm/chat.ts";
import { runAgent } from "./loop.ts";
import type { Tool } from "./tools.ts";

const usage: CallUsage = { prompt: 0, cached: 0, completion: 0, reasoning: 0, usd: null, ms: 1 };

/** 대본대로 답하는 가짜 LLM. */
function fakeLlm(script: { text: string; calls: ToolCall[] }[]) {
  let i = 0;
  return async () => ({ ...script[Math.min(i++, script.length - 1)], usage });
}

const searchTool: Tool = {
  name: "search",
  async run() {
    return { hits: [{ path: "wiki/달리기.md", heading: "페이스", score: 1, text: "6분" }] };
  },
};

describe("runAgent", () => {
  it("툴콜이 없으면 그 텍스트가 답이다", async () => {
    const r = await runAgent("sys", "질문", [], { llm: fakeLlm([{ text: "답", calls: [] }]) });
    expect(r.text).toBe("답");
    expect(r.turns).toBe(1);
    expect(r.hitCap).toBe(false);
  });

  it("툴콜을 실행하고 결과를 붙여 다시 부른다", async () => {
    const r = await runAgent("sys", "질문", [searchTool], {
      llm: fakeLlm([
        { text: "", calls: [{ id: "c1", name: "search", args: { query: "달리기" } }] },
        { text: "6분입니다", calls: [] },
      ]),
    });
    expect(r.text).toBe("6분입니다");
    expect(r.toolCalls).toBe(1);
  });

  it("search 가 돌려준 절을 opened 에 넣는다", async () => {
    const r = await runAgent("sys", "질문", [searchTool], {
      llm: fakeLlm([
        { text: "", calls: [{ id: "c1", name: "search", args: {} }] },
        { text: "답", calls: [] },
      ]),
    });
    expect(r.opened.has("wiki/달리기.md#페이스")).toBe(true);
  });

  it("read_note 는 페이지 전체를 opened 에 넣는다", async () => {
    const readTool: Tool = {
      name: "read_note",
      async run() {
        return { text: "전문", path: "wiki/수면.md" };
      },
    };
    const r = await runAgent("sys", "질문", [readTool], {
      llm: fakeLlm([
        { text: "", calls: [{ id: "c1", name: "read_note", args: { path: "wiki/수면.md" } }] },
        { text: "답", calls: [] },
      ]),
    });
    expect(r.opened.has("wiki/수면.md")).toBe(true);
  });

  it("opened 는 인자가 아니라 결과의 path 를 쓴다 — 비정규 인자로 근거가 어긋나지 않는다", async () => {
    const readTool: Tool = {
      name: "read_note",
      async run() {
        return { text: "전문", path: "wiki/수면.md" };
      },
    };
    const r = await runAgent("sys", "질문", [readTool], {
      llm: fakeLlm([
        { text: "", calls: [{ id: "c1", name: "read_note", args: { path: "./wiki/수면.md" } }] },
        { text: "답", calls: [] },
      ]),
    });
    expect(r.opened.has("wiki/수면.md")).toBe(true);
    expect(r.opened.has("./wiki/수면.md")).toBe(false);
  });

  it("실패한 툴 결과는 opened 에 넣지 않는다 — 근거가 될 수 없다", async () => {
    const bad: Tool = {
      name: "read_note",
      async run() {
        return { error: "없는 파일이다" };
      },
    };
    const r = await runAgent("sys", "질문", [bad], {
      llm: fakeLlm([
        { text: "", calls: [{ id: "c1", name: "read_note", args: { path: "wiki/없다.md" } }] },
        { text: "답", calls: [] },
      ]),
    });
    expect(r.opened.size).toBe(0);
  });

  it("툴이 던지면 세션이 죽지 않고 error 결과로 이어간다", async () => {
    const throwing: Tool = {
      name: "read_note",
      async run() {
        throw new Error("EACCES");
      },
    };
    const r = await runAgent("sys", "질문", [throwing], {
      llm: fakeLlm([
        { text: "", calls: [{ id: "c1", name: "read_note", args: { path: "wiki/수면.md" } }] },
        { text: "답", calls: [] },
      ]),
    });
    expect(r.text).toBe("답");
    expect(r.opened.size).toBe(0);
  });

  it("없는 툴을 부르면 결과로 알리고 계속 돈다", async () => {
    const r = await runAgent("sys", "질문", [], {
      llm: fakeLlm([
        { text: "", calls: [{ id: "c1", name: "없는툴", args: {} }] },
        { text: "답", calls: [] },
      ]),
    });
    expect(r.text).toBe("답");
  });

  it("상한에 닿으면 툴을 떼고 한 번 더 불러 답을 받고 hitCap 을 세운다", async () => {
    // 계속 툴만 부르는 모델.
    const r = await runAgent("sys", "질문", [searchTool], {
      maxTurns: 2,
      llm: fakeLlm([{ text: "", calls: [{ id: "c1", name: "search", args: {} }] }]),
    });
    expect(r.hitCap).toBe(true);
    expect(r.turns).toBe(3); // 상한 2 + 툴 없는 마지막 호출
  });
});
