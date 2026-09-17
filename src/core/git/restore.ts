// OWNER: A — 3단계에서 확정: 계획 반환 → 사용자가 고름 → 적용 (2단계).
// 콜백은 IPC 를 건널 수 없다 (ADR-0005).
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import git from "isomorphic-git";
import { AGENT_AUTHOR, type NotePath, type Vault } from "../../shared/types.ts";
import { PiecePoolError } from "../errors.ts";
import { commit } from "./commit.ts";
import { repo } from "./repo.ts";

export interface RestorePlan {
  commitOid: string;
  message: string;
  paths: RestorePath[];
}

export interface RestorePath {
  path: NotePath;
  /** 그 커밋 뒤 사용자가 손댔다. 되돌리면 그 수정도 사라지므로 사용자가 골라야 한다. */
  changedSince: boolean;
}

/** 되돌리기 계획. 커밋이 건드린 경로마다 그 뒤 변경 여부를 붙인다. */
export async function planRestore(v: Vault, commitOid: string): Promise<RestorePlan> {
  const { commit: c } = await git.readCommit({ ...repo(v), oid: commitOid });
  const touched = await touchedPaths(v, commitOid, c.parent[0]);
  const paths: RestorePath[] = [];
  for (const [path, atCommit] of touched) {
    paths.push({ path, changedSince: (await workdirOid(v, path)) !== atCommit });
  }
  return { commitOid, message: c.message.trim(), paths };
}

/**
 * 되돌리기. 자동 병합을 시도하지 않고 경로별로 복원한다.
 * 호출부가 planRestore 로 보여 주고 사용자가 고른 경로만 넘긴다.
 * 부분 복원 결과는 그 자체가 새 커밋이 된다 — 이력을 다시 쓰지 않는다.
 */
export async function restorePaths(
  v: Vault,
  commitOid: string,
  paths: NotePath[],
): Promise<string> {
  const { commit: c } = await git.readCommit({ ...repo(v), oid: commitOid });
  const parent = c.parent[0];
  const touched = await touchedPaths(v, commitOid, parent);
  for (const p of paths) {
    if (!touched.has(p)) {
      throw new PiecePoolError("git_failed", `그 커밋이 건드린 경로가 아니다: ${p}`);
    }
  }
  for (const p of paths) {
    const before = parent === undefined ? null : await blobAt(v, parent, p);
    const abs = join(v.root, p);
    if (before === null) {
      await rm(abs, { force: true });
    } else {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, before);
    }
  }
  const title = c.message.trim().split("\n")[0];
  return await commit(v, paths, AGENT_AUTHOR, `revert(vault): ${title}`);
}

/** 커밋이 부모 대비 바꾼 경로 → 커밋 시점의 blob oid (지웠으면 null). */
async function touchedPaths(
  v: Vault,
  commitOid: string,
  parent: string | undefined,
): Promise<Map<NotePath, string | null>> {
  const trees = [git.TREE({ ref: commitOid })];
  if (parent !== undefined) trees.push(git.TREE({ ref: parent }));
  const rows: [NotePath, string | null][] = await git.walk({
    ...repo(v),
    trees,
    map: async (filepath, [a, b]) => {
      if (filepath === ".") return undefined;
      if ((await a?.type()) === "tree" || (await b?.type()) === "tree") return undefined;
      const after = (await a?.oid()) ?? null;
      const before = (await b?.oid()) ?? null;
      return after === before ? undefined : [filepath, after];
    },
  });
  return new Map(rows);
}

async function blobAt(v: Vault, ref: string, filepath: NotePath): Promise<Uint8Array | null> {
  try {
    return (await git.readBlob({ ...repo(v), oid: ref, filepath })).blob;
  } catch {
    return null;
  }
}

async function workdirOid(v: Vault, filepath: NotePath): Promise<string | null> {
  let object: Buffer;
  try {
    object = await readFile(join(v.root, filepath));
  } catch {
    return null;
  }
  return (await git.hashBlob({ object })).oid;
}
