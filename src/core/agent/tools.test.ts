// 읽기 툴 4종 — 실패가 예외가 아니라 결과로 온다.
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Vault } from "../../shared/types.ts";
import { openVault } from "../vault/open.ts";
import { createTools, globToRe } from "./tools.ts";
import { Written } from "./written.ts";

let v: Vault;

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "pp-tools-"));
  await mkdir(join(root, "wiki"), { recursive: true });
  await writeFile(
    join(root, "wiki", "달리기.md"),
    "---\ncreated: 2026-09-01\n---\n\n# 달리기\n\n> 주 3회 5km 를 뛴다.\n\n## 페이스\n\n킬로미터당 6분.\n",
    "utf8",
  );
  await writeFile(
    join(root, "wiki", "무릎 통증.md"),
    "---\ncreated: 2026-09-02\n---\n\n# 무릎 통증\n\n> [[달리기]] 뒤에 아프다.\n",
    "utf8",
  );
  v = await openVault(root);
});

function toolsOf() {
  return createTools(v, new Written(), { readOnly: true });
}

/** 이름으로 툴 하나를 집는다. `createTools` 는 동기 함수다 — await 하지 않는다. */
function toolOf(name: string) {
  return toolsOf().find((t) => t.name === name)!;
}

describe("createTools", () => {
  it("읽기 전용이면 4종만 준다", () => {
    expect(
      toolsOf()
        .map((t) => t.name)
        .sort(),
    ).toEqual(["backlinks", "list_notes", "read_note", "search"]);
  });

  it("모든 툴이 schema 를 들고 있다 — LLM 에게 보낼 정의다", () => {
    for (const t of toolsOf()) expect(t.schema?.description).toBeTruthy();
  });
});

describe("read_note", () => {
  it("원문을 돌려준다", async () => {
    const r = (await toolOf("read_note").run({ path: "wiki/달리기.md" })) as { text: string };
    expect(r.text).toContain("킬로미터당 6분");
  });

  it("path 가 문자열이 아니면 던지지 않고 error 를 돌려준다", async () => {
    expect(await toolOf("read_note").run({ path: 42 })).toEqual({
      error: "path 는 문자열이어야 한다",
    });
  });

  it("볼트 밖 경로는 error 다", async () => {
    const r = (await toolOf("read_note").run({ path: "../밖.md" })) as { error: string };
    expect(r.error).toContain("볼트 밖");
  });

  it("없는 파일은 error 다", async () => {
    const r = (await toolOf("read_note").run({ path: "wiki/없다.md" })) as { error: string };
    expect(r.error).toContain("없는 파일");
  });

  it("정규화된 path 를 결과에 싣는다 — opened 대조가 인자 문자열에 흔들리지 않는다", async () => {
    const r = (await toolOf("read_note").run({ path: "wiki/달리기.md" })) as { path: string };
    expect(r.path).toBe("wiki/달리기.md");
  });

  it(".md 가 아닌 파일은 거부한다", async () => {
    await mkdir(join(v.root, "sources"), { recursive: true });
    await writeFile(join(v.root, "sources", "원본.txt"), "비밀", "utf8");
    const r = (await toolOf("read_note").run({ path: "sources/원본.txt" })) as { error: string };
    expect(r.error).toBeTruthy();
  });

  it("숨김 폴더·숨김 파일은 거부한다 — .obsidian·.git·.env 유출을 막는다", async () => {
    await mkdir(join(v.root, ".obsidian"), { recursive: true });
    await writeFile(join(v.root, ".obsidian", "workspace.json"), "{}", "utf8");
    await writeFile(join(v.root, ".env"), "SECRET=1", "utf8");

    const hidden = (await toolOf("read_note").run({ path: ".obsidian/workspace.json" })) as {
      error: string;
    };
    expect(hidden.error).toBeTruthy();

    const dotfile = (await toolOf("read_note").run({ path: ".env" })) as { error: string };
    expect(dotfile.error).toBeTruthy();
  });
});

describe("search", () => {
  it("절을 찾는다", async () => {
    const r = (await toolOf("search").run({ query: "페이스" })) as { hits: { path: string }[] };
    expect(r.hits[0].path).toBe("wiki/달리기.md");
  });

  it("0건이면 그렇다고 알린다", async () => {
    expect(await toolOf("search").run({ query: "양자역학" })).toEqual({ hits: [], note: "0건" });
  });

  it("limit: 0 은 무시된다 — 검색이 됐는데 0건으로 거짓말하지 않는다", async () => {
    const r = (await toolOf("search").run({ query: "페이스", limit: 0 })) as {
      hits: unknown[];
    };
    expect(r.hits.length).toBeGreaterThan(0);
  });

  it("limit 을 20 으로 자른다", async () => {
    for (let i = 0; i < 12; i++) {
      await writeFile(
        join(v.root, "wiki", `테스트${i}.md`),
        `---\ncreated: 2026-09-03\n---\n\n# 테스트${i}\n\n## 하나\n\n테스트 절 본문.\n\n## 둘\n\n테스트 절 본문.\n`,
        "utf8",
      );
    }
    const r = (await toolOf("search").run({ query: "테스트", limit: 999 })) as {
      hits: unknown[];
    };
    expect(r.hits.length).toBeLessThanOrEqual(20);
  });
});

describe("backlinks", () => {
  it("들어오는 링크를 돌려준다", async () => {
    const r = (await toolOf("backlinks").run({ path: "wiki/달리기.md" })) as { paths: string[] };
    expect(r.paths).toContain("wiki/무릎 통증.md");
  });
});

describe("list_notes", () => {
  it("glob 으로 좁힌다", async () => {
    const r = (await toolOf("list_notes").run({ glob: "wiki/*" })) as { paths: string[] };
    expect(r.paths.sort()).toEqual(["wiki/달리기.md", "wiki/무릎 통증.md"]);
  });
});

describe("globToRe", () => {
  // Windows 는 ? 를 파일명에 못 써서 list_notes 로는 재현할 수 없다 — 함수를 직접 잰다.
  it("? 를 리터럴로 이스케이프한다 — 정규식 메타문자로 새지 않는다", () => {
    const re = globToRe("wiki/무엇?.md");
    expect(re.test("wiki/무엇?.md")).toBe(true);
    // 이스케이프가 안 됐다면 ? 가 "앞 문자 0~1회" 로 풀려 이것도 통과했을 것이다.
    expect(re.test("wiki/무엇.md")).toBe(false);
  });

  it("* 는 와일드카드로 그대로 남긴다", () => {
    const re = globToRe("wiki/*");
    expect(re.test("wiki/달리기.md")).toBe(true);
    expect(re.test("wiki/폴더/달리기.md")).toBe(false);
  });
});
