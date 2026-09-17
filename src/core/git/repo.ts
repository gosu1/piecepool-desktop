import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import git from "isomorphic-git";
import type { Author, NotePath, Vault } from "../../shared/types.ts";

/** isomorphic-git 호출마다 넘기는 공통 인자. 사용자 PC 에 git 이 없어도 된다. */
export function repo(v: Vault): { fs: typeof fs; dir: string } {
  return { fs, dir: v.root };
}

/** 파생 캐시는 커밋하지 않는다 (상위 §4.2). 볼트 루트의 .gitignore 는 사용자 것이라 건드리지 않는다. */
const GITIGNORE: NotePath = ".piecepool/.gitignore";
const INDEX_JSON: NotePath = ".piecepool/index.json";

/**
 * 저장소를 준비한다. 볼트를 열 때가 아니라 **에이전트가 처음 쓸 때** 부른다 —
 * 구경하려고 연 폴더에 .git 을 남기지 않는다 (09-14 실제 볼트 설계 §2.1).
 *
 * 돌려주는 것은 아직 커밋에 안 들어간 우리 파일(.gitignore)이다. 툴이 아니라 여기서 쓰므로
 * Written 에 안 들어온다 — 호출부가 다음 커밋의 경로에 합친다.
 */
export async function ensureRepo(v: Vault): Promise<NotePath[]> {
  if (!fs.existsSync(join(v.root, ".git"))) {
    await git.init({ ...repo(v), defaultBranch: "main" });
  }

  const ignoreAbs = join(v.root, GITIGNORE);
  let ignore = "";
  try {
    ignore = await readFile(ignoreAbs, "utf8");
  } catch {
    // 없으면 새로 쓴다
  }
  if (!ignore.split(/\r?\n/).includes("index.json")) {
    await mkdir(dirname(ignoreAbs), { recursive: true });
    const sep = ignore === "" || ignore.endsWith("\n") ? "" : "\n";
    await writeFile(ignoreAbs, `${ignore}${sep}index.json\n`, "utf8");
  }

  // 이미 추적 중인 index.json 은 .gitignore 가 걸러내지 못한다 — 인덱스에서만 뺀다.
  // 파일은 지우지 않는다 (git rm --cached 상당).
  const tracked = await git.listFiles(repo(v));
  if (tracked.includes(INDEX_JSON)) {
    await git.remove({ ...repo(v), filepath: INDEX_JSON });
  }
  return tracked.includes(GITIGNORE) ? [] : [GITIGNORE];
}

/** 볼트의 git config 신원. 없으면 null — 봉인 커밋을 만들 수 없다는 뜻이다. */
export async function readIdentity(v: Vault): Promise<Author | null> {
  if (!fs.existsSync(join(v.root, ".git"))) return null;
  const name = await git.getConfig({ ...repo(v), path: "user.name" });
  if (!name) return null;
  const email = (await git.getConfig({ ...repo(v), path: "user.email" })) ?? "";
  return { name, email };
}

/** 볼트의 git 신원을 쓴다. 저장소가 없으면 만든다 — 신원을 적는 것은 정리를 시작하겠다는 뜻이다. */
export async function writeIdentity(v: Vault, a: Author): Promise<void> {
  await ensureRepo(v);
  await git.setConfig({ ...repo(v), path: "user.name", value: a.name });
  await git.setConfig({ ...repo(v), path: "user.email", value: a.email });
}

/** 워킹트리와 HEAD 가 다른 경로. 무시된 파일(index.json)은 빠진다. */
export async function dirtyPaths(v: Vault): Promise<NotePath[]> {
  const rows = await git.statusMatrix(repo(v));
  return rows
    .filter(([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1))
    .map(([p]) => p);
}

export async function hasUncommittedChanges(v: Vault): Promise<boolean> {
  return (await dirtyPaths(v)).length > 0;
}
