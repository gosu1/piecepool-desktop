// 근거 대조 — 답변의 [[페이지#절]] 이 이번 세션에서 실제로 연 절인지 본다.
//
// 이것은 증명이 아니라 필터다. 코드가 아는 것은 "그 절을 열었는가" 뿐이고,
// "그 문장이 그 절에서 나왔는가" 는 모른다. 근거를 사칭한 문단은 사람이 본다
// (설계 §3.3 · §10.6).

import { blankCode } from "../index/links.ts";

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

  // 코드 펜스/인라인 코드를 지운 판 위에서 링크를 찾는다 — 그 안의 [[...]] 는
  // 근거가 아니라 문법을 설명하는 예시일 수 있다(쿼리 프롬프트가 AI 에게
  // [[페이지#절]] 문법 자체를 가르치므로 실제로 이런 답이 나온다).
  // blankCode 는 길이를 유지하므로 매치 위치가 원문과 그대로 대응한다.
  const blanked = blankCode(answer);

  let text = ""; // 반환용 — 코드 내용은 원문 그대로 살린다
  let last = 0;

  for (const m of blanked.matchAll(LINK)) {
    const whole = m[0];
    const rawName = m[1];
    const rawHeading = m[2] as string | undefined;
    const start = m.index;
    const end = start + whole.length;

    // 코드가 아닌 구간은 원문과 blanked 가 글자 하나까지 같으므로 그대로 옮긴다.
    text += answer.slice(last, start);

    const name = rawName.trim();
    const heading = rawHeading?.trim();
    const path = resolve(name);
    const ok =
      path !== null &&
      (opened.has(path) || (heading !== undefined && opened.has(`${path}#${heading}`)));
    // 링크만 벗기고 글자는 남긴다 — 정보를 잃지 않는다.
    const replaced = heading === undefined ? name : `${name}#${heading}`;

    text += ok ? whole : replaced;
    if (!ok) dropped.push(replaced);

    last = end;
  }
  text += answer.slice(last);

  // 문단 경계는 answer(원문) 기준 오프셋으로 찾는다 — text 기준으로 가르면 안
  // 된다. 뗀 링크는 대괄호가 빠지며 text 를 answer 보다 짧게 만들어, text 의
  // 오프셋이 blanked(= answer 와 길이가 같다) 의 오프셋과 어긋난다.
  // 빈 줄(문단 경계) 자체는 코드 펜스 안에서도 항상 빈 채로 남으므로
  // answer 와 blanked 어느 쪽에서 찾아도 위치가 같다.
  //
  // 문단마다 blankCode 를 다시 태우지 않고, 이미 문서 전체를 한 번에 비운
  // blanked 에서 같은 구간만 잘라 쓴다 — 펜스 상태를 문서 전체 기준으로 한
  // 번만 판정해야, 펜스가 문단 경계(빈 줄)를 가로질러 걸쳐도 조각마다 상태가
  // 끊기지 않는다.
  //
  // unsourced 는 검증(LINK)과 같은 정규식으로 센다 — 느슨한 정규식을 따로 쓰면
  // [[#가짜]] 처럼 이름이 빈 링크가 검증은 건너뛰면서 집계에서는 "근거 있음"
  // 으로 잡혀 샌다.
  // match() 는 전역(g) 정규식이라도 호출마다 lastIndex 를 0 으로 되돌리고
  // 시작한다 — test()/exec() 로 문단마다 이어 쓰면 이전 위치를 물고 가 상태가 샌다.
  const isUnsourced = (from: number, to: number): boolean =>
    answer.slice(from, to).trim() !== "" && blanked.slice(from, to).match(LINK) === null;

  let unsourced = 0;
  let pStart = 0;
  for (const bm of answer.matchAll(/\n\s*\n/g)) {
    if (isUnsourced(pStart, bm.index)) unsourced++;
    pStart = bm.index + bm[0].length;
  }
  if (isUnsourced(pStart, answer.length)) unsourced++;

  return { text, unsourced, dropped };
}
