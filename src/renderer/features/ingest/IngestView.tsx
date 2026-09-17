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

/**
 * LLM 키 입력. 값은 main 으로만 간다 — 저장 뒤 화면은 "설정됨" 만 안다.
 * 과금을 앱이 맡는 방식(구독)이 정해지면 이 칸은 사라진다. 그때까지의 자리다.
 */
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

/** 카드 첫 문장. 정리 전에는 남은 장수, 정리 중에는 지금 처리 중인 것. */
function Headline() {
  const pending = useIngest((s) => s.pending);
  const running = useIngest((s) => s.running);
  const current = useIngest((s) => s.current);
  if (running) return <span className="text-ink">정리하는 중 · {current ?? "준비"}</span>;
  if (pending === null) return <span className="text-ink-muted">세는 중…</span>;
  if (pending === 0) return <span className="text-ink">모든 노트가 위키에 반영돼 있다.</span>;
  return <span className="text-ink">노트 {pending}장이 아직 위키에 없다.</span>;
}

/**
 * 정리 탭의 본문 — 개발자용 화면이다. 디자인은 뒤에 따로 입힌다.
 * 상태는 store/ingest.ts 가 쥔다 — 탭을 닫아도 남는다.
 */
export function IngestView() {
  const vault = useWorkspace((s) => s.vault);
  const running = useIngest((s) => s.running);
  const log = useIngest((s) => s.log);
  const commits = useIngest((s) => s.commits);
  const issues = useIngest((s) => s.issues);
  const error = useIngest((s) => s.error);
  const keyReady = useIngest((s) => s.keyReady);
  const start = useIngest((s) => s.start);
  const openPlan = useIngest((s) => s.openPlan);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void useIngest.getState().init();
  }, [vault?.root]);

  // 새 줄이 오면 끝으로 — 펼쳐 놓았을 때 사람이 보는 것은 지금 무엇을 하는가다.
  useEffect(() => {
    const el = logRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [log.length]);

  const canStart = vault !== null && keyReady === true && !running;
  // 위키를 한 장도 안 바꾼 커밋(상태 파일만)은 되돌릴 것이 없다 — 목록에서 뺀다.
  const shown = commits.filter((c) => c.paths.some((p) => p.startsWith("wiki/")));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 text-sm">
      <div className="flex flex-col gap-2 rounded-md border border-hairline p-3">
        <Headline />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void start()}
            disabled={!canStart}
            className={primary}
          >
            정리하기
          </button>
          <span className="text-ink-muted">
            아직 위키에 없는 노트를 날짜순으로 반영한다. 노트 하나가 커밋 하나다.
          </span>
        </div>
      </div>

      {keyReady === false && <KeyForm />}
      {error !== null && <div className="text-danger">{error}</div>}

      <RestorePanel />

      {shown.length > 0 && (
        <div className="flex max-h-56 flex-col gap-1 overflow-auto">
          {shown.map((c) => (
            <div key={c.oid} className="flex items-center gap-2">
              <span className="truncate text-ink">{c.label}</span>
              <span className="shrink-0 text-ink-faint">
                {c.paths.filter((p) => p.startsWith("wiki/")).length}장 · {c.oid.slice(0, 8)}
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
        </div>
      )}

      <details className="min-h-0 flex-1 overflow-hidden">
        <summary className="cursor-pointer text-ink-muted">
          자세히{issues.length > 0 ? ` · 지적 ${issues.length}건` : ""}
        </summary>
        <div
          ref={logRef}
          aria-label="진행"
          className="mt-2 max-h-80 overflow-auto rounded-md border border-hairline bg-surface p-2 font-mono text-xs text-ink-2"
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
      </details>
    </div>
  );
}
