import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useIngest } from "../../store/ingest.ts";
import { useWorkspace } from "../../store/workspace.ts";

const field =
  "min-w-0 flex-1 rounded border border-hairline bg-surface px-2 py-1 text-sm text-ink placeholder:text-ink-faint focus:border-primary focus:outline-none";
const primary =
  "rounded bg-primary px-3 py-1 text-sm text-on-primary hover:bg-primary-active disabled:cursor-not-allowed disabled:opacity-50";
const plain =
  "rounded border border-hairline px-3 py-1 text-sm text-ink-2 hover:bg-fill-subtle disabled:cursor-not-allowed disabled:opacity-50";

/** LLM 키 입력. 값은 main 으로만 간다 — 저장 뒤 화면은 "설정됨" 만 안다. */
function KeyForm() {
  const saveKey = useIngest((s) => s.saveKey);
  const [value, setValue] = useState("");
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void saveKey(value);
    setValue("");
  };
  return (
    <form
      onSubmit={onSubmit}
      className="flex items-center gap-2 rounded-md border border-hairline p-3"
    >
      <span className="shrink-0 text-ink-2">Kimi API 키</span>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="sk-…"
        aria-label="Kimi API 키"
        className={field}
      />
      <button type="submit" disabled={value.trim() === ""} className={primary}>
        저장
      </button>
    </form>
  );
}

/** 볼트 git 신원. 봉인 커밋의 작성자가 된다 — 앱이 임의 이름을 지어내지 않는다 (상위 §4.3). */
function IdentityForm() {
  const saveIdentity = useIngest((s) => s.saveIdentity);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void saveIdentity({ name, email });
  };
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-md border border-hairline p-3">
      <p className="text-ink-2">
        볼트에 git 이름이 없어 지금까지의 편집을 내 것으로 분리할 수 없다. 이름을 정하면 시작한다.
      </p>
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="이름"
          aria-label="이름"
          className={field}
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="이메일 (선택)"
          aria-label="이메일"
          className={field}
        />
        <button type="submit" disabled={name.trim() === ""} className={primary}>
          정하기
        </button>
      </div>
    </form>
  );
}

/** 되돌리기 계획 — 파일 단위로 고른다. 그 뒤 손댄 파일은 기본으로 빠져 있다. */
function RestorePanel() {
  const plan = useIngest((s) => s.plan);
  const chosen = useIngest((s) => s.chosen);
  const restoring = useIngest((s) => s.restoring);
  const toggle = useIngest((s) => s.toggle);
  const closePlan = useIngest((s) => s.closePlan);
  const applyRestore = useIngest((s) => s.applyRestore);
  if (plan === null) return null;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-primary p-3">
      <p className="text-ink">
        되돌리기: <span className="text-ink-2">{plan.message}</span>
      </p>
      <ul className="flex flex-col gap-1">
        {plan.paths.map((p) => (
          <li key={p.path} className="flex items-center gap-2">
            <input
              id={`restore-${p.path}`}
              type="checkbox"
              checked={chosen.has(p.path)}
              onChange={() => toggle(p.path)}
            />
            <label htmlFor={`restore-${p.path}`} className="truncate text-ink-2">
              {p.path}
            </label>
            {p.changedSince && (
              <span className="shrink-0 text-xs text-danger">
                그 뒤 직접 수정함 — 되돌리면 그 수정도 사라진다
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void applyRestore()}
          disabled={restoring || chosen.size === 0}
          className={primary}
        >
          {chosen.size}개 되돌리기
        </button>
        <button type="button" onClick={closePlan} disabled={restoring} className={plain}>
          닫기
        </button>
      </div>
    </div>
  );
}

/**
 * 정리 탭의 본문. 볼트 전체 정리를 시작하고, 진행 줄을 보여 주고,
 * 남은 커밋마다 [되돌리기] 를 단다. 상태는 store/ingest.ts 가 쥔다 — 탭을 닫아도 남는다.
 */
export function IngestView() {
  const vault = useWorkspace((s) => s.vault);
  const running = useIngest((s) => s.running);
  const log = useIngest((s) => s.log);
  const commits = useIngest((s) => s.commits);
  const issues = useIngest((s) => s.issues);
  const error = useIngest((s) => s.error);
  const keyReady = useIngest((s) => s.keyReady);
  const identityNeeded = useIngest((s) => s.identityNeeded);
  const start = useIngest((s) => s.start);
  const openPlan = useIngest((s) => s.openPlan);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (useIngest.getState().keyReady === null) void useIngest.getState().init();
  }, []);

  // 새 줄이 오면 끝으로 — 사람이 보는 것은 지금 무엇을 하는가다.
  useEffect(() => {
    const el = logRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [log.length]);

  const canStart = vault !== null && keyReady === true && !running && !identityNeeded;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 text-sm">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => void start()} disabled={!canStart} className={primary}>
          {running ? "정리하는 중…" : "볼트 전체 정리"}
        </button>
        <span className="text-ink-muted">
          아직 정리하지 않은 노트를 날짜순으로 위키에 반영한다. 자료 하나가 커밋 하나다.
        </span>
      </div>

      {keyReady === false && <KeyForm />}
      {identityNeeded && <IdentityForm />}
      {error !== null && <div className="text-danger">{error}</div>}

      <RestorePanel />

      <div
        ref={logRef}
        aria-label="진행"
        className="min-h-0 flex-1 overflow-auto rounded-md border border-hairline bg-surface p-2 font-mono text-xs text-ink-2"
      >
        {log.length === 0 ? (
          <span className="text-ink-faint">아직 돌린 적이 없다.</span>
        ) : (
          log.map((p, i) => (
            <div key={i}>
              <span className="text-ink-faint">{p.step}</span>
              {p.detail !== undefined && <span> {p.detail}</span>}
            </div>
          ))
        )}
      </div>

      {(commits.length > 0 || issues.length > 0) && (
        <div className="flex max-h-56 flex-col gap-1 overflow-auto">
          {commits.map((c) => (
            <div key={c.oid} className="flex items-center gap-2">
              <span className="truncate text-ink">{c.label}</span>
              <span className="shrink-0 text-ink-faint">
                {c.paths.length}개 파일 · {c.oid.slice(0, 8)}
              </span>
              <button
                type="button"
                onClick={() => void openPlan(c.oid)}
                disabled={running}
                className={`${plain} ml-auto shrink-0`}
              >
                되돌리기
              </button>
            </div>
          ))}
          {issues.length > 0 && (
            <div className="text-ink-muted">지적 {issues.length}건 — 진행 줄에 그대로 있다.</div>
          )}
        </div>
      )}
    </div>
  );
}
