import { NoteView } from "./NoteView.tsx";
import { TabStrip } from "./TabStrip.tsx";

/**
 * 칸 하나 — 탭 줄과 본문 한 벌.
 *
 * Shell 이 이것을 칸 수만큼 그린다. 지금까지 Shell 이 TabStrip 과 NoteView 를
 * 직접 나란히 놓았는데, 칸이 둘이 되면 그 한 벌을 두 번 그려야 한다.
 */
export function Pane({ index }: { index: number }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <TabStrip pane={index} />
      <NoteView pane={index} />
    </div>
  );
}
