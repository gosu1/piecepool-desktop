// OWNER: A — 6단계에서 쿼리(B)가 채웠다 (2026-09-18).
//
// 종료는 셋이다. ① 툴콜이 없으면 그 텍스트가 답이다 ② 왕복 상한에 닿으면
// 툴을 떼고 한 번 더 불러 답을 받는다 ③ LLM 호출 자체가 실패하면 던진다.
//
// ② 가 있는 이유: 상한에서 그냥 끊으면 "모델이 못 한 것" 과 "상한 아티팩트" 가
// 로그에서 구분되지 않는다. 2026-09-09 조회 스파이크가 겪은 일이다.
import type { OnProgress } from "../../shared/types.ts";
import { generate, type CallUsage, type LlmMessage, type ToolSpec } from "../llm/chat.ts";
import type { Opened } from "./cite.ts";
import type { Tool } from "./tools.ts";

export interface AgentResult {
  text: string;
  opened: Opened;
  turns: number;
  toolCalls: number;
  hitCap: boolean;
  usage: CallUsage[];
}

const DEFAULT_MAX_TURNS = 8;

function maxTurnsFromEnv(): number {
  const raw = Number(process.env.PIECEPOOL_MAX_TURNS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_TURNS;
}

/** 툴 결과에서 "실제로 본 것" 을 꺼낸다. 실패한 호출은 근거가 될 수 없어 넣지 않는다. */
function collectOpened(name: string, args: Record<string, unknown>, result: unknown, into: Opened) {
  if (typeof result !== "object" || result === null || "error" in result) return;
  if (name === "search") {
    const hits = (result as { hits?: { path: string; heading: string }[] }).hits ?? [];
    for (const h of hits) into.add(`${h.path}#${h.heading}`);
  } else if (name === "read_note" && typeof args.path === "string") {
    into.add(args.path);
  }
}

function toSpecs(tools: Tool[]): ToolSpec[] {
  return tools
    .filter((t) => t.schema !== undefined)
    .map((t) => ({
      name: t.name,
      description: t.schema!.description,
      parameters: t.schema!.parameters,
    }));
}

export async function runAgent(
  prompt: string,
  input: string,
  tools: Tool[],
  o?: {
    onProgress?: OnProgress;
    /** 이전 턴들. 대화 모드가 넘긴다. */
    history?: LlmMessage[];
    maxTurns?: number;
    /** 테스트가 가짜 LLM 을 끼우는 자리. */
    llm?: typeof generate;
  },
): Promise<AgentResult> {
  const llm = o?.llm ?? generate;
  const maxTurns = o?.maxTurns ?? maxTurnsFromEnv();
  const messages: LlmMessage[] = [...(o?.history ?? []), { role: "user", text: input }];
  const opened: Opened = new Set();
  const usage: CallUsage[] = [];
  let turns = 0;
  let toolCalls = 0;

  while (turns < maxTurns) {
    turns++;
    const res = await llm(messages, { system: prompt, tools: toSpecs(tools) });
    usage.push(res.usage);

    if (res.calls.length === 0) {
      return { text: res.text, opened, turns, toolCalls, hitCap: false, usage };
    }

    messages.push({ role: "model", text: res.text, calls: res.calls });
    for (const call of res.calls) {
      toolCalls++;
      const tool = tools.find((t) => t.name === call.name);
      const result = tool ? await tool.run(call.args) : { error: `그런 툴은 없다: ${call.name}` };
      collectOpened(call.name, call.args, result, opened);
      o?.onProgress?.({ step: "툴", detail: `${call.name} ${JSON.stringify(call.args)}` });
      messages.push({ role: "tool", callId: call.id, name: call.name, result });
    }
  }

  // 상한 — 툴을 떼고 한 번 더 부른다. 이 호출은 상한 밖이다.
  o?.onProgress?.({ step: "왕복 상한", detail: `${maxTurns}회 — 가진 근거로 답하게 한다` });
  turns++;
  const last = await llm(
    [
      ...messages,
      { role: "user", text: "지금까지 얻은 근거만으로 답하고, 모자라면 모자란다고 말하십시오." },
    ],
    { system: prompt },
  );
  usage.push(last.usage);
  return { text: last.text, opened, turns, toolCalls, hitCap: true, usage };
}
