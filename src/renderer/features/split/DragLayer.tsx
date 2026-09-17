import { useDrag } from "./drag.ts";

/**
 * 드래그 중에만 보이는 오버레이. 그리는 것은 둘이다 —
 * 포인터를 따라다니는 고스트와, 지금 놓으면 갈 칸의 강조.
 *
 * pointer-events-none 이라 아래 요소의 포인터 이벤트를 가로채지 않는다.
 * 이게 없으면 오버레이가 pointermove 를 삼켜 드래그가 그 자리에서 멈춘다.
 */
export function DragLayer() {
  const tab = useDrag((s) => s.tab);
  const area = useDrag((s) => s.area);
  const zone = useDrag((s) => s.zone);
  const x = useDrag((s) => s.x);
  const y = useDrag((s) => s.y);

  if (tab === null || area === null) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      {zone !== null && (
        <div
          // 칸이 하나일 때 zone 이 1 이면 오른쪽 절반이 새 칸이 될 자리다.
          // 판정 경계(75%)와 강조 영역(50%)이 다른 것은 의도한 것이다 —
          // 강조는 "놓으면 여기 생긴다" 를 보여 준다.
          style={{
            left: area.left + (zone === 0 ? 0 : area.width / 2),
            width: area.width / 2,
          }}
          className="absolute inset-y-0 border-2 border-primary bg-primary/10"
        />
      )}
      <div
        // 포인터 바로 아래 두면 커서가 글자를 가린다. 오른쪽 아래로 조금 민다.
        style={{ left: x + 8, top: y + 8 }}
        className="absolute h-6 w-40 truncate rounded-md bg-chrome px-2 text-sm leading-6 text-ink opacity-80 shadow"
      >
        {tab.title}
      </div>
    </div>
  );
}
