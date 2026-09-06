import type { LinkRef, NotePath } from "../../shared/types.ts";

/**
 * 링크 해석 대상. 제목 맵과 파일 목록을 **따로** 둔다.
 *
 * 하나로 합치면 키 공간이 충돌한다 — titles 에 "sources/files/x.pdf" 를 섞는 순간
 * 제목이 그 문자열인 노트와 구분할 수 없다.
 */
export interface LinkTargets {
  /** normalizeTitle 을 거친 제목 -> 노트 */
  titles: Map<string, NotePath>;
  /** 볼트 안의 모든 파일 경로(.md 포함). ![[sources/files/x.pdf]] 해석용 */
  files: Set<NotePath>;
}

/**
 * 제목 정규화. 맵을 만드는 쪽(scan.ts)과 조회하는 쪽(resolveLink)이
 * 반드시 같은 함수를 써야 한다 — 다르면 전 볼트가 깨진 링크가 되는데
 * 타입은 아무것도 잡아주지 못한다.
 *
 * 구 레포 PIE-64: "교착상태" 와 "교착 상태" 로 위키가 두 장 생겼다.
 */
export function normalizeTitle(t: string): string {
  throw new Error("unimplemented: core/index/links.normalizeTitle");
}

/**
 * 옵시디언 규칙 그대로다.
 *   [[제목]] · [[제목|표시]] · ![[sources/files/x.pdf]] · ![[...#page=N]]
 * N 은 1-indexed 정수다. 타입은 없다 — 관계의 의미론은 링크 주변 산문이 담는다.
 *
 * to 는 fragment 를 뺀 이름이고, #page=N 은 page 로 분리한다.
 * [[노트#소제목]] · [[노트#^blockid]] 는 §6.1 범위 밖이라 fragment 를 버린다.
 *
 * 주의: 코드 펜스와 인라인 코드 안의 [[예시]] 는 링크가 아니다.
 * 구 레포는 remark mdast 의 text 노드 위에서만 돌아 이게 공짜였는데,
 * 여기는 raw 문자열을 받으므로 직접 걸러야 한다. 놓치면 마크다운 문법을
 * 설명하는 위키 페이지마다 유령 깨진 링크가 lint 에 영구히 남는다.
 */
export function parseLinks(from: NotePath, body: string): LinkRef[] {
  throw new Error("unimplemented: core/index/links.parseLinks");
}

/**
 * 제목·파일명으로 해석한다. 실패하면 null — 깨진 링크다.
 *
 * from 을 받는 이유: 옵시디언은 동명 노트가 있을 때 링크가 놓인 노트에
 * 가까운 후보를 우선한다. from 이 없으면 그 규칙도 상대경로도 구현할 수 없다.
 * 모호성 자체를 사용자에게 보고하는 것은 lint 규칙의 몫이다.
 */
export function resolveLink(from: NotePath, to: string, t: LinkTargets): NotePath | null {
  throw new Error("unimplemented: core/index/links.resolveLink");
}

export function backlinksOf(p: NotePath, all: LinkRef[]): NotePath[] {
  throw new Error("unimplemented: core/index/links.backlinksOf");
}
