import { useWorkspace } from "../store/workspace.ts";

/** 활성 탭의 본문. 마크다운을 렌더하지 않는다 — 원문 그대로다(설계 §2). */
export function NoteView() {
  const tabs = useWorkspace((s) => s.tabs);
  const activeTab = useWorkspace((s) => s.activeTab);
  const tab = tabs.find((t) => t.id === activeTab) ?? null;

  if (tab === null) {
    return (
      <div className="grid flex-1 place-items-center text-sm text-ink-muted">열린 파일 없음</div>
    );
  }

  // 그래프 탭은 아직 열 방법이 없다. Task 6 에서 <GraphView/> 가 이 자리에 들어온다.
  if (tab.kind !== "note") return null;

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
