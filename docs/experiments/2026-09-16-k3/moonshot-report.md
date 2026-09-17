# Moonshot 보고 초안 — K3 의 한국어 음절 깨짐 (2026-09-17)

계정 주인이 제출한다. 아래는 영어 초안이고, 숫자는 `README.md` 의 회차 기록에서 왔다.

---

**Subject: kimi-k3 corrupts Korean syllables when copying text verbatim (adds a final consonant / changes a vowel)**

**Model:** `kimi-k3` via `https://api.moonshot.ai/v1/chat/completions`, OpenAI-compatible.
**Request shape:** `response_format: { type: "json_schema", strict: true }`, `reasoning_effort: "low"` (also reproduced with `"high"`), `max_tokens: 32000`, no temperature override (as documented). Korean system prompt (~7k tokens) + Korean user content (~10–20k tokens).

**Symptom.** When the model copies a Korean phrase from the input into its JSON output, single syllables come out altered — usually an extra final consonant (받침) on an open syllable, sometimes a changed vowel. The rest of the word is intact, and the same word breaks the same way across independent requests.

| Input (Korean) | Output             | What changed                               |
| -------------- | ------------------ | ------------------------------------------ |
| 해법           | 핵법 / 핵볍 / 합법 | 해 → 핵/합 (final consonant added)         |
| 내년           | 낸년 / 남년        | 내 → 낸/남                                 |
| 아무도         | 아묵도 / 아묘도    | 무 → 묵 (final added) / 묘 (vowel changed) |
| 운동           | 욵동 / 울동        | 운 → 욵/울 (final consonant changed)       |
| 자르면         | 자륵면 / 자륾면    | 르 → 륵/륾                                 |
| 이해도         | 이핻도             | 해 → 핻                                    |
| 파운데이션     | 파울데어븐         | two syllables changed                      |
| 싱클레어       | 싱클클어           | 레 → 클                                    |

**Frequency.** In our pipeline (notes → wiki, 30–86 Korean notes per run):

- Per run of 30 notes, 13–23 corrupted words in generated prose, plus 9–19 verbatim quotes rejected by our exact-match check for the same reason.
- On 18 real user notes: 7 of 10 sampled pages contained at least one corrupted word (17 spots total).
- `reasoning_effort: "high"` did not change the rate (17 spots / 36 pages).
- `kimi-k2.6` (thinking disabled) on the same 30 notes: 1 spot. Gemini flash-lite on the same notes: 0.

**Reproduction.** A single-turn request that asks the model to quote the input verbatim reproduces it. For example, with system prompt "Return JSON `{ \"quote\": string }` where `quote` is a phrase copied exactly from the user message" and user message containing `졸업: 내년 6월. 해법을 찾는다.`, we observed `"quote": "졸업: 낸년 6월"` and `"해법을" → "핵법을"` across runs (not deterministic; roughly one word in ten of copied text).

**Why it matters.** Any product that lets K3 write Korean prose ships visible typos in ~40–70% of pages. We have added a client-side repair step (restoring corrupted words from the source vocabulary, gated by a Korean spell-checker), but this is a decoding-level defect that only the model side can fix properly.

Happy to share the full logs (request/response pairs) on request.

---

제출 뒤 응답이 오면 `README.md` "실험 뒤 할 것" 1번에 적는다.
