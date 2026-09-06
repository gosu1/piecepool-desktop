import type { OnProgress, Vault } from "../../../shared/types.ts";
import type { IngestResult } from "./ingest.ts";

/** 볼트 안 inbox/ 의 단편 메모를 위키로 편입한다. 원본 보관은 없다. */
export async function run(v: Vault, o?: { onProgress?: OnProgress }): Promise<IngestResult> {
  throw new Error("unimplemented: core/agent/tasks/inbox.run");
}
