import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * 마지막으로 연 볼트 경로. 앱이 디스크에 남기는 유일한 상태다(상위 §4.1).
 *
 * 경로를 인자로 받는다 — electron 의 app.getPath 를 여기서 부르면
 * vitest 에서 돌릴 수 없다. 실제 경로는 main/ipc.ts 가 넘긴다.
 */
export async function readLastVault(stateFile: string): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(stateFile, "utf8"));
    const last = (parsed as { lastVault?: unknown }).lastVault;
    return typeof last === "string" ? last : null;
  } catch {
    // 파일이 없거나 깨졌으면 기억이 없는 것으로 본다. 기억은 편의일 뿐이다.
    return null;
  }
}

export async function writeLastVault(stateFile: string, root: string): Promise<void> {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify({ lastVault: root }, null, 2), "utf8");
}
