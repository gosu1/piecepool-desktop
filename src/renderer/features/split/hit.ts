/** 드롭 판정에 쓰는 본문 영역. 드래그 시작 때 한 번 재서 들고 있는다(설계 §5). */
export interface DropArea {
  left: number;
  width: number;
}

/** 칸이 하나일 때, 양쪽 가장자리 이만큼 안에 놓아야 갈라진다. */
const SPLIT_EDGE = 0.25;

/**
 * 포인터 x 가 어느 칸으로의 드롭인지. null 이면 제자리다(아무 일도 일어나지 않는다).
 *
 * **칸 수에 따라 뜻이 다르다.** 칸이 하나면 "새 칸을 어느 쪽에 만드나"(0=왼쪽, 1=오른쪽)이고,
 * 칸이 둘이면 "이미 있는 어느 칸으로 옮기나"다. 칸이 하나일 때 0 이 "0번 칸으로 옮겨라"와
 * 겹치지 않는 이유는, 그때 출발 칸도 언제나 0 이라 그 뜻이 아무 일도 아니기 때문이다.
 *
 * 화면 좌표를 쓰는 판정을 컴포넌트 밖으로 뺀 이유는 하나다 — .tsx 는 테스트할 수 없고,
 * 드래그에서 가장 틀리기 쉬운 부분이 이 판정이다. features/graph/hit.ts 와 같은 자리다.
 */
export function hitDropZone(x: number, area: DropArea, paneCount: number): number | null {
  const r = (x - area.left) / area.width;
  if (paneCount === 1) {
    if (r <= SPLIT_EDGE) return 0;
    return r >= 1 - SPLIT_EDGE ? 1 : null;
  }
  return r < 0.5 ? 0 : 1;
}
