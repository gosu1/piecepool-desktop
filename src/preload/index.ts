// OWNER: 7단계 — electron contextBridge 를 설치한 뒤 채운다.

/**
 * 이 파일이 앱의 공격 표면 전체다.
 *
 * renderer 는 contextIsolation 으로 Node 접근이 차단돼 있고
 * 여기서 화이트리스트로 열어준 것만 쓸 수 있다.
 * fs 를 통째로 노출하면 격리가 무의미해진다 —
 * 경로 검증은 반드시 core/vault/paths.ts 에 둔다.
 */
export function exposeApi(): void {
  throw new Error("unimplemented: preload/index.exposeApi");
}
