# Moonshot 보고 초안 — K3 의 한국어 음절 깨짐 (2026-09-17)

계정 주인이 제출한다. 아래는 영어 초안이고, 숫자는 `README.md` 의 회차 기록에서 왔다.

---

**Subject: kimi-k3 (and kimi-k2.6) corrupt Korean syllables when copying text verbatim — a wrong final consonant is added to open syllables**

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
- `kimi-k2.6` (thinking disabled) on the same 30 notes: 1 spot in prose, but 24/24 in the minimal copy test below. Gemini flash-lite on the same notes: 0.

**Minimal reproduction (run 2026-09-17, 6 requests, ~$0.03).** System prompt: `Return JSON { "quotes": string[] } where each item is a phrase copied exactly, character for character, from the user message. Copy all sentences.` User message (8 short Korean sentences): `졸업: 내년 6월. 해법을 찾는다. 아무도 안 잰 것 같다. 운동을 시작했다. 자르면 정확도 0.72. 파운데이션 모델을 쓴다. 이해도가 높다. 싱클레어의 인생이 나와 닮았다.` — `reasoning_effort: "low"`, strict `json_schema`.

Result: **48 of 48 copied sentences were altered** (6 runs × 8 sentences; not one came back verbatim). Every run broke the same words, each in a slightly different way:

| Input      | Outputs observed (count)                   |
| ---------- | ------------------------------------------ |
| 내년       | 난년 (1) · 낮년 (1) · 남년 (2) · 난 (1)    |
| 해법을     | 핫법을 (1) · 핸법을 (2) · 핵법을 (2)       |
| 아무도     | 아묻도 (5)                                 |
| 운동을     | 울동을 (5)                                 |
| 자르면     | 자륵면 (2) · 자륾면 (1) · 자륨면 (2)       |
| 파운데이션 | 파울데이션 (5)                             |
| 이해도가   | 이핻도가 (2) · 이핸도가 (1)                |
| 싱클레어   | 싱큌레어 (1) · 싱큝레어 (1) · 싱큸레어 (1) |

The pattern is consistent with the model emitting a wrong final-consonant (jamo) code point for an open syllable — the initial consonant and usually the vowel survive, the final consonant is invented. The same request against `kimi-k2.6` (thinking disabled, 3 runs) shows the same defect: **24 of 24 altered** (낸년, 핵법을, 아묻도, 울동을, 자륾면, 파울데이션, 이핵도가, 싱클르어). So this is not specific to K3's reasoning path; it looks like a tokenizer/decoding issue for Hangul in the Kimi family. (In our full pipeline k2.6 produced far fewer corrupted words in prose — 1 vs 13–23 — but that is because it paraphrases instead of copying; when asked to copy, it breaks the same way.)

**Why it matters.** Any product that lets K3 write Korean prose ships visible typos in ~40–70% of pages. We have added a client-side repair step (restoring corrupted words from the source vocabulary, gated by a Korean spell-checker), but this is a decoding-level defect that only the model side can fix properly.

Happy to share the full logs (request/response pairs) on request.

---

제출 뒤 응답이 오면 `README.md` "실험 뒤 할 것" 1번에 적는다.
