import { describe, expect, it } from "vitest";
import { compact } from "./panes.ts";
import type { Pane } from "./panes.ts";
import type { Tab } from "./workspace.ts";

const tab: Tab = {
  kind: "note",
  id: "note:a.md",
  path: "a.md",
  title: "a",
  body: "",
  error: null,
  seq: 1,
  dirty: false,
  saveError: null,
};

/** 탭이 든 칸. id 는 호출부가 준다 — 같은 id 가 둘이면 안 된다. */
const full = (id: number): Pane => ({ id, tabs: [tab], activeTab: tab.id });
const empty = (id: number): Pane => ({ id, tabs: [], activeTab: null });

describe("compact", () => {
  it("빈 칸이 없으면 그대로 돌려준다", () => {
    const panes = [full(0), full(1)];
    const r = compact(panes, 1);
    expect(r.panes).toEqual(panes);
    expect(r.activePane).toBe(1);
  });

  it("앞 칸이 비면 걷어내고 focus 를 한 칸 당긴다", () => {
    const right = full(1);
    const r = compact([empty(0), right], 1);
    expect(r.panes).toEqual([right]);
    expect(r.activePane).toBe(0);
  });

  it("뒷 칸이 비면 걷어내고 focus 는 그대로다", () => {
    const left = full(0);
    const r = compact([left, empty(1)], 0);
    expect(r.panes).toEqual([left]);
    expect(r.activePane).toBe(0);
  });

  it("focus 칸 자체가 비면 0 이 된다", () => {
    const left = full(0);
    const r = compact([left, empty(1)], 1);
    expect(r.panes).toEqual([left]);
    expect(r.activePane).toBe(0);
  });

  it("전부 비면 첫 칸을 그대로 남긴다", () => {
    const first = empty(0);
    const r = compact([first, empty(1)], 1);
    expect(r.panes).toEqual([first]);
    expect(r.activePane).toBe(0);
  });

  it("focus 가 범위 밖이면 0 이 된다", () => {
    const only = full(0);
    const r = compact([only], 5);
    expect(r.activePane).toBe(0);
  });
});
