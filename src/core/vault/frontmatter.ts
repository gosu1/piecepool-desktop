import type { Fm } from "../../shared/types.ts";

/** 원본 줄바꿈. LF 또는 CRLF. */
export type Eol = "lf" | "crlf";

/**
 * 파싱 결과. Fm 4필드 밖의 것들을 전부 들고 있어야 왕복이 항등이 된다.
 *
 * 상위 4.1 이 남의 옵시디언 볼트를 약속하므로, 사용자가 붙인 tags: aliases:
 * cssclasses: 를 버리면 "sources 한 줄 추가" 커밋에서 그것들이 함께 사라진다.
 * 되돌리기로도 분리되지 않는다.
 */
export interface ParsedNote {
  fm: Fm;
  /** Fm 4필드 밖의 사용자 키. 그대로 되쓴다. */
  rest: Record<string, unknown>;
  /** 내부 표현은 항상 LF 로 정규화한다. */
  body: string;
  /** 원본의 줄바꿈. 되쓸 때 복원한다. */
  eol: Eol;
  bom: boolean;
  /**
   * 프론트매터 블록이 있는데 파싱에 실패했을 때의 사유.
   *
   * 있으면 fm/rest 를 신뢰하지 않고 원본 블록을 그대로 되쓴다.
   * 검증은 게이트가 아니라 관찰이므로(상위 5.1) throw 하지 않는다 —
   * 노트 하나 때문에 볼트 스캔이 죽으면 안 되고, 조용히 삼키면
   * 깨진 채 살아있던 사용자 원문이 다음 쓰기에서 지워진다.
   */
  malformed?: string;
}

export function parse(raw: string): ParsedNote {
  throw new Error("unimplemented: core/vault/frontmatter.parse");
}

/**
 * 되쓴다. 왕복은 항등이어야 한다 — parse -> stringify 가 원본과 같아야 한다.
 *
 * 구 레포는 쓰기가 백슬래시와 따옴표를 이스케이프하는데 읽기가 복원하지 않아
 * 저장 사이클마다 백슬래시가 증식했다.
 */
export function stringify(
  fm: Fm,
  rest: Record<string, unknown>,
  body: string,
  opts?: { eol?: Eol; bom?: boolean },
): string {
  throw new Error("unimplemented: core/vault/frontmatter.stringify");
}

/**
 * sources 는 append-only 다. 중복은 제거하고 덧붙이기만 한다.
 *
 * setSources 를 일부러 만들지 않는다 - 덮어쓸 수 있으면 쿼리 세션이 남긴
 * 출처가 다음 인제스트에서 조용히 사라진다. 타입으로는 못 막으므로
 * 덮어쓰는 함수를 아예 두지 않는 것으로 막는다.
 */
export function addSource(fm: Fm, source: string): Fm {
  throw new Error("unimplemented: core/vault/frontmatter.addSource");
}
