// 항목 하나 = 커밋 하나. 엔진 앞뒤의 git 안전망 (상위 §4.3, 3단계).
//
//   저장소 준비 → 사용자 편집 봉인 → [엔진이 쓴다] → 쓴 경로만 커밋
//
// 봉인은 항목마다 한다 — 앞 항목을 정리하는 60초 사이에 사용자가 옵시디언으로 고친 것이
// 다음 에이전트 커밋에 섞이면 되돌리기가 그 편집을 삼킨다.
import { userInfo } from "node:os";
import { AGENT_AUTHOR, type NotePath, type OnProgress, type Vault } from "../../shared/types.ts";
import type { IngestResult } from "../agent/tasks/ingest.ts";
import type { Written } from "../agent/written.ts";
import { commit, sealUserEdits } from "../git/commit.ts";
import { dirtyPaths, ensureRepo, readIdentity, writeIdentity } from "../git/repo.ts";

/**
 * 저장소를 준비하고 사용자 편집을 봉인한다. 돌려주는 것은 준비 중 새로 쓴 경로(.gitignore)다.
 * `ours` 는 봉인에서 뺀다 — 호출부가 방금 쓴 세션 로그 같은 것으로, 에이전트 커밋에 들어갈 몫이다.
 */
export async function prepareRepo(
  v: Vault,
  ours: NotePath[] = [],
  onProgress?: OnProgress,
): Promise<NotePath[]> {
  const created = await ensureRepo(v);
  const except = [...created, ...ours];
  if ((await dirtyPaths(v)).some((p) => !except.includes(p))) {
    // 봉인 커밋의 작성자. 볼트에 git 이름이 있으면 그것, 없으면 OS 계정 이름을 적어 둔다 —
    // 사용자에게 "git 이름" 을 묻는 것은 내부 사정을 들이미는 것이다 (2026-09-17 결정).
    // 지어낸 이름이 아니라 이 컴퓨터에 로그인한 그 이름이다.
    let who = await readIdentity(v);
    if (who === null) {
      who = { name: userInfo().username, email: "" };
      await writeIdentity(v, who);
    }
    const oid = await sealUserEdits(v, who, except);
    if (oid)
      onProgress?.({
        step: "봉인",
        detail: `사용자 편집을 ${who.name} 명의로 분리 (${oid.slice(0, 8)})`,
      });
  }
  return created;
}

/** 쓴 경로 ∪ 호출부의 경로를 커밋 하나로. 아무것도 안 썼으면 커밋하지 않는다. */
export async function commitWritten(
  v: Vault,
  message: string,
  written: Written,
  extraPaths: NotePath[],
  onProgress?: OnProgress,
): Promise<IngestResult> {
  // 엔진이 아무것도 안 썼으면 커밋하지 않는다 — 호출부의 경로만으로 커밋을 만들지 않는다.
  if (written.paths().length === 0) return { written: [], commitOid: "" };
  const paths = [...new Set([...written.paths(), ...extraPaths])];
  const commitOid = await commit(v, paths, AGENT_AUTHOR, message);
  onProgress?.({ step: "커밋", detail: `${paths.length}개 경로 (${commitOid.slice(0, 8)})` });
  return { written: paths, commitOid };
}
