import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Vault } from "../../shared/types.ts";
import type { TreeNode } from "../../shared/ipc.ts";

/**
 * 볼트의 마크다운 트리를 읽는다.
 *
 * 실제 볼트가 .md 수십 장 규모이므로 열 때 한 번에 전부 읽는다.
 * 지연 로딩은 그 규모에 필요 없다(설계 §2).
 */
export async function readTree(v: Vault): Promise<TreeNode[]> {
  return await readDir(v.root, "");
}

async function readDir(absDir: string, relDir: string): Promise<TreeNode[]> {
  const entries = await readdir(absDir, { withFileTypes: true });
  const dirs: TreeNode[] = [];
  const files: TreeNode[] = [];

  for (const e of entries) {
    // 심볼릭 링크는 볼트 밖으로 나가거나 순환할 수 있다 — 따라가지 않는다.
    if (e.isSymbolicLink()) continue;

    // 경로는 POSIX 구분자로 고정한다. NotePath 의 약속이다.
    const rel = relDir ? `${relDir}/${e.name}` : e.name;

    if (e.isDirectory()) {
      // .git · .obsidian · .piecepool — 사용자가 볼 것이 아니다.
      if (e.name.startsWith(".")) continue;
      dirs.push({
        name: e.name,
        path: rel,
        kind: "dir",
        children: await readDir(join(absDir, e.name), rel),
      });
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
      files.push({ name: e.name, path: rel, kind: "file" });
    }
  }

  const byName = (a: TreeNode, b: TreeNode) => a.name.localeCompare(b.name, "ko");
  return [...dirs.sort(byName), ...files.sort(byName)];
}
