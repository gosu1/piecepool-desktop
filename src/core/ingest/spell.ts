// 깨진 낱말 되돌리기 — K3 가 한국어를 옮기다 음절 하나에 받침을 붙이거나 모음을 바꾼다
// (해법→핵볍, 내년→낸년, 아무도→아묘도, 운동→욵동. 2026-09-16 실측: 회차당 본문 13~23곳,
// 실물 노트에서는 열 장 중 일곱 장). 추론 깊이를 올려도 그대로라 디코딩 문제다.
//
// 두 겹이다. ① **원문이 사전이다** — 모델이 옮긴 낱말은 노트에 있던 낱말이므로, 음절 하나만
// 고치면 노트의 낱말이 되는 것을 그 낱말로 되돌린다 (실물 18장에서 깨진 12종 중 11종의 바른
// 꼴이 노트에 있었다). ② **맞춤법 사전**(hunspell-asm + dictionary-ko) — "이 어절이 낱말이
// 아니다" 를 판정해 ①이 멀쩡한 말을 옆 낱말로 바꾸는 오판을 막는다. ① 만으로는 보존된
// 위키에서 페이지당 수십 개를 잘못 바꿨다 (주제를→주제랑, 본다→보다).
//
// 안전장치: 원문에 있는 꼴로만 바꾼다. 없는 말을 만들지 않는다. 바꾼 자리는 호출부가 로그로
// 남기고, 두 겹을 다 빠져나간 낱말은 로그에만 남긴다 — 본문에 표시하지 않는다 (UX).

const BASE = 0xac00;

function isHangul(c: string): boolean {
  return c >= "가" && c <= "힣";
}

function decompose(c: string): [number, number, number] {
  const i = c.charCodeAt(0) - BASE;
  return [Math.floor(i / 588), Math.floor((i % 588) / 28), i % 28];
}

/**
 * 어휘 — 원문의 한글 어절(2음절 이상)과 그 앞부분 전부. 조사가 붙어도 앞부분으로 맞는다:
 * 원문에 "해법을" 이 있으면 "해법" 도 어휘다.
 */
export type Vocab = Map<string, number>;

export function buildVocab(texts: string[]): Vocab {
  const vocab: Vocab = new Map();
  for (const t of texts) {
    for (const run of t.match(/[가-힣]{2,}/g) ?? []) {
      for (let k = 2; k <= run.length; k++) {
        const key = run.slice(0, k);
        vocab.set(key, (vocab.get(key) ?? 0) + 1);
      }
    }
  }
  return vocab;
}

/**
 * 한 음절의 변형 — 초성은 그대로. 받침만 빼거나 바꾼 것을 먼저, 모음을 바꾼 것을 나중에
 * (아묻도 는 아마도 가 아니라 아무도 다 — 받침 쪽이 먼저 맞아야 한다).
 */
function variants(c: string, allowVowel: boolean): { ch: string; vowelChanged: boolean }[] {
  const [l, v, t] = decompose(c);
  const out: { ch: string; vowelChanged: boolean }[] = [];
  for (let t2 = 0; t2 < 28; t2++) {
    if (t2 === t) continue;
    out.push({ ch: String.fromCharCode(BASE + l * 588 + v * 28 + t2), vowelChanged: false });
  }
  if (!allowVowel) return out;
  for (let v2 = 0; v2 < 21; v2++) {
    if (v2 === v) continue;
    for (let t2 = 0; t2 < 28; t2++) {
      out.push({ ch: String.fromCharCode(BASE + l * 588 + v2 * 28 + t2), vowelChanged: true });
    }
  }
  return out;
}

/**
 * 고친 앞부분 뒤에 남는 꼬리 — 조사·어미로 흔한 것만. 비어 있어도 된다.
 * "다" 는 일부러 뺐다: 활용형 "정했다" 를 "정해"+"다" 로 읽어 어휘의 "정해진" 에 맞추는
 * 오판을 막는다 (시제품에서 실제로 났다).
 */
const TAILS = new Set([
  "",
  "이",
  "가",
  "은",
  "는",
  "을",
  "를",
  "의",
  "에",
  "에서",
  "로",
  "으로",
  "와",
  "과",
  "도",
  "만",
  "이다",
  "에게",
  "처럼",
  "까지",
  "부터",
  "이라",
  "이라고",
  "라고",
  "하고",
  "해서",
  "하면",
  "면",
  "으면",
  "한",
  "하는",
  "하지",
  "이며",
  "이고",
  "이나",
  "나",
  "든",
  "들",
  "들이",
  "들은",
  "들을",
  "들의",
]);

