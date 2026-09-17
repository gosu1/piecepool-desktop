// 임시 폴더에 볼트를 만들어 실제 .git 을 읽고 쓴다 (상위 §10 통합 테스트).
// 이 저장소의 git 이 아니다.
import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import git from "isomorphic-git";
import { AGENT_AUTHOR, type Vault } from "../../shared/types.ts";
import { PiecePoolError } from "../errors.ts";
import { commit, sealUserEdits } from "./commit.ts";
import { ensureRepo, hasUncommittedChanges, readIdentity, repo } from "./repo.ts";
import { planRestore, restorePaths } from "./restore.ts";

const USER = { name: "세훈", email: "me@example.com" };

async function tempVault(): Promise<Vault> {
  const root = await mkdtemp(join(tmpdir(), "pp-git-"));
  return { root, agentWriteRoots: ["wiki", "sources", ".piecepool"] };
}

async function write(v: Vault, p: string, text: string): Promise<void> {
  const abs = join(v.root, p);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, text, "utf8");
}

async function read(v: Vault, p: string): Promise<string> {
  return await readFile(join(v.root, p), "utf8");
}

async function exists(v: Vault, p: string): Promise<boolean> {
  return await stat(join(v.root, p)).then(
    () => true,
    () => false,
  );
}

async function filesAtHead(v: Vault): Promise<string[]> {
  return await git.listFiles({ ...repo(v), ref: "HEAD" });
}

describe("ensureRepo", () => {
  it("없으면 init 하고 .piecepool/.gitignore 를 쓴다. 두 번째는 아무것도 안 쓴다", async () => {
    const v = await tempVault();
    expect(await ensureRepo(v)).toEqual([".piecepool/.gitignore"]);
    expect(await exists(v, ".git")).toBe(true);
    expect(await read(v, ".piecepool/.gitignore")).toBe("index.json\n");
    expect(await ensureRepo(v)).toEqual([]);
  });

  it("이미 있는 .git 과 .gitignore 는 그대로 쓰고 줄만 보탠다", async () => {
    const v = await tempVault();
    await git.init({ ...repo(v) });
    await write(v, ".piecepool/.gitignore", "cache/");
    expect(await ensureRepo(v)).toEqual([".piecepool/.gitignore"]);
    expect(await read(v, ".piecepool/.gitignore")).toBe("cache/\nindex.json\n");
  });

  it("이미 추적 중인 index.json 은 인덱스에서만 뺀다 — 파일은 남는다", async () => {
    const v = await tempVault();
    await git.init({ ...repo(v) });
    await write(v, ".piecepool/index.json", "{}");
    await git.add({ ...repo(v), filepath: ".piecepool/index.json" });
    await git.commit({ ...repo(v), message: "예전 버전이 커밋함", author: USER });

    await ensureRepo(v);
    expect(await git.listFiles(repo(v))).not.toContain(".piecepool/index.json");
    expect(await exists(v, ".piecepool/index.json")).toBe(true);
    // 무시 목록에 들어갔으니 미커밋 변경으로 잡히지 않는다
    await commit(v, [".piecepool/.gitignore", ".piecepool/index.json"], AGENT_AUTHOR, "정리");
    expect(await hasUncommittedChanges(v)).toBe(false);
  });
});

describe("readIdentity · hasUncommittedChanges", () => {
  it("신원이 없으면 null, 있으면 config 값이다", async () => {
    const v = await tempVault();
    expect(await readIdentity(v)).toBeNull();
    await ensureRepo(v);
    expect(await readIdentity(v)).toBeNull();
    await git.setConfig({ ...repo(v), path: "user.name", value: USER.name });
    await git.setConfig({ ...repo(v), path: "user.email", value: USER.email });
    expect(await readIdentity(v)).toEqual(USER);
  });

  it("추적 안 된 파일도 미커밋 변경이다. index.json 은 아니다", async () => {
    const v = await tempVault();
    await ensureRepo(v);
    await write(v, ".piecepool/index.json", "{}");
    await commit(v, [".piecepool/.gitignore"], AGENT_AUTHOR, "첫 커밋");
    expect(await hasUncommittedChanges(v)).toBe(false);
    await write(v, "노트.md", "옵시디언에서 씀");
    expect(await hasUncommittedChanges(v)).toBe(true);
  });
});

describe("sealUserEdits", () => {
  it("깨끗하면 null", async () => {
    const v = await tempVault();
    await ensureRepo(v);
    await commit(v, [".piecepool/.gitignore"], AGENT_AUTHOR, "첫 커밋");
    expect(await sealUserEdits(v, USER)).toBeNull();
  });

  it("사용자 변경 전부를 사용자 명의 커밋 하나로 분리한다", async () => {
    const v = await tempVault();
    await ensureRepo(v);
    await write(v, "노트.md", "새 노트");
    await write(v, "wiki/데미안.md", "사용자가 만든 페이지");
    const oid = await sealUserEdits(v, USER);
    expect(oid).not.toBeNull();
    const { commit: c } = await git.readCommit({ ...repo(v), oid: oid! });
    expect(c.author.name).toBe(USER.name);
    expect(c.message).toContain("사용자 편집 봉인");
    expect((await filesAtHead(v)).sort()).toEqual(
      [".piecepool/.gitignore", "wiki/데미안.md", "노트.md"].sort(),
    );
    expect(await hasUncommittedChanges(v)).toBe(false);
  });
});

