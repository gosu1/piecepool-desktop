import { useEffect, useMemo, useRef } from "react";
import { useWorkspace } from "../store/workspace.ts";
import type { NoteTab, Tab, TreeNode } from "../store/workspace.ts";
import { GraphView } from "../features/graph/GraphView.tsx";
import { NoteEditor } from "../features/editor/NoteEditor.tsx";
import { QueryView } from "../features/query/QueryView.tsx";
import { IngestView } from "../features/ingest/IngestView.tsx";

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
  if (tab.kind === "ingest") return <IngestView />;

  if (tab.error !== null) {
    return <div className="flex-1 overflow-auto p-4 text-sm text-danger">{tab.error}</div>;
  }

  if (tab.body === null) {
    return <div className="grid flex-1 place-items-center text-sm text-ink-muted">읽는 중…</div>;
  }

  return <Editing tab={tab} body={tab.body} />;
}

/** 자동 저장 간격. 타이핑이 이만큼 멈추면 쓴다. 탭을 닫거나 칸이 사라질 때도 쓴다. */
const SAVE_DELAY_MS = 800;

/** 트리의 파일 이름(확장자 뗀 것) 전부 — `[[` 자동완성과 본문 속 제목 강조의 재료. */
function titlesOf(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: TreeNode[]) => {
    for (const n of ns) {
      if (n.kind === "file") out.push(n.name.replace(/\.md$/i, ""));
      else if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

function Editing({ tab, body }: { tab: NoteTab; body: string }) {
  const editBody = useWorkspace((s) => s.editBody);
  const saveNote = useWorkspace((s) => s.saveNote);
  const openTab = useWorkspace((s) => s.openTab);
  const tree = useWorkspace((s) => s.tree);
  const titles = useMemo(() => titlesOf(tree), [tree]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 타이핑이 멈추면 저장. 언마운트(탭 닫힘·칸 접힘)에도 남은 것을 쓴다.
  useEffect(() => {
    if (!tab.dirty) return;
    timer.current = setTimeout(() => void saveNote(tab.id), SAVE_DELAY_MS);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [tab.body, tab.dirty, tab.id, saveNote]);
  useEffect(() => () => void saveNote(tab.id), [tab.id, saveNote]);

  // 강조된 제목을 누르면 그 노트를 연다. 트리에서 같은 이름의 파일을 찾는다.
  const openTitle = (title: string) => {
    const find = (ns: TreeNode[]): TreeNode | null => {
      for (const n of ns) {
        if (n.kind === "file" && n.name.replace(/\.md$/i, "") === title) return n;
        const hit = n.children ? find(n.children) : null;
        if (hit) return hit;
      }
      return null;
    };
    const hit = find(tree);
    if (hit) void openTab(hit.path, title);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <NoteEditor
        value={body}
        onChange={(v) => editBody(tab.id, v)}
        titles={titles}
        onOpenTitle={openTitle}
      />
      {tab.saveError !== null && (
        <div className="absolute right-3 bottom-2 text-xs text-danger">
          저장 실패: {tab.saveError}
        </div>
      )}
    </div>
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
