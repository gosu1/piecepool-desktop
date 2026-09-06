import type { LinkRef, NotePath } from "../../shared/types.ts";

/**
 * 옵시디언 규칙 그대로다.
 *   [[제목]] · [[제목|표시]] · ![[sources/files/x.pdf]] · ![[...#page=N]]
 * N 은 1-indexed 정수다. 타입은 없다 — 관계의 의미론은 링크 주변 산문이 담는다.
 */
export function parseLinks(from: NotePath, body: string): LinkRef[] {
  throw new Error("unimplemented: core/index/links.parseLinks");
}

/** 제목 또는 파일명으로 볼트 안에서 해석한다. 실패하면 null — 깨진 링크다. */
export function resolveLink(to: string, titles: Map<string, NotePath>): NotePath | null {
  throw new Error("unimplemented: core/index/links.resolveLink");
}

export function backlinksOf(p: NotePath, all: LinkRef[]): NotePath[] {
  throw new Error("unimplemented: core/index/links.backlinksOf");
}
