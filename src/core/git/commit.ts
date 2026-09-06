import type { Author, NotePath, Vault } from "../../shared/types.ts";

/**
 * 넘겨받은 경로만 add 하고 커밋한다.
 *
 * "변경된 .md 전부 add" 는 쓸 수 없다 — 볼트는 앱 전용이 아니고, 사용자가
 * 옵시디언으로 편집한 것이 에이전트 커밋에 딸려 들어가면 되돌리기가
 * 사용자 작업을 함께 삼킨다.
 *
 * 경로 배열을 그대로 받는 이유: 세션 로그와 .gitignore 는 에이전트 툴이 아니라
 * 호출부가 쓰므로 Written 에 자동으로 들어오지 않는다. 합집합은 호출부가 만든다.
 */
export async function commit(
  v: Vault,
  paths: NotePath[],
  author: Author,
  message: string,
): Promise<string> {
  throw new Error("unimplemented: core/git/commit.commit");
}

/**
 * 사용자의 미커밋 변경을 별도 커밋으로 분리한다.
 * 작성자는 볼트의 git config 를 따른다 — 사용자가 쓴 것을 에이전트 명의로
 * 남기면 자기 볼트 이력에서 자기 작업이 남의 것으로 보인다.
 */
export async function sealUserEdits(v: Vault, author: Author): Promise<string | null> {
  throw new Error("unimplemented: core/git/commit.sealUserEdits");
}
