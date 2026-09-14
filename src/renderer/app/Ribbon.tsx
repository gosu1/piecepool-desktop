import { RIBBON_WIDTH } from "../store/workspace.ts";

/** 좌측 아이콘 바. 이번 조각에서 동작하는 아이콘은 Task 5 의 토글 하나뿐이다. */
export function Ribbon() {
  return (
    <nav
      aria-label="리본"
      style={{ width: RIBBON_WIDTH }}
      className="flex shrink-0 flex-col items-center gap-1 border-r border-hairline bg-chrome pt-2"
    />
  );
}
