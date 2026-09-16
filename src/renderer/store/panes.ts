import type { Tab } from "./workspace.ts";

/**
 * 칸 하나. 탭 줄과 본문이 한 벌이다.
 *
 * `id` 는 React 의 key 로 쓴다. 인덱스를 키로 주면 왼쪽 칸이 접힐 때
 * React 가 오른쪽 칸의 내용을 왼쪽 자리로 재조정해 GraphView 가 새로 마운트된다 —
 * 배치를 잃는 자리가 설계 §7 이 허용한 것보다 넓어진다.
 */
export interface Pane {
  id: number;
  tabs: Tab[];
  activeTab: string | null;
}

/**
 * 빈 칸을 걷어내고, 주목할 칸의 새 인덱스를 함께 돌려준다.
 *
 * 칸을 지우면 인덱스가 밀린다. moveTabToPane 과 closeTab 이 이 계산을 각자 하면
 * 한쪽만 틀리므로 한 자리에 모았다(설계 §4.1).
 *
 * `panes` 는 절대 빈 배열이 되지 않는다 — 전부 비면 첫 칸을 그대로 남긴다.
 * panes[0] 을 읽는 자리가 여럿이고, 빈 배열을 허용하면 그 전부에 가드가 붙는다.
 */
export function compact(panes: Pane[], focus: number): { panes: Pane[]; activePane: number } {
  const kept = panes.filter((p) => p.tabs.length > 0);
  if (kept.length === 0) return { panes: panes.slice(0, 1), activePane: 0 };
  // 참조로 찾는다 — filter 가 같은 객체를 넘겨주므로 indexOf 가 맞는다.
  const target = panes[focus];
  const next = target === undefined ? -1 : kept.indexOf(target);
  return { panes: kept, activePane: next === -1 ? 0 : next };
}
