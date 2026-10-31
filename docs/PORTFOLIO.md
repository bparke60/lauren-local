# Portfolio story and next milestones

## How to describe this work

**Lauren Local — a desktop AI companion with a local model, persistent task execution, and an animated interface.** Built while studying for a BS in Artificial Intelligence at UNC Charlotte.

A suitable project description after personally reviewing and understanding the code:

> Built a macOS AI companion backed by local language models, with a bounded function-calling loop, SQLite task persistence, optional public-web research, local speech output, and a movable animated interface. Added recovery behavior and automated tests for task execution and offline boundaries, and measured model latency on a 24 GB M4 laptop.

Do not describe this as training a foundation model or inventing Qwen. The engineering contribution is the system around existing models. AI-assisted implementation should be disclosed honestly when discussing the development process.

## Demonstration

1. Show the companion running outside LM Studio.
2. Ask it to save a study list and show the persisted list in the workspace.
3. Queue a source-based research task with web access enabled; hide the companion window and return to the report.
4. Restart Lauren and show saved state.
5. Explain why a 27B model and a 9B model behave differently on the same machine, using measured run history.
6. Walk through one failure test and its recovery behavior.

## Next milestones

1. **Evaluation dataset:** version realistic tasks, evaluate list persistence and source support, and measure median/p95 latency rather than relying on one run.
2. **Research quality:** pluggable search provider, source-date extraction, citations tied to claims, and a reviewed research report format.
3. **Desktop presence:** transparent sprite mode, docking and idle movement, accessibility labels, keyboard shortcut, and a signed/notarized app package. Keep face identity consistent while improving rendering.
4. **Voice:** user-approved local voice selection and more consistent on-device transcription across Macs; test interruption behavior and echo cancellation before continuous conversation.
5. **Personal knowledge:** opt-in folder indexing with local embeddings, document provenance, and deletion propagation.
6. **Real actions:** individually scoped file/calendar/GitHub integrations with explicit previews and execution receipts. Do not give a background model unrestricted terminal access.
7. **Always available:** a separate always-on local machine if unattended operation must continue while the laptop sleeps; the current laptop remains the interface.

A strong portfolio comes from shipping, evaluating, explaining tradeoffs, and improving this one system through meaningful commits.
