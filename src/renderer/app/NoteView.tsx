import { useWorkspace } from "../store/workspace.ts";
import type { Tab } from "../store/workspace.ts";
import { GraphView } from "../features/graph/GraphView.tsx";

/** graphOpen 이 아닌 동안엔 호출되지 않으므로 tab.kind 는 여기서 "graph" 가 아니다. */
function noteBody(tab: Tab | null) {
  if (tab === null) {
    return (
      <div className="grid flex-1 place-items-center text-sm text-ink-muted">열린 파일 없음</div>
    );
  }

  if (tab.kind === "graph") return null;

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

/** 활성 탭의 본문. 마크다운을 렌더하지 않는다 — 원문 그대로다(설계 §2). */
export function NoteView() {
  const tabs = useWorkspace((s) => s.tabs);
  const activeTab = useWorkspace((s) => s.activeTab);
  const tab = tabs.find((t) => t.id === activeTab) ?? null;
  const graphOpen = tabs.some((t) => t.kind === "graph");

  return (
    <>
      {/* 그래프 탭이 있는 한 계속 마운트해 둔다 — 언마운트하면 재스캔·재배치로
          pan/zoom 과 노드 위치를 잃는다. 탭이 안 바뀌었을 땐 숨기기만 한다. */}
      {graphOpen && <GraphView hidden={tab === null || tab.kind !== "graph"} />}
      {noteBody(tab)}
    </>
  );
}
