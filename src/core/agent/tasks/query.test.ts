// 세션 로그 — A 의 수확이 읽을 형식이다.
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { openVault } from "../../vault/open.ts";
import { buildSessionLog } from "./query.ts";

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "pp-query-"));
  await mkdir(join(root, "wiki"), { recursive: true });
  await writeFile(join(root, "wiki", "달리기.md"), "# 달리기\n\n> 주 3회.\n", "utf8");
  await openVault(root);
});

const meta = {
  id: "2026-09-18-1432",
  model: "kimi-k3",
  turns: 2,
  toolCalls: 1,
  hitCap: false,
  tokens: { in: 100, cached: 50, out: 20 },
  usd: 0.001,
  opened: ["wiki/달리기.md#요약"],
  unsourced: 0,
};

describe("buildSessionLog", () => {
  it("턴을 `## N턴 (사용자)` · `## N턴 (AI)` 로 쓴다 — 수확이 이 형식을 전제한다", () => {
    const md = buildSessionLog(meta, [
      { who: "사용자", text: "얼마나 뛰어?" },
      { who: "AI", text: "주 3회입니다. [[달리기#요약]]" },
    ]);
    expect(md).toContain("## 1턴 (사용자)");
    expect(md).toContain("## 2턴 (AI)");
  });

  it("계기는 프론트매터에만 둔다 — 본문에 섞으면 수확이 사실로 읽는다", () => {
    const md = buildSessionLog(meta, [{ who: "사용자", text: "질문" }]);
    const body = md.slice(md.indexOf("\n---\n", 4) + 5);
    expect(body).not.toContain("kimi-k3");
    expect(body).not.toContain("turns");
  });

  it("연 경로와 unsourced 를 프론트매터에 남긴다", () => {
    const md = buildSessionLog(meta, [{ who: "사용자", text: "질문" }]);
    expect(md).toContain("  - wiki/달리기.md#요약");
    expect(md).toContain("unsourced: 0");
  });
});