describe("commit", () => {
  it("넘긴 경로만 담는다 — 사용자의 미커밋 파일은 딸려 들어가지 않는다", async () => {
    const v = await tempVault();
    await ensureRepo(v);
    await write(v, "노트.md", "사용자 것");
    await write(v, "wiki/개념.md", "에이전트 것");
    const oid = await commit(
      v,
      ["wiki/개념.md", ".piecepool/.gitignore"],
      AGENT_AUTHOR,
      "자료 1건 반영",
    );
    const { commit: c } = await git.readCommit({ ...repo(v), oid });
    expect(c.author).toMatchObject(AGENT_AUTHOR);
    expect((await filesAtHead(v)).sort()).toEqual([".piecepool/.gitignore", "wiki/개념.md"]);
  });

  it("지운 파일도 커밋에 담긴다", async () => {
    const v = await tempVault();
    await ensureRepo(v);
    await write(v, "inbox/단편.md", "메모");
    await commit(v, ["inbox/단편.md"], AGENT_AUTHOR, "넣음");
    await rm(join(v.root, "inbox/단편.md"));
    await commit(v, ["inbox/단편.md"], AGENT_AUTHOR, "편입 후 정리");
    expect(await filesAtHead(v)).toEqual([]);
  });

  it("경로가 없으면 git_failed", async () => {
    const v = await tempVault();
    await ensureRepo(v);
    await expect(commit(v, [], AGENT_AUTHOR, "빈 커밋")).rejects.toMatchObject({
      kind: "git_failed",
    });
  });
});

describe("되돌리기", () => {
  /** 봉인된 사용자 페이지 b 를 에이전트가 고치고 a 를 새로 만든 뒤, 사용자가 a 를 손댄 상태. */
  async function scenario(): Promise<{ v: Vault; agentOid: string }> {
    const v = await tempVault();
    await ensureRepo(v);
    await write(v, "wiki/b.md", "사용자 원문");
    await sealUserEdits(v, USER);

    await write(v, "wiki/a.md", "에이전트가 만든 페이지");
    await write(v, "wiki/b.md", "사용자 원문\n\n에이전트가 보탠 절");
    const agentOid = await commit(v, ["wiki/a.md", "wiki/b.md"], AGENT_AUTHOR, "자료 1건 반영");

    await write(v, "wiki/a.md", "에이전트가 만든 페이지\n\n사용자가 덧붙임");
    return { v, agentOid };
  }

  it("계획은 커밋이 건드린 경로와 그 뒤 변경 여부를 알린다", async () => {
    const { v, agentOid } = await scenario();
    const plan = await planRestore(v, agentOid);
    expect(plan.message).toBe("자료 1건 반영");
    expect(plan.paths.sort((x, y) => x.path.localeCompare(y.path))).toEqual([
      { path: "wiki/a.md", changedSince: true },
      { path: "wiki/b.md", changedSince: false },
    ]);
  });

  it("고른 경로만 되돌리고 사용자 편집은 살아남는다. 결과는 새 커밋이다", async () => {
    const { v, agentOid } = await scenario();
    const oid = await restorePaths(v, agentOid, ["wiki/b.md"]);
    expect(await read(v, "wiki/b.md")).toBe("사용자 원문");
    expect(await read(v, "wiki/a.md")).toBe("에이전트가 만든 페이지\n\n사용자가 덧붙임");
    const { commit: c } = await git.readCommit({ ...repo(v), oid });
    expect(c.message).toContain("revert(vault): 자료 1건 반영");
    expect(c.author).toMatchObject(AGENT_AUTHOR);
    expect(c.parent).toEqual([agentOid]);
  });

  it("커밋이 새로 만든 파일은 되돌리면 지워진다", async () => {
    const { v, agentOid } = await scenario();
    await restorePaths(v, agentOid, ["wiki/a.md"]);
    expect(await exists(v, "wiki/a.md")).toBe(false);
    expect(await filesAtHead(v)).not.toContain("wiki/a.md");
  });

  it("첫 커밋(부모 없음)도 되돌릴 수 있다", async () => {
    const v = await tempVault();
    await ensureRepo(v);
    await write(v, "wiki/a.md", "첫 페이지");
    const oid = await commit(v, ["wiki/a.md", ".piecepool/.gitignore"], AGENT_AUTHOR, "첫 커밋");
    const plan = await planRestore(v, oid);
    expect(plan.paths.map((p) => p.path).sort()).toEqual([".piecepool/.gitignore", "wiki/a.md"]);
    await restorePaths(v, oid, ["wiki/a.md"]);
    expect(await exists(v, "wiki/a.md")).toBe(false);
  });

  it("그 커밋이 건드리지 않은 경로는 거부한다 — 사용자 편집을 되돌리는 통로가 된다", async () => {
    const { v, agentOid } = await scenario();
    await write(v, "wiki/c.md", "사용자가 나중에 만든 페이지");
    await expect(restorePaths(v, agentOid, ["wiki/c.md"])).rejects.toBeInstanceOf(PiecePoolError);
    expect(await read(v, "wiki/c.md")).toBe("사용자가 나중에 만든 페이지");
  });
});
