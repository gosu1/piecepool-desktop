import type { Author, Vault } from "../../shared/types.ts";

/** isomorphic-git 을 쓴다 — 사용자 PC 에 git 이 없어도 된다. */
export async function ensureRepo(v: Vault): Promise<void> {
  throw new Error("unimplemented: core/git/repo.ensureRepo");
}

/** 볼트의 git config 신원. 없으면 null — 봉인 커밋을 만들 수 없다는 뜻이다. */
export async function readIdentity(v: Vault): Promise<Author | null> {
  throw new Error("unimplemented: core/git/repo.readIdentity");
}

export async function hasUncommittedChanges(v: Vault): Promise<boolean> {
  throw new Error("unimplemented: core/git/repo.hasUncommittedChanges");
}
