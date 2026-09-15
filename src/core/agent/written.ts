// FROZEN: 파일 전체 — A↔B 경계면 (0단계 설계 §3.2·§8)
import type { NotePath } from "../../shared/types.ts";

/**
 * 이번 작업이 실제로 건드린 경로 집합. 커밋 단위의 1급 개념이다.
 *
 * run 단위로 만들어 인자로 흘린다. 전역 인스턴스를 export 하지 않는다 —
 * 인제스트와 수확이 겹치는 순간 두 작업의 경로가 섞여서
 * 한쪽 커밋이 다른 쪽 파일까지 add 하게 된다.
 */
export class Written {
  #paths = new Set<NotePath>();

  add(p: NotePath): void {
    this.#paths.add(p);
  }

  paths(): NotePath[] {
    return [...this.#paths];
  }
}