/**
 * 어절 하나를 되돌린다. 원문 어휘에 없는데, 음절 하나를 고치면 "어휘에 있는 앞부분 + 흔한
 * 꼬리" 가 되는 경우에만 그 음절을 바꾼다. 없으면 null.
 *
 * 보존된 위키 5벌로 잰 뒤 정한 조건 셋 (없으면 멀쩡한 활용형을 옆 낱말로 바꾼다):
 * - 고친 음절이 맞은 앞부분의 마지막 음절이면 안 된다 (빨라진→빨라지, 채워진→채워져 를 막음)
 * - 모음은 세 음절 이상, 첫 음절이 아닐 때만, 그리고 사전이 있으면 고친 낱말이 사전에 있을 때만
 *   바꾼다 (앞부분→일부분, 절으로→잡으로, 프롬프트→프롬포트 를 막음)
 * - 받침만 바꾼 것을 모음을 바꾼 것보다 먼저 본다
 */
export function restoreWord(
  run: string,
  vocab: Vocab,
  isWord?: (run: string) => boolean,
): string | null {
  if (run.length < 2) return null;
  const allowVowel = run.length >= 3;
  // 후보가 여럿이면 원문에 더 자주 나온 쪽 — 아묘도 는 아마도(1) 가 아니라 아무도(4) 다.
  // 같으면 받침만 바꾼 쪽이 먼저다 (variants 의 순서).
  let best: { fixed: string; count: number } | null = null;
  for (let i = 0; i < run.length; i++) {
    if (!isHangul(run[i])) continue;
    for (const { ch, vowelChanged } of variants(run[i], allowVowel && i >= 1)) {
      const fixed = run.slice(0, i) + ch + run.slice(i + 1);
      if (vowelChanged && isWord && !isWord(fixed)) continue;
      // 고친 음절을 포함하되 그 뒤로 한 음절은 더 있는 앞부분이 어휘에 있고, 그 뒤가 흔한
      // 꼬리이고, 원래 그 앞부분은 어휘에 없어야 한다.
      for (let k = run.length; k >= i + 2; k--) {
        if (!TAILS.has(run.slice(k))) continue;
        const count = vocab.get(fixed.slice(0, k)) ?? 0;
        if (count > 0 && !vocab.has(run.slice(0, k))) {
          if (!best || count > best.count) best = { fixed, count };
          break;
        }
      }
    }
  }
  return best?.fixed ?? null;
}

/** 어휘가 아는 어절인가 — 그대로 있거나, "어휘의 앞부분 + 흔한 꼬리" 로 설명되면 안다. */
export function known(run: string, vocab: Vocab): boolean {
  if (vocab.has(run)) return true;
  for (let k = run.length - 1; k >= 2; k--) {
    if (TAILS.has(run.slice(k)) && vocab.has(run.slice(0, k))) return true;
  }
  return false;
}

/**
 * 글 안의 한글 어절을 훑어 되돌린다. 바꾼 쌍을 onFix 로 알린다.
 *
 * `isWord` 는 사전(hunspell) — 주면 사전이 "낱말이 아니다" 라고 하는 어절만 건드린다.
 * 원문 어휘만으로는 "주제를 → 주제랑" 처럼 멀쩡한 말을 옆 낱말로 바꾸는 오판이 페이지당
 * 수십 개 났다 (보존된 위키로 실측). 인용문에는 사전이 필요 없다 — 되돌린 인용이 원문에 있어야
 * 통과하므로 그 자체가 검증이다.
 */
export function restoreTypos(
  text: string,
  vocab: Vocab,
  onFix?: (from: string, to: string) => void,
  isWord?: (run: string) => boolean,
): string {
  return text.replace(/[가-힣]{2,}/g, (run) => {
    if (known(run, vocab)) return run;
    if (isWord && isWord(run)) return run;
    const fixed = restoreWord(run, vocab, isWord);
    if (!fixed) return run;
    onFix?.(run, fixed);
    return fixed;
  });
}

/**
 * 맞춤법 사전을 연다. hunspell 의 WebAssembly 판 + 한국어 사전 (오프라인 파일, 원칙 6 문제 없음).
 * 여는 데 0.7초, 메모리 14MB. 실행마다 한 번.
 */
export async function loadDictionary(): Promise<(run: string) => boolean> {
  const { loadModule } = await import("hunspell-asm");
  const { default: ko } = await import("dictionary-ko");
  const factory = await loadModule();
  const aff = factory.mountBuffer(ko.aff, "ko.aff");
  const dic = factory.mountBuffer(ko.dic, "ko.dic");
  const h = factory.create(aff, dic);
  return (run) => h.spell(run);
}
