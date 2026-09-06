// OWNER: A — 억제 등록/해제 API 미확정, 2단계에서 확정
import type { Vault } from "../../shared/types.ts";

/**
 * 외부 편집을 감지해 인덱스를 증분 갱신한다.
 *
 * 자기 쓰기 루프를 막아야 한다 — 에이전트의 write_note 도 외부 편집과 똑같은
 * fs 이벤트를 낸다. 억제는 경로+내용 해시로 대조한다. 시간 기반 억제창은
 * 느린 디스크에서 새므로, 해시가 일치할 때만 무시하고 다르면 외부 편집으로 본다.
 */
export function watchVault(v: Vault): { close(): void } {
  throw new Error("unimplemented: core/index/watch.watchVault");
}
