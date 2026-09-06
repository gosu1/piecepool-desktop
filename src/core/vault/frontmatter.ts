import type { Fm } from "../../shared/types.ts";

export function parse(raw: string): { fm: Fm; body: string } {
  throw new Error("unimplemented: core/vault/frontmatter.parse");
}

export function stringify(fm: Fm, body: string): string {
  throw new Error("unimplemented: core/vault/frontmatter.stringify");
}

/**
 * sources 는 append-only 다. 중복은 제거하고 덧붙이기만 한다.
 *
 * setSources 를 일부러 만들지 않는다 — 덮어쓸 수 있으면 쿼리 세션이 남긴
 * 출처가 다음 인제스트에서 조용히 사라진다. 타입으로는 못 막으므로
 * 덮어쓰는 함수를 아예 두지 않는 것으로 막는다.
 */
export function addSource(fm: Fm, source: string): Fm {
  throw new Error("unimplemented: core/vault/frontmatter.addSource");
}
