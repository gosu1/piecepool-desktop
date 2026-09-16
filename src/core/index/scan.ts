import type { GraphData, LinkRef, NotePath, Vault } from "../../shared/types.ts";
import type { TreeNode } from "../../shared/ipc.ts";
import type { LinkTargets } from "./links.ts";
import { normalizeTitle, parseLinks, resolveLink } from "./links.ts";
import { readTree } from "../vault/tree.ts";
import { readRaw } from "../vault/notes.ts";

/** 파생 캐시다. 지우면 재빌드한다 — 복구 절차가 따로 없다. */
export interface VaultIndex {
  targets: LinkTargets;
  links: LinkRef[];
}

/**
 * 파일명이 곧 제목이다 (옵시디언 규칙).
 *
 * VaultIndex 는 정규화된 제목만 들고 있어 원문을 복구할 수 없다.
 * 그래프 노드의 title 을 위해 필드를 더하는 대신 경로에서 되만든다.
 */
export function titleOf(p: NotePath): string {
  return (p.split("/").pop() ?? p).replace(/\.md$/i, "");
}

/** 트리에서 파일 경로만 평탄화해 뽑는다. */
function flatten(nodes: TreeNode[]): NotePath[] {
  const out: NotePath[] = [];
  for (const n of nodes) {
    if (n.kind === "file") out.push(n.path);
    else if (n.children !== undefined) out.push(...flatten(n.children));
  }
  return out;
}

/**
 * 읽다가 사라졌거나 못 읽는 파일인가.
 *
 * 경로는 방금 readTree 가 나열한 것이다. 그 사이에 지워지거나(ENOENT), 권한이
 * 막거나(EACCES·EPERM), 경로 구성 요소가 그 사이에 모양을 바꾸는(EISDIR·ENOTDIR —
 * 노트가 디렉터리로, 또는 부모 디렉터리가 파일로 바뀌는 경쟁 상황) 일은 실제로 있고,
 * 그 한 장 때문에 그래프 전체가 안 뜨는 쪽이 더 나쁘다. **그 밖의 예외는 우리 버그다**
 * — 삼키면 노트가 아무 신호 없이 그래프에서 사라져 원인까지 거슬러 올라갈 단서가 남지 않는다.
 */
export function isUnreadable(e: unknown): boolean {
  if (typeof e !== "object" || e === null || !("code" in e)) return false;
  const code = (e as { code: unknown }).code;
  return (
    code === "ENOENT" ||
    code === "EACCES" ||
    code === "EPERM" ||
    code === "EISDIR" ||
    code === "ENOTDIR"
  );
}

/**
 * 볼트를 훑어 링크 색인을 만든다.
 *
 * 순회는 readTree 를 그대로 쓴다 — .md 만·숨김 폴더 제외·심볼릭 링크 제외·POSIX 경로가
 * 이미 거기 있다. 같은 규칙을 다시 짜면 두 벌이 조용히 갈라진다.
 */
export async function scanVault(v: Vault): Promise<VaultIndex> {
  const paths = flatten(await readTree(v));

  const titles = new Map<string, NotePath>();
  for (const p of paths) {
    const key = normalizeTitle(titleOf(p));
    // 먼저 들어온 것이 이긴다. 동명 보고는 lint 의 몫이다.
    if (!titles.has(key)) titles.set(key, p);
  }
  const targets: LinkTargets = { titles, files: new Set(paths) };

  const links: LinkRef[] = [];
  for (const p of paths) {
    let body: string;
    try {
      body = await readRaw(v, p);
    } catch (e) {
      // 못 읽는 한 장은 건너뛴다. 그 밖의 예외는 버그 신호라 그대로 올려보낸다.
      if (!isUnreadable(e)) throw e;
      continue;
    }
    for (const ref of parseLinks(p, body)) {
      links.push({ ...ref, resolved: resolveLink(p, ref.to, targets) });
    }
  }

  return { targets, links };
}

export async function saveIndex(v: Vault, ix: VaultIndex): Promise<void> {
  throw new Error("unimplemented: core/index/scan.saveIndex");
}

export async function loadIndex(v: Vault): Promise<VaultIndex | null> {
  throw new Error("unimplemented: core/index/scan.loadIndex");
}

/**
 * 그래프는 링크에서 파생된다. 저장하지 않는다.
 *
 * 방향이 없으므로 A→B 와 B→A 는 같은 엣지다 — 두 선이 겹쳐 굵어 보이면 거짓 신호다.
 */
export function toGraph(ix: VaultIndex): GraphData {
  const nodes = [...ix.targets.files].map((p) => ({ id: p, title: titleOf(p) }));

  const seen = new Set<string>();
  const edges: GraphData["edges"] = [];
  for (const l of ix.links) {
    if (l.resolved === null || l.resolved === l.from) continue;
    // NUL 로 잇는다 — 경로에 들어갈 수 없는 문자라 두 경로가 섞이지 않는다.
    const [a, b] = l.from < l.resolved ? [l.from, l.resolved] : [l.resolved, l.from];
    const key = `${a}\0${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: l.from, target: l.resolved });
  }

  return { nodes, edges };
}
