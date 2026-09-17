// 엔진을 끝까지 관통한다 — 가짜 AI 로 API 없이. 임시 폴더에 진짜 볼트와 진짜 .git 을 만든다.
import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import git from "isomorphic-git";
import type { Vault } from "../../shared/types.ts";
import { repo } from "../git/repo.ts";
import { planRestore, restorePaths } from "../git/restore.ts";
import type { LlmPage } from "../llm/chat.ts";
import type { Llm } from "./engine.ts";
import { ingestSource, syncVault } from "./sync.ts";

async function tempVault(): Promise<Vault> {
  const root = await mkdtemp(join(tmpdir(), "pp-engine-"));
  return { root, agentWriteRoots: ["wiki", "sources", ".piecepool"] };
}

async function write(root: string, p: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, p)), { recursive: true });
  await writeFile(join(root, p), text, "utf8");
}

const read = (root: string, p: string) => readFile(join(root, p), "utf8");
const exists = (root: string, p: string) =>
  stat(join(root, p)).then(
    () => true,
    () => false,
  );

const NOTE = "오늘 처음 달리기를 했다. 무릎이 조금 아팠다.";

/** 자료에 있는 문장을 인용하는 페이지 한 장을 내는 가짜 AI. 호출 횟수를 센다. */
function fakeLlm(pages: LlmPage[] = []): Llm & { calls: number } {
  const llm = {
    calls: 0,
    async writeWiki() {
      llm.calls++;
      return {
        pages: pages.length
          ? pages
          : [
              {
                name: "달리기",
                aliases_to_add: [],
                summary: "아침에 시작한 운동",
                new_sections: [{ heading: "경험", content: "첫날부터 무릎이 아팠다." }],
                replace_sections: [],
                new_records: [{ fact: "처음 달리기를 했다", quote: "오늘 처음 달리기를 했다" }],
              },
            ],
      };
    },
    async askJson<T>() {
      return { value: { summary: "달리기를 시작한 사람" } as T };
    },
  };
  return llm;
}

describe("ingest.run — 볼트 노트 한 장", () => {
  it("위키 페이지·나 허브·상태를 쓰고 그 경로만 커밋 하나에 담는다", async () => {
    const v = await tempVault();
    await write(v.root, "일기/2026-10-08.md", NOTE);
    await git.init({ ...repo(v) });
    await git.setConfig({ ...repo(v), path: "user.name", value: "세훈" });
    const llm = fakeLlm();
    const steps: string[] = [];

    const r = await ingestSource(
      v,
      { kind: "file", path: join(v.root, "일기/2026-10-08.md") },
      { onProgress: (p) => steps.push(p.step), llm },
    );

    expect(llm.calls).toBe(1);
    expect(r.commitOid).toMatch(/^[0-9a-f]{40}$/);
    expect(r.written.sort()).toEqual(
      [
        ".piecepool/.gitignore",
        ".piecepool/sync_state.json",
        "wiki/나.md",
        "wiki/달리기.md",
      ].sort(),
    );
    const page = await read(v.root, "wiki/달리기.md");
    expect(page).toContain("# 달리기\n\n> 아침에 시작한 운동");
    expect(page).toContain("- 2026-10-08 처음 달리기를 했다 ← [[2026-10-08]]");
    expect(page).toMatch(
      /hashes:\n {2}요약: [0-9a-f]{8}\n {2}경험: [0-9a-f]{8}\n {2}기록: [0-9a-f]{8}/,
    );
    // 사용자 노트는 봉인 커밋(사용자 명의)에, 위키는 에이전트 커밋에 — 섞이지 않는다.
    const log = await git.log({ ...repo(v) });
    expect(log.map((e) => e.commit.author.name)).toEqual(["PiecePool Agent", "세훈"]);
    expect(steps).toContain("봉인");
    expect(steps).toContain("커밋");
  });

  it("같은 노트를 다시 넣으면 AI 를 부르지 않고 커밋도 없다", async () => {
    const v = await tempVault();
    await write(v.root, "일기/2026-10-08.md", NOTE);
    await git.init({ ...repo(v) });
    await git.setConfig({ ...repo(v), path: "user.name", value: "세훈" });
    const llm = fakeLlm();
    const src = { kind: "file" as const, path: join(v.root, "일기/2026-10-08.md") };
    await ingestSource(v, src, { llm });
    const again = await ingestSource(v, src, { llm });
    expect(llm.calls).toBe(1);
    expect(again).toEqual({ written: [], commitOid: "" });
  });

  it("미커밋 변경이 있는데 git 신원이 없으면 시작하지 않는다", async () => {
    const v = await tempVault();
    await write(v.root, "일기/2026-10-08.md", NOTE);
    const llm = fakeLlm();
    await expect(
      ingestSource(v, { kind: "file", path: join(v.root, "일기/2026-10-08.md") }, { llm }),
    ).rejects.toMatchObject({ kind: "git_failed" });
    expect(llm.calls).toBe(0);
    expect(await exists(v.root, "wiki")).toBe(false);
  });
});

