import { describe, expect, it } from "vitest";
import { hitDropZone } from "./hit.ts";
import type { DropArea } from "./hit.ts";

/** 사이드바가 닫힌 화면. 왼쪽 끝이 0 이다. */
const flush: DropArea = { left: 0, width: 1000 };
/** 사이드바가 열린 화면. 본문이 오른쪽으로 밀려 있다. */
const shifted: DropArea = { left: 288, width: 800 };

describe("hitDropZone — 칸이 하나일 때", () => {
  it("왼쪽 25% 안이면 왼쪽에 새 칸이다", () => {
    expect(hitDropZone(0, flush, 1)).toBe(0);
    expect(hitDropZone(250, flush, 1)).toBe(0);
  });

  it("왼쪽 25% 경계 바로 오른쪽은 제자리다", () => {
    expect(hitDropZone(251, flush, 1)).toBeNull();
  });

  it("가운데는 제자리다", () => {
    expect(hitDropZone(500, flush, 1)).toBeNull();
  });

  it("오른쪽 25% 경계 바로 왼쪽은 제자리다", () => {
    expect(hitDropZone(749, flush, 1)).toBeNull();
  });

  it("오른쪽 25% 안이면 오른쪽에 새 칸이다", () => {
    expect(hitDropZone(750, flush, 1)).toBe(1);
    expect(hitDropZone(999, flush, 1)).toBe(1);
  });

  it("area.left 가 0 이 아닐 때도 양쪽 경계가 맞다", () => {
    // 왼쪽 경계 288 + 800*0.25 = 488, 오른쪽 경계 288 + 800*0.75 = 888
    expect(hitDropZone(488, shifted, 1)).toBe(0);
    expect(hitDropZone(489, shifted, 1)).toBeNull();
    expect(hitDropZone(887, shifted, 1)).toBeNull();
    expect(hitDropZone(888, shifted, 1)).toBe(1);
  });
});

describe("hitDropZone — 칸이 둘일 때", () => {
  it("가운데 왼쪽은 왼쪽 칸이다", () => {
    expect(hitDropZone(0, flush, 2)).toBe(0);
    expect(hitDropZone(499, flush, 2)).toBe(0);
  });

  it("정확히 가운데부터는 오른쪽 칸이다", () => {
    expect(hitDropZone(500, flush, 2)).toBe(1);
    expect(hitDropZone(999, flush, 2)).toBe(1);
  });

  it("칸이 둘이면 가장자리에도 제자리가 없다 — 셋째 칸은 만들지 않는다", () => {
    expect(hitDropZone(10, flush, 2)).toBe(0);
    expect(hitDropZone(990, flush, 2)).toBe(1);
  });
});
