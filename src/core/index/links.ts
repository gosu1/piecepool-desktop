// FROZEN: parseLinks 만 동결 (0단계 설계 §8, 상위 §6.1)
// LinkTargets · normalizeTitle · resolveLink 은 가배치 2단계.
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
  // NFC 를 먼저 태운다 — macOS 는 파일명을 NFD 로 저장하므로 안 하면
  // 같은 한글 제목이 플랫폼마다 다른 키가 된다.
  return t.normalize("NFC").trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * 코드 펜스와 인라인 코드를 **같은 길이의 공백**으로 지운다.
 * 길이를 유지하는 이유: 나중에 링크 위치(offset)가 필요해질 때 통째로 밀리지 않는다.
 */
function blankCode(body: string): string {
  const lines = body.split("\n");
  let fenceChar: string | null = null;
  let fenceLen = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^\s*(`{3,}|~{3,})/.exec(line);

    if (fenceChar === null) {
      if (m !== null) {
        fenceChar = m[1][0];
        fenceLen = m[1].length;
        lines[i] = " ".repeat(line.length);
        continue;
      }
      // 백틱 런의 길이가 같은 쌍만 인라인 코드다.
      lines[i] = line.replace(/(`+)[^\n]*?\1/g, (s) => " ".repeat(s.length));
      continue;
    }

    // 펜스 안이다. 닫으려면 같은 문자에 길이가 여는 쪽 이상이어야 한다 —
    // 백틱 넷으로 연 블록 안의 백틱 셋짜리 예제는 그 블록을 닫지 못한다(CommonMark).
    if (m !== null && m[1][0] === fenceChar && m[1].length >= fenceLen) fenceChar = null;
    lines[i] = " ".repeat(line.length);
  }

  return lines.join("\n");
}

/** `!` 여부 + `[[…]]` 안쪽. 대괄호와 줄바꿈은 안쪽에 들어올 수 없다. */
const LINK = /(!?)\[\[([^\]\n]+)\]\]/g;

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
  const refs: LinkRef[] = [];

  for (const m of blankCode(body).matchAll(LINK)) {
    const embed = m[1] === "!";

    // 별칭을 먼저 가른다 — 표시 텍스트에 # 가 있어도 fragment 로 오해하지 않는다.
    const bar = m[2].indexOf("|");
    const aliasRaw = bar === -1 ? "" : m[2].slice(bar + 1).trim();
    let to = (bar === -1 ? m[2] : m[2].slice(0, bar)).trim();

    let page: number | undefined;
    const hash = to.indexOf("#");
    if (hash !== -1) {
      const pm = /^page=(\d+)$/.exec(to.slice(hash + 1));
      if (pm !== null) page = Number(pm[1]);
      to = to.slice(0, hash).trim();
    }

    if (to === "") continue;

    refs.push({
      from,
      to,
      embed,
      ...(aliasRaw === "" ? {} : { alias: aliasRaw }),
      ...(page === undefined ? {} : { page }),
      resolved: null,
    });
  }

  return refs;
}

/**
 * 제목·파일명으로 해석한다. 실패하면 null — 깨진 링크다.
 *
 * from 을 받는 이유: 옵시디언은 동명 노트가 있을 때 링크가 놓인 노트에
 * 가까운 후보를 우선한다. from 이 없으면 그 규칙도 상대경로도 구현할 수 없다.
 * 모호성 자체를 사용자에게 보고하는 것은 lint 규칙의 몫이다.
 *
 * 지금은 `from` 을 쓰지 않는다. 동명 노트는 맵에 먼저 들어온 것이 이기고,
 * 모호성 보고는 lint 규칙의 몫이다 (2026-09-16 그래프 뷰 설계 §4.3).
 */
export function resolveLink(from: NotePath, to: string, t: LinkTargets): NotePath | null {
  return t.titles.get(normalizeTitle(to)) ?? (t.files.has(to) ? to : null);
}

/**
 * `p` 를 가리키는 노트들. 깨진 링크(resolved === null)와 자기 링크(from === resolved)를
 * 빼는 규칙은 scan.ts 의 toGraph 와 같다 — 그래프 엣지와 backlink 목록이 같은 것을
 * 다른 모양으로 보여주는 것이므로 기준이 갈리면 안 된다.
 */
export function backlinksOf(p: NotePath, all: LinkRef[]): NotePath[] {
  const from = new Set<NotePath>();
  for (const l of all) {
    if (l.resolved !== p || l.from === p) continue;
    from.add(l.from);
  }
  return [...from].sort();
}
