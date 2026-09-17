// 근거 대조 — 답변의 [[페이지#절]] 이 이번 세션에서 실제로 연 절인지 본다.
//
// 이것은 증명이 아니라 필터다. 코드가 아는 것은 "그 절을 열었는가" 뿐이고,
// "그 문장이 그 절에서 나왔는가" 는 모른다. 근거를 사칭한 문단은 사람이 본다
// (설계 §3.3 · §10.6).

/** 이번 세션에서 실제로 본 것. `path#heading` 또는 전문을 연 `path`. */
export type Opened = Set<string>;

/**
 * `index/links.ts` 의 `parseLinks` 를 쓸 수 없다 — 그쪽은 `#page=N` 만 남기고
 * 헤딩 fragment 를 버린다. `LinkRef` 는 shared 의 FROZEN 이라 필드를 더하려면
 * 합의가 필요하므로, fragment 만 여기서 따로 읽는다.
 */
const LINK = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]*))?\]\]/g;

export function checkCitations(
  answer: string,
  opened: Opened,
  resolve: (name: string) => string | null,
): { text: string; unsourced: number; dropped: string[] } {
  const dropped: string[] = [];

  const text = answer.replace(LINK, (whole, rawName: string, rawHeading?: string) => {
    const name = rawName.trim();
    const heading = rawHeading?.trim();
    const path = resolve(name);
    const ok =
      path !== null &&
      (opened.has(path) || (heading !== undefined && opened.has(`${path}#${heading}`)));
    if (ok) return whole;
    dropped.push(heading === undefined ? name : `${name}#${heading}`);
    // 링크만 벗기고 글자는 남긴다 — 정보를 잃지 않는다.
    return heading === undefined ? name : `${name}#${heading}`;
  });

  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim() !== "");
  const unsourced = paragraphs.filter((p) => !/\[\[[^\]]+\]\]/.test(p)).length;

  return { text, unsourced, dropped };
}
