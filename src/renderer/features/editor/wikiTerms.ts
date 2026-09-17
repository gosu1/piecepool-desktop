// 본문 속 위키 개념 키워드 매칭 — 표시 계층 전용(본문 비파괴).
// 에디터(cmWikiTerm)·읽기 모드(remarkWikiTerm)가 같은 규칙을 공유한다.
// 스펙: docs/superpowers/specs/2026-07-16-pdf-auto-pipeline-wiki-terms-design.md §4.

export interface TermMatch {
  from: number;
  to: number;
  title: string; // canonical 위키 제목 (매치 표면형이 대소문자 달라도 원 제목)
}

export interface TermMatcher {
  regex: RegExp; // 후보 "위치" 탐색용 — 확정은 같은 첫 글자의 후보만 긴 것부터 대조
  // 첫 글자(소문자) → 후보들(길이 내림차순). 위치마다 전 제목을 돌면 대형 공간에서 수십 ms 로 퇴행한다.
  byFirst: Map<string, Array<{ title: string; lower: string }>>;
}

// 제목 뒤에 붙어도 매치로 인정하는 한국어 조사 — 긴 것 먼저("에서"가 "에"보다 먼저 걸리게).
const PARTICLES = [
  "에서",
  "부터",
  "까지",
  "처럼",
  "조차",
  "마저",
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "의",
  "에",
  "로",
  "와",
  "과",
  "도",
  "만",
];

const WORD = /[A-Za-z0-9가-힣]/;

/** 제목 목록 → 매처. 2글자 미만 제외(과매칭 방지), 대소문자 무시 중복 제거, 최장 우선 정렬. */
export function buildTermMatcher(titles: string[]): TermMatcher | null {
  const seen = new Set<string>();
  const list = titles
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .filter((t) => {
      const k = t.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.length - a.length); // alternation 은 앞이 이긴다 — 최장 일치 우선
  if (!list.length) return null;
  const esc = list.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const byFirst = new Map<string, Array<{ title: string; lower: string }>>();
  for (const t of list) {
    const lower = t.toLowerCase();
    const k = lower.charAt(0);
    const arr = byFirst.get(k);
    if (arr) arr.push({ title: t, lower });
    else byFirst.set(k, [{ title: t, lower }]);
  }
  return { regex: new RegExp(`(?:${esc.join("|")})`, "gi"), byFirst };
}

/** 매치 뒤 경계 — 비단어문자면 OK, 한글이면 조사(+비단어문자)일 때만 OK. */
function okAfter(text: string, end: number): boolean {
  const c = text[end];
  if (c === undefined || !WORD.test(c)) return true;
  if (!/[가-힣]/.test(c)) return false;
  for (const p of PARTICLES) {
    if (text.startsWith(p, end)) {
      const after = text[end + p.length];
      if (after === undefined || !WORD.test(after)) return true;
    }
  }
  return false;
}

/** text 안의 개념 매치 전부(등장 순, 비중첩). excluded 구간과 겹치는 매치는 버린다. */
export function findTermMatches(
  text: string,
  matcher: TermMatcher,
  excluded: Array<{ from: number; to: number }> = [],
): TermMatch[] {
  const out: TermMatch[] = [];
  const re = new RegExp(matcher.regex.source, "gi"); // 호출마다 독립 — 공유 lastIndex 오염 방지
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const from = m.index;
    const prev = text[from - 1];
    let hit: TermMatch | null = null;
    if (prev === undefined || !WORD.test(prev)) {
      // 정규식은 이 위치의 최장 후보만 알려준다 — 그 후보가 경계·제외에서 떨어져도
      // 같은 위치의 더 짧은 제목("스레드 풀링" 속 "스레드")은 유효할 수 있어 첫 글자가 같은
      // 후보만 대조한다. 원문 조각을 그때 소문자화한다 — text 전체 toLowerCase 는 İ(U+0130)
      // 처럼 길이가 변하는 문자 뒤의 인덱스를 전부 어긋나게 한다.
      const cands = matcher.byFirst.get(text.charAt(from).toLowerCase().charAt(0)) ?? [];
      for (const c of cands) {
        const to = from + c.title.length;
        if (to > text.length || text.slice(from, to).toLowerCase() !== c.lower) continue;
        if (!okAfter(text, to)) continue;
        if (excluded.some((r) => from < r.to && to > r.from)) continue;
        hit = { from, to, title: c.title };
        break; // 후보는 길이 내림차순 — 첫 통과가 최장 일치
      }
    }
    if (hit) {
      out.push(hit);
      re.lastIndex = hit.to;
    } else {
      re.lastIndex = from + 1;
    }
  }
  return out;
}

// 매칭 제외 구간(순수 텍스트 규칙): 위키링크/임베드 · URL · 인라인 코드.
// 펜스 코드블록은 에디터에선 syntaxTree(cmWikiTerm), 읽기 모드에선 mdast 구조가 이미 걸러 준다.
const EXCLUDE = /!?\[\[[^\]]*\]\]|https?:\/\/[^\s)]+|`[^`\n]*`/g;

export function findExcludedRanges(text: string): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  EXCLUDE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EXCLUDE.exec(text)) !== null) out.push({ from: m.index, to: m.index + m[0].length });
  return out;
}
