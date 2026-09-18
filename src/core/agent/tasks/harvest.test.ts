// 수확 — 세션 로그가 자료 하나로 ingest 를 타서 커밋 하나가 된다.
import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import git from "isomorphic-git";
import type { Vault } from "../../../shared/types.ts";
import { repo } from "../../git/repo.ts";
import type { LlmPage } from "../../llm/chat.ts";
import type { Llm } from "../../ingest/engine.ts";
import { harvest, harvestLog } from "./harvest.ts";
import type { QuerySession } from "./query.ts";

async function tempVault(): Promise<Vault> {
  const root = await mkdtemp(join(tmpdir(), "pp-harvest-"));
  await git.init({ ...repo({ root, agentWriteRoots: [] }) });
  return { root, agentWriteRoots: ["wiki", "sources", ".piecepool"] };
}

async function write(root: string, p: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, p)), { recursive: true });
  await writeFile(join(root, p), text, "utf8");
}

const read = (root: string, p: string) => readFile(join(root, p), "utf8");

/** 자료의 문장을 인용하는 페이지 한 장을 내는 가짜 AI. */
function fakeLlm(pages: LlmPage[]): Llm {
  return {
    async writeWiki() {
      return { pages };
    },
    async askJson<T>() {
      return { value: { summary: "달리기를 시작한 사람" } as T };
    },
  };
}

const LOG =
  "---\nid: s1\nmodel: kimi-k3\ndate: 2026-09-18\nturns: 2\ntool_calls: 1\nhit_cap: false\ntokens: { in: 1, cached: 0, out: 1 }\nunsourced: 0\n---\n\n## 1턴 (사용자)\n\n무릎이 아픈데 계속 뛰어도 될까?\n\n## 2턴 (AI)\n\n주당 10% 이상 늘리지 않는 것이 통설입니다.\n";

const PAGE: LlmPage = {
  name: "달리기",
  aliases_to_add: [],
  summary: "s",
  new_sections: [],
  replace_sections: [],
  new_records: [
    { fact: "주당 10% 이상 늘리지 않는다", quote: "주당 10% 이상 늘리지 않는 것이 통설입니다" },
  ],
};

describe("harvestLog", () => {
  it("세션 로그가 위키 · 출처 페이지 · 로그 자체와 함께 커밋 하나가 된다", async () => {
    const v = await tempVault();
    await write(v.root, ".piecepool/sessions/s1.md", LOG);

    const r = await harvestLog(v, "s1", LOG, { llm: fakeLlm([PAGE]) });

    expect(r.commitOid).not.toBe("");
    expect(r.written).toContain("wiki/달리기.md");
    expect(r.written).toContain("sources/@session-s1.md");
    expect(r.written).toContain(".piecepool/sessions/s1.md");
    expect(await read(v.root, "wiki/달리기.md")).toContain("← [[@session-s1#2턴 (AI)]] (AI)");
    // 로그의 date: 가 출처 날짜로 간다
    expect(await read(v.root, "sources/@session-s1.md")).toContain("date: 2026-09-18");
    expect(await git.listFiles({ ...repo(v), ref: "HEAD" })).toContain(".piecepool/sessions/s1.md");
    // 커밋 하나 — 로그가 봉인 커밋으로 밀리지 않았다
    expect(await git.log({ ...repo(v) })).toHaveLength(1);
  });

  it("같은 로그를 다시 수확하면 커밋하지 않는다 — 입력 벽 7", async () => {
    const v = await tempVault();
    await write(v.root, ".piecepool/sessions/s1.md", LOG);
    const llm = fakeLlm([PAGE]);
    await harvestLog(v, "s1", LOG, { llm });

    const again = await harvestLog(v, "s1", LOG, { llm });

    expect(again.commitOid).toBe("");
    expect(again.written).toEqual([]);
  });
});

describe("harvest", () => {
  it("빈 로그는 거부한다 — 반영할 대화가 없다", async () => {
    const v = { root: "unused", agentWriteRoots: [] };
    const session: QuerySession = {
      id: "s0",
      date: "2026-09-18",
      log: "",
      turns: [],
      history: [],
    };
    await expect(harvest(v, session)).rejects.toMatchObject({ kind: "parse_failed" });
  });
});