describe("ingest.run — 볼트 밖 파일과 세션", () => {
  it("볼트 밖 .md 는 sources/ 로 복사되고 출처 페이지가 생기며 기록이 @출처를 가리킨다", async () => {
    const v = await tempVault();
    await git.init({ ...repo(v) });
    const outside = join(await mkdtemp(join(tmpdir(), "pp-outside-")), "메모.md");
    await writeFile(outside, NOTE, "utf8");

    const r = await ingestSource(v, { kind: "file", path: outside }, { llm: fakeLlm() });

    expect(r.written).toContain("sources/메모.md");
    expect(r.written).toContain("sources/@메모.md");
    expect(await read(v.root, "sources/@메모.md")).toMatch(
      /^---\ntype: source\nraw: "\[\[sources\/메모.md\]\]"\nraw_hash: [0-9a-f]{8}\n/,
    );
    expect(await read(v.root, "wiki/달리기.md")).toContain("← [[@메모]]");
  });

  it("세션 로그는 @session 출처 페이지가 되고 AI 턴의 기록에는 (AI) 가 붙는다", async () => {
    const v = await tempVault();
    await git.init({ ...repo(v) });
    const log =
      "## 1턴 (사용자)\n\n무릎이 아픈데 계속 뛰어도 될까?\n\n## 2턴 (AI)\n\n주당 10% 이상 늘리지 않는 것이 통설입니다.";
    // 수확(B)이 세션 로그를 먼저 쓰고 extraPaths 로 넘긴다 — 같은 커밋에 들어가야 한다.
    await write(v.root, ".piecepool/sessions/s1.md", log);
    const llm = fakeLlm([
      {
        name: "달리기",
        aliases_to_add: [],
        summary: "s",
        new_sections: [],
        replace_sections: [],
        new_records: [
          {
            fact: "주당 10% 이상 늘리지 않는다",
            quote: "주당 10% 이상 늘리지 않는 것이 통설입니다",
          },
          { fact: "무릎이 아픈데 계속 뛸지 물었다", quote: "무릎이 아픈데 계속 뛰어도 될까" },
        ],
      },
    ]);

    const r = await ingestSource(
      v,
      { kind: "session", id: "s1", log },
      { llm, extraPaths: [".piecepool/sessions/s1.md"] },
    );

    expect(r.written).toContain(".piecepool/sessions/s1.md");
    expect(r.written).toContain("sources/@session-s1.md");
    const page = await read(v.root, "wiki/달리기.md");
    expect(page).toContain("← [[@session-s1#2턴 (AI)]] (AI)");
    expect(page).toContain("← [[@session-s1#1턴 (사용자)]]\n");
    expect(await git.listFiles({ ...repo(v), ref: "HEAD" })).toContain(".piecepool/sessions/s1.md");
  });
});

describe("되돌리기와 다시 정리", () => {
  it("정리 커밋을 되돌리면 상태도 함께 돌아가 다음 실행이 그 노트를 다시 정리한다", async () => {
    const v = await tempVault();
    await write(v.root, "일기/2026-10-08.md", NOTE);
    await git.init({ ...repo(v) });
    await git.setConfig({ ...repo(v), path: "user.name", value: "세훈" });
    const llm = fakeLlm();
    const src = { kind: "file" as const, path: join(v.root, "일기/2026-10-08.md") };

    const first = await ingestSource(v, src, { llm });
    const plan = await planRestore(v, first.commitOid);
    expect(plan.paths.every((p) => !p.changedSince)).toBe(true);
    await restorePaths(
      v,
      first.commitOid,
      plan.paths.map((p) => p.path),
    );
    expect(await exists(v.root, "wiki/달리기.md")).toBe(false);

    const second = await ingestSource(v, src, { llm });
    expect(llm.calls).toBe(2);
    expect(second.commitOid).not.toBe("");
    expect(await exists(v.root, "wiki/달리기.md")).toBe(true);
  });

  it("syncVault 는 안 한 항목만 날짜순으로 처리하고 항목마다 커밋 하나를 만든다", async () => {
    const v = await tempVault();
    await write(v.root, "일기/2026-10-09.md", "둘째 날. 오늘 처음 달리기를 했다.");
    await write(v.root, "일기/2026-10-08.md", NOTE);
    await git.init({ ...repo(v) });
    await git.setConfig({ ...repo(v), path: "user.name", value: "세훈" });
    const llm = fakeLlm();

    const r = await syncVault(v, { llm });
    expect(llm.calls).toBe(2);
    expect(r.commits).toHaveLength(2);
    expect(r.halted).toBe(false);
    const messages = (await git.log({ ...repo(v) })).map((e) => e.commit.message.trim());
    expect(messages).toEqual([
      "ingest(vault): 2026-10-09",
      "ingest(vault): 2026-10-08",
      "chore(vault): 사용자 편집 봉인",
    ]);

    const again = await syncVault(v, { llm });
    expect(llm.calls).toBe(2);
    expect(again.commits).toHaveLength(0);
  });
});
