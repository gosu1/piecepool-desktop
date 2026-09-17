// 툴콜 메시지 변환 — 네트워크 없이 확인한다.
import { describe, expect, it } from "vitest";
import { parseCalls, toApiMessages } from "./chat.ts";

describe("toApiMessages", () => {
  it("model 을 assistant 로 바꾼다 — OpenAI 호환 이름이다", () => {
    const out = toApiMessages([{ role: "model", text: "안녕" }]);
    expect(out).toEqual([{ role: "assistant", content: "안녕" }]);
  });

  it("system 을 맨 앞에 끼운다", () => {
    const out = toApiMessages([{ role: "user", text: "질문" }], "너는 …");
    expect(out[0]).toEqual({ role: "system", content: "너는 …" });
  });

  it("툴 결과를 tool 역할과 tool_call_id 로 싣는다", () => {
    const out = toApiMessages([
      { role: "tool", callId: "c1", name: "search", result: { hits: [] } },
    ]);
    expect(out).toEqual([
      { role: "tool", tool_call_id: "c1", content: JSON.stringify({ hits: [] }) },
    ]);
  });
});

describe("parseCalls", () => {
  it("툴콜이 없으면 본문만 낸다", () => {
    const raw = { choices: [{ message: { content: "답입니다" } }] };
    expect(parseCalls(raw)).toEqual({ text: "답입니다", calls: [] });
  });

  it("arguments 를 JSON 으로 읽는다", () => {
    const raw = {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ id: "c1", function: { name: "search", arguments: '{"query":"무릎"}' } }],
          },
        },
      ],
    };
    expect(parseCalls(raw)).toEqual({
      text: "",
      calls: [{ id: "c1", name: "search", args: { query: "무릎" } }],
    });
  });

  it("arguments 가 깨졌으면 빈 인자로 둔다 — 툴이 검증해서 결과로 알려준다", () => {
    const raw = {
      choices: [
        { message: { tool_calls: [{ id: "c1", function: { name: "search", arguments: "{" } }] } },
      ],
    };
    expect(parseCalls(raw).calls[0].args).toEqual({});
  });
});
