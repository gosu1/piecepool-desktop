import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaceBody, saveBody } from "./edit.ts";

describe("replaceBody", () => {
  it("프론트매터는 글자 그대로 두고 본문만 바꾼다 — hashes 를 건드리지 않는다", () => {
    const raw = "---\ncreated: 2026-09-17\nhashes:\n  요약: 0123abcd\n---\n\n# 제목\n\n옛 본문\n";
    const out = replaceBody(raw, "# 제목\n\n새 본문\n");
    expect(out).toBe(
      "---\ncreated: 2026-09-17\nhashes:\n  요약: 0123abcd\n---\n\n# 제목\n\n새 본문\n",
    );
  });

  it("프론트매터가 없으면 본문이 곧 파일이다", () => {
    expect(replaceBody("옛 글", "새 글")).toBe("새 글");
  });

  it("CRLF 파일은 CRLF 로 되쓴다", () => {
    const raw = "---\r\ntitle: a\r\n---\r\n\r\n옛\r\n";
    expect(replaceBody(raw, "새\n둘째 줄\n")).toBe(
      "---\r\ntitle: a\r\n---\r\n\r\n새\r\n둘째 줄\r\n",
    );
  });

  it("닫히지 않은 --- 는 프론트매터가 아니다", () => {
    expect(replaceBody("---\n안 닫힘\n본문", "새")).toBe("새");
  });
});

describe("saveBody", () => {
  it("볼트 안 노트를 읽어 본문만 바꿔 쓴다", async () => {
    const root = await mkdtemp(join(tmpdir(), "pp-edit-"));
    await writeFile(join(root, "a.md"), "---\nk: v\n---\n\n옛\n", "utf8");
    await saveBody({ root, agentWriteRoots: ["wiki"] }, "a.md", "새\n");
    expect(await readFile(join(root, "a.md"), "utf8")).toBe("---\nk: v\n---\n\n새\n");
  });

  it("볼트 밖 경로는 쓰지 않는다", async () => {
    const root = await mkdtemp(join(tmpdir(), "pp-edit-"));
    await expect(
      saveBody({ root, agentWriteRoots: ["wiki"] }, "../밖.md", "x"),
    ).rejects.toMatchObject({ kind: "path_escape" });
  });
});
