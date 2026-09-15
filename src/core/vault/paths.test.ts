import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveInVault } from "./paths.ts";
import type { Vault } from "../../shared/types.ts";

/** 픽스처 볼트. wiki/a.md 하나가 들어 있다. */
async function fixture(): Promise<Vault> {
  const root = await mkdtemp(join(tmpdir(), "pp-paths-"));
  await mkdir(join(root, "wiki"), { recursive: true });
  await writeFile(join(root, "wiki", "a.md"), "# a", "utf8");
  return { root, agentWriteRoot: "wiki" };
}

describe("resolveInVault", () => {
  it("볼트 안 경로는 절대경로로 돌려준다", async () => {
    const v = await fixture();
    const got = await resolveInVault(v, "wiki/a.md");
    expect(got.endsWith(join("wiki", "a.md"))).toBe(true);
  });

  it("../ 로 볼트를 벗어나면 막는다", async () => {
    const v = await fixture();
    await expect(resolveInVault(v, "../secret.md")).rejects.toMatchObject({
      kind: "path_escape",
    });
  });

  it("중간에 낀 ../ 도 막는다", async () => {
    const v = await fixture();
    await expect(resolveInVault(v, "wiki/../../secret.md")).rejects.toMatchObject({
      kind: "path_escape",
    });
  });

  it("절대경로를 그대로 주면 막는다", async () => {
    const v = await fixture();
    const outside = resolve(v.root, "..", "secret.md");
    await expect(resolveInVault(v, outside)).rejects.toMatchObject({
      kind: "path_escape",
    });
  });

  it("루트 자신은 파일이 아니므로 막는다", async () => {
    const v = await fixture();
    await expect(resolveInVault(v, "")).rejects.toMatchObject({
      kind: "path_escape",
    });
  });

  it("볼트 안 심링크가 볼트 밖을 가리키면 막는다", async () => {
    const v = await fixture();
    // 볼트 밖에 폴더를 만들고 볼트 안에서 그리로 링크를 건다.
    // 문자열 검사만으로는 통과하는 경로다 — 두 번째 realpath 가 잡아야 한다.
    const outside = await mkdtemp(join(tmpdir(), "pp-outside-"));
    await writeFile(join(outside, "secret.md"), "비밀", "utf8");
    await symlink(outside, join(v.root, "wiki", "out"), "junction");

    await expect(resolveInVault(v, "wiki/out/secret.md")).rejects.toMatchObject({
      kind: "path_escape",
    });
  });

  it("볼트 루트가 심링크여도 정상 경로를 막지 않는다", async () => {
    const real = await fixture();
    // 루트를 realpath 로 펴지 않으면, 편 대상과 안 편 루트를 비교하게 되어
    // 멀쩡한 경로가 탈출로 오판된다(macOS 의 /tmp → /private/tmp 가 그 경우다).
    const linked = join(await mkdtemp(join(tmpdir(), "pp-link-")), "vault");
    await symlink(real.root, linked, "junction");

    const v = { root: linked, agentWriteRoot: "wiki" };
    await expect(resolveInVault(v, "wiki/a.md")).resolves.toContain("a.md");
  });

  it(".. 로 시작하는 파일명은 탈출이 아니다", async () => {
    const v = await fixture();
    await writeFile(join(v.root, "wiki", "..foo.md"), "# foo", "utf8");
    await expect(resolveInVault(v, "wiki/..foo.md")).resolves.toContain("..foo.md");
  });
});
