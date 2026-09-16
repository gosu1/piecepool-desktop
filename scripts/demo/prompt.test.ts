// 후보 추리기 — API 없이 확인한다.
//
//   npx vitest run scripts/demo

import { describe, expect, it } from "vitest";
import { pickCandidates } from "./prompt.ts";
import { hash8, type Note, type WikiPage } from "./vault.ts";

function page(name: string, summary: string, body = "", records: string[] = []): WikiPage {
  return {
    path: `wiki/${name}.md`,
    name,
    fm: { hashes: {} },
    summary,
    sections: body ? [{ heading: "경험", content: body, ours: true, hash: hash8(body) }] : [],
    records,
    recordsOurs: true,
  };
}

function note(body: string): Note {
  return { path: "일기/2026-10-08.md", name: "2026-10-08", body, userFm: {}, hash: "", date: null };
}

describe("BM25 후보", () => {
  const wiki = [
    page(
      "달리기",
      "아침에 시작한 운동",
      "무릎 통증으로 러너스 니 진단. 헬스장 트레이너가 러닝머신을 권했다.",
    ),
    page("김치볶음밥", "자취 요리", "김치와 밥을 볶는다. 계란 프라이를 올린다."),
    page("DETR", "트랜스포머 객체 검출", "헝가리안 매칭으로 예측과 정답을 짝짓는다."),
  ];

  it("페이지 이름이 노트에 없어도 겹치는 낱말로 후보에 든다", () => {
    const c = pickCandidates(note("헬스장에서 러닝머신 20분. 무릎은 괜찮았다."), wiki, undefined, {
      topN: 1,
    });
    expect(c.related.map((p) => p.name)).toEqual(["달리기"]);
    expect(c.why.get("달리기")).toBe("겹침");
  });

  it("겹치는 낱말이 없으면 후보가 되지 않는다", () => {
    const c = pickCandidates(note("오늘은 종일 잤다."), wiki, undefined, { topN: 3 });
    expect(c.related).toEqual([]);
  });

  it("글자 일치가 우선이고 상한은 겹침 후보에만 걸린다", () => {
    const c = pickCandidates(note("DETR 논문을 다시 읽었다. 헬스장은 쉬었다."), wiki, undefined, {
      topN: 1,
    });
    expect(c.why.get("DETR")).toBe("글자");
    expect(c.related.length).toBeGreaterThanOrEqual(1);
    expect(c.related.length).toBeLessThanOrEqual(2);
  });
});
