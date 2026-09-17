import { create } from "zustand";
import { hitDropZone } from "./hit.ts";
import type { DropArea } from "./hit.ts";

/** 끌고 있는 탭의 신원. 고스트에 제목을 그린다. */
interface DragTab {
  id: string;
  title: string;
}

interface DragState {
  /** 끌고 있는 탭. null 이면 드래그 중이 아니다. */
  tab: DragTab | null;
  x: number;
  y: number;
  /** 드래그 시작 때 한 번 잰 본문 영역. */
  area: DropArea | null;
  /** 지금 떨구면 갈 칸. null 이면 제자리다. */
  zone: number | null;
  start: (tab: DragTab, area: DropArea) => void;
  move: (x: number, y: number, paneCount: number) => void;
  end: () => void;
}

/**
 * 드래그 중인 탭. workspace 스토어와 일부러 떼어 놓았다(설계 §6).
 *
 * 포인터가 움직일 때마다 workspace.set 이 돌면 Sidebar·Pane 둘·Ribbon 이 전부 다시
 * 그려진다. 이 스토어는 구독자가 DragLayer 하나뿐이라 고스트 div 만 다시 그려진다.
 * 덤으로 applied()(볼트 전환)나 closeTab 이 드래그를 몰라도 된다.
 */
export const useDrag = create<DragState>((set, get) => ({
  tab: null,
  x: 0,
  y: 0,
  area: null,
  zone: null,

  start: (tab, area) => set({ tab, area, zone: null }),

  move: (x, y, paneCount) => {
    const { area } = get();
    if (area === null) return;
    set({ x, y, zone: hitDropZone(x, area, paneCount) });
  },

  end: () => set({ tab: null, area: null, zone: null }),
}));
