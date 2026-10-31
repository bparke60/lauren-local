# Validation

Development host: M4 MacBook Air, 24 GB memory, macOS 26.5.1, Node 26.3.1, LM Studio 0.4.28+2. Initial validation date: October 31, 2026.

- `npm test`: 45 tests pass, including new coverage of list persistence, job recovery, cancellation/retry, tool execution receipts, blocked offline tools, response truncation, worker failure, recursive scheduling prevention, and public-URL guards.
- `npm run check`: JavaScript syntax checks pass.
- `npm run build:mac`: native wrapper compiles and signs locally; the companion window opens and displays the original animated face and controls. A fresh app launch started the Node/voice services; Command-Q stopped both.
- Real local Kokoro synthesis returned valid 24 kHz mono PCM WAV audio. This verifies synthesis, not user preference for the voice.
- A real queued research task read LM Studio documentation, saved a two-item list, and persisted a source-linked report in 31.9 seconds. The workspace displayed it as completed.
- HTTP checks rejected foreign Host and Origin values (403) and invalid jobs (400).
- Real public search returned source links, and direct fetching of LM Studio's headless documentation returned usable text. Search availability varies; Wikipedia fallback is labeled.
- Real Qwen3.5 9B saved the equivalent two-item list in 21.2 seconds. This is a single run per model, not a controlled statistical benchmark.
- Real Qwen3.8 27B tool call saved a two-item list and returned its confirmation in 78.1 seconds with 8K context and one slot. The earlier 32K/four-slot load caused high memory pressure during a longer prompt and was reduced.

On-device microphone recognition is implemented but has not been verified with the user's spoken input. Local camera model inference in the inherited full-screen prototype has not been validated in this migration. Background model output remains probabilistic and requires review; passing unit tests does not establish research accuracy.
