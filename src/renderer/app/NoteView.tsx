import { useWorkspace } from "../store/workspace.ts";
import type { Tab } from "../store/workspace.ts";
import { GraphView } from "../features/graph/GraphView.tsx";
import { QueryView } from "../features/query/QueryView.tsx";

/**
 * 그래프 탭이 활성일 땐 GraphView 가 그리므로 이 함수는 null 을 반환해 자리를 비켜 준다.
 * 쿼리 탭은 반대다 — 지킬 상태가 없어 여기서 직접 그린다(설계 §5).
 */
function noteBody(tab: Tab | null) {
  if (tab === null) {
    return (
      <div className="grid flex-1 place-items-center text-sm text-ink-muted">열린 파일 없음</div>
    );
  }

  if (tab.kind === "graph") return null;
  if (tab.kind === "query") return <QueryView />;

  if (tab.error !== null) {
    return <div className="flex-1 overflow-auto p-4 text-sm text-danger">{tab.error}</div>;
  }

  if (tab.body === null) {
    return <div className="grid flex-1 place-items-center text-sm text-ink-muted">읽는 중…</div>;
  }

  return (
    <pre className="flex-1 overflow-auto whitespace-pre-wrap p-4 font-sans text-sm text-ink">
      {tab.body}
    </pre>
  );
}

/** 한 칸의 활성 탭 본문. 마크다운을 렌더하지 않는다 — 원문 그대로다(설계 §2). */
export function NoteView({ pane }: { pane: number }) {
  // 칸을 통째로 받는다 — 파생값을 셀렉터에서 만들면 매번 새 참조가 나온다.
  const p = useWorkspace((s) => s.panes[pane]);
  if (p === undefined) return null;

  const tab = p.tabs.find((t) => t.id === p.activeTab) ?? null;
  const graphOpen = p.tabs.some((t) => t.kind === "graph");

  return (
    <>
      {/* 그래프 탭이 이 칸에 있는 한 계속 마운트해 둔다 — 언마운트하면 재스캔·재배치로
          pan/zoom 과 노드 위치를 잃는다. 탭이 안 바뀌었을 땐 숨기기만 한다. */}
      {graphOpen && <GraphView hidden={tab === null || tab.kind !== "graph"} />}
      {noteBody(tab)}
    </>
  );
}
