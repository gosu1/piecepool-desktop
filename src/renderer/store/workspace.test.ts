import { beforeEach, describe, expect, it } from "vitest";
import {
  applied,
  clampWidth,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  stripFrontmatter,
  useWorkspace,
} from "./workspace.ts";
import type { VaultPayload } from "../../shared/ipc.ts";
import type { Result } from "../../shared/types.ts";

const initial = useWorkspace.getState();

beforeEach(() => {
  useWorkspace.setState({
    expanded: new Set(initial.expanded),
    selected: null,
    sidebarOpen: true,
    sidebarWidth: 240,
    tabs: [],
    activeTab: null,
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

  it("값이 있으면 vault·tree 를 싣고 expanded·selected·탭을 새 볼트 기준으로 되돌린다", () => {
    const payload: VaultPayload = {
      root: "/vault",
      name: "vault",
      tree: [{ name: "a.md", path: "a.md", kind: "file" }],
    };
    const result = applied({ ok: true, value: payload });
    // toEqual 로 모양 전체를 고정한다 — 볼트 전환이 비워야 할 것을 하나라도 빠뜨리면
    // 이전 볼트의 상태가 새 볼트에 조용히 남는다.
    expect(result).toEqual({
      vault: payload,
      tree: payload.tree,
      expanded: new Set(),
      selected: null,
      tabs: [],
      activeTab: null,
      error: null,
      loading: false,
    });
  });
});

describe("stripFrontmatter", () => {
  it("상단 --- 블록을 잘라낸다", () => {
    const raw = "---\ncreated: 2025-10-03\n---\n\n# 러닝\n";
    expect(stripFrontmatter(raw)).toBe("# 러닝\n");
  });

  it("--- 가 없으면 그대로 둔다", () => {
    expect(stripFrontmatter("# 러닝\n본문")).toBe("# 러닝\n본문");
  });

  it("첫 줄이 아닌 --- 는 건드리지 않는다", () => {
    const raw = "# 러닝\n\n---\n\n본문";
    expect(stripFrontmatter(raw)).toBe(raw);
  });

  it("닫히지 않은 --- 는 그대로 둔다", () => {
    const raw = "---\ncreated: 2025-10-03\n\n# 러닝";
    expect(stripFrontmatter(raw)).toBe(raw);
  });

  it("CRLF 로 저장된 파일도 잘라낸다", () => {
    const raw = "---\r\ncreated: 2025-10-03\r\n---\r\n\r\n# 러닝\r\n";
    expect(stripFrontmatter(raw)).toBe("# 러닝\r\n");
  });

  it("빈 프론트매터도 잘라낸다", () => {
    expect(stripFrontmatter("---\n---\n\n# 러닝\n")).toBe("# 러닝\n");
  });
});

describe("탭", () => {
  it("같은 경로를 두 번 열어도 탭이 하나다", () => {
    const { openTab } = useWorkspace.getState();
    openTab("wiki/a.md", "a");
    openTab("wiki/a.md", "a");
    const s = useWorkspace.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.activeTab).toBe("wiki/a.md");
  });

  it("활성인 가운데 탭을 닫으면 오른쪽 이웃이 활성이 된다", () => {
    const { openTab, closeTab } = useWorkspace.getState();
    openTab("wiki/a.md", "a");
    openTab("wiki/b.md", "b");
    openTab("wiki/c.md", "c");
    // b 를 다시 열어 활성으로 만든다. 활성 탭을 닫아야 이웃 이동이 일어난다.
    openTab("wiki/b.md", "b");
    closeTab("wiki/b.md");
    const s = useWorkspace.getState();
    expect(s.tabs.map((t) => t.path)).toEqual(["wiki/a.md", "wiki/c.md"]);
    expect(s.activeTab).toBe("wiki/c.md");
  });

  it("활성이 아닌 탭을 닫으면 활성이 그대로다", () => {
    const { openTab, closeTab } = useWorkspace.getState();
    openTab("wiki/a.md", "a");
    openTab("wiki/b.md", "b");
    closeTab("wiki/a.md");
    expect(useWorkspace.getState().activeTab).toBe("wiki/b.md");
  });

  it("마지막 탭을 닫으면 activeTab 이 null 이다", () => {
    const { openTab, closeTab } = useWorkspace.getState();
    openTab("wiki/a.md", "a");
    closeTab("wiki/a.md");
    const s = useWorkspace.getState();
    expect(s.tabs).toHaveLength(0);
    expect(s.activeTab).toBeNull();
  });

  it("닫았다가 다시 연 탭에 옛 응답이 덮어쓰지 않는다", async () => {
    // node 환경에는 window 가 없어 readRaw 호출이 즉시(동기로) throw 하므로,
    // 실제 경쟁을 재현하려면 IPC 경계를 직접 흉내내 응답 순서를 뒤집어야 한다 —
    // 그러지 않으면 첫 요청과 두 번째 요청이 끼어들 틈 없이 순서대로 끝나 세대 검사를
    // 지우고 돌려도 테스트가 초록으로 남는다(실제로 확인함, 보고 참조).
    const resolvers: Array<(r: Result<string>) => void> = [];
    (globalThis as { window?: Window }).window = {
      piecepool: {
        readRaw: () => new Promise<Result<string>>((resolve) => resolvers.push(resolve)),
      },
    } as unknown as Window;

    // finally 로 지운다 — 단언이 실패하면 스텁이 다음 테스트로 새서,
    // 진짜 원인 하나가 엉뚱한 실패 여럿으로 번진다.
    try {
      const { openTab, closeTab } = useWorkspace.getState();
      const first = openTab("wiki/a.md", "a");
      closeTab("wiki/a.md");
      const second = openTab("wiki/a.md", "a");

      // 낡은(첫) 요청의 응답이 새(두 번째) 요청보다 늦게 도착한다.
      resolvers[1]({ ok: true, value: "새 본문" });
      resolvers[0]({ ok: true, value: "옛 본문" });
      await Promise.all([first, second]);

      const tabs = useWorkspace.getState().tabs;
      expect(tabs).toHaveLength(1);
      expect(tabs[0].body).toBe("새 본문");
    } finally {
      delete (globalThis as { window?: Window }).window;
    }
  });
});
