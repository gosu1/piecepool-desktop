/**
 * 쿼리 세션 탭의 본문.
 *
 * 아직 LLM 이 붙지 않았다 — 배너와 **비활성** 입력창으로 자리만 잡는다(설계 §1.1).
 * 입력창이 자리를 실제로 차지하는 것이 중요하다. 다음 조각에서 `disabled` 를 떼면
 * 레이아웃이 그대로 살아난다.
 *
 * 그래프와 달리 계속 마운트해 두지 않는다 — 지킬 상태(배치·pan/zoom)가 없다(설계 §5).
 */
export function QueryView() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="m-4 rounded-md border border-hairline px-3 py-2 text-sm text-ink-muted">
        LLM 이 아직 연결되지 않았다. 대화는 다음 조각에서 붙는다.
      </div>

      {/* 답변이 쌓일 자리. 지금은 비어 있고, 입력창을 아래로 밀어 두는 일만 한다. */}
      <div className="min-h-0 flex-1" />

      <div className="m-4 flex items-end gap-2 rounded-md border border-hairline p-2">
        <textarea
          disabled
          rows={2}
          placeholder="물어보기…"
          aria-label="질문"
          className="min-w-0 flex-1 resize-none bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none disabled:cursor-not-allowed"
        />
        <button
          type="button"
          disabled
          aria-label="보내기"
          className="grid h-7 w-7 shrink-0 place-items-center rounded text-ink-faint disabled:cursor-not-allowed"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M8 13.5V3M3.5 7.5 8 3l4.5 4.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
