// 콜아웃(> [!easy] …) 파서 + remark 플러그인 — CM6(cmCallout)·markdown.tsx·테스트에서 공용.
// 문법: 첫 줄 `> [!타입] 제목?`, 이어지는 `> ` 줄들. 규약: docs/40-frontend/markdown-callout-math.md

const CALLOUT_TYPES = { easy: "쉬운 설명", note: "노트" } as const;
export type CalloutType = keyof typeof CALLOUT_TYPES;

export interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
  [k: string]: unknown;
}

const MARKER = /^\[!(\w+)\]\s*(.*)$/;

export function parseCalloutMarker(firstLine: string): { type: CalloutType; title: string } | null {
  const m = MARKER.exec(firstLine.trim());
  if (!m || !(m[1] in CALLOUT_TYPES)) return null;
  const type = m[1] as CalloutType;
  return { type, title: m[2] || CALLOUT_TYPES[type] };
}
