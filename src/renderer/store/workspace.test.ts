import { beforeEach, describe, expect, it } from "vitest";
import {
  applied,
  clampWidth,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  useWorkspace,
} from "./workspace.ts";
import type { VaultPayload } from "../../shared/ipc.ts";

const initial = useWorkspace.getState();

beforeEach(() => {
  useWorkspace.setState({
    expanded: new Set(initial.expanded),
    selected: null,
    sidebarOpen: true,
    sidebarWidth: 240,
  });
});

describe("clampWidth", () => {
  it("최소보다 작으면 최소로 올린다", () => {
    expect(clampWidth(10)).toBe(MIN_SIDEBAR_WIDTH);
  });

  it("최대보다 크면 최대로 내린다", () => {
    expect(clampWidth(9999)).toBe(MAX_SIDEBAR_WIDTH);
  });

  it("범위 안이면 그대로 둔다", () => {
    expect(clampWidth(300)).toBe(300);
  });

  it("최소값 그대로는 최소로 둔다", () => {
    expect(clampWidth(MIN_SIDEBAR_WIDTH)).toBe(MIN_SIDEBAR_WIDTH);
  });

  it("최대값 그대로는 최대로 둔다", () => {
    expect(clampWidth(MAX_SIDEBAR_WIDTH)).toBe(MAX_SIDEBAR_WIDTH);
  });
});

describe("toggleFolder", () => {
  it("닫힌 폴더를 열고 다시 닫는다", () => {
    const { toggleFolder } = useWorkspace.getState();
    toggleFolder("inbox");
    expect(useWorkspace.getState().expanded.has("inbox")).toBe(true);
    toggleFolder("inbox");
    expect(useWorkspace.getState().expanded.has("inbox")).toBe(false);
  });

  it("기존 Set 을 그 자리에서 고치지 않는다", () => {
    const before = useWorkspace.getState().expanded;
    useWorkspace.getState().toggleFolder("inbox");
    expect(useWorkspace.getState().expanded).not.toBe(before);
  });
});

describe("select", () => {
  it("선택한 경로를 담는다", () => {
    useWorkspace.getState().select("wiki/트랜스포머.md");
    expect(useWorkspace.getState().selected).toBe("wiki/트랜스포머.md");
  });
});

describe("toggleSidebar", () => {
  it("열림과 닫힘을 뒤집는다", () => {
    useWorkspace.getState().toggleSidebar();
    expect(useWorkspace.getState().sidebarOpen).toBe(false);
    useWorkspace.getState().toggleSidebar();
    expect(useWorkspace.getState().sidebarOpen).toBe(true);
  });
});

describe("setSidebarWidth", () => {
  it("클램프를 거쳐 들어간다", () => {
    useWorkspace.getState().setSidebarWidth(10_000);
    expect(useWorkspace.getState().sidebarWidth).toBe(MAX_SIDEBAR_WIDTH);
  });
});

describe("applied", () => {
  it("실패면 error 에 메시지를 담고 loading 을 내린다", () => {
    const result = applied({ ok: false, error: { kind: "unknown", message: "권한 없음" } });
    expect(result).toEqual({ error: "권한 없음", loading: false });
  });

  it("value 가 null 이면 loading 만 내리고 vault 는 건드리지 않는다", () => {
    const result = applied({ ok: true, value: null });
    expect(result).toEqual({ loading: false });
  });

  it("값이 있으면 vault·tree 를 싣고 expanded·selected 를 새 볼트 기준으로 되돌린다", () => {
    const payload: VaultPayload = {
      root: "/vault",
      name: "vault",
      tree: [{ name: "a.md", path: "a.md", kind: "file" }],
    };
    const result = applied({ ok: true, value: payload });
    expect(result).toEqual({
      vault: payload,
      tree: payload.tree,
      expanded: new Set(),
      selected: null,
      error: null,
      loading: false,
    });
  });
});
