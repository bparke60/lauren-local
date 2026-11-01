# Lauren Local

<img src="docs/images/companion-v3.png" alt="Lauren as a transparent cartoon desktop spirit" width="300">

Lauren is a local AI companion that wanders around your Mac as a small 2D character. There is no permanent chat box, window frame, or opaque panel. Her purple-haired, brown-skinned cartoon design keeps the original Lauren identity while adding an expressive full-body sprite set.

Built by BJ Parker while studying for a Bachelor of Science in Artificial Intelligence at UNC Charlotte. The project explores local model inference, desktop presence, tool execution, persistence, speech, scheduling, and portable assistant state.

## Desktop presence

- **Drift and bounce:** borderless, transparent, floating overlay with gentle wandering, edge reflection, and drag-and-release movement. Transparent pixels let clicks reach the apps underneath.
- **Cartoon poses:** resting, looking around, sleeping, happy, bashful, startled, smirking, peeking, playing with an orb, working at a tiny laptop, and tumbling when dragged. These are pose changes plus movement, not a fully rigged walk cycle.
- **Face or body:** choose Automatic, Full body, or Floating face in the menu. Automatic moves to a close-up for conversation and a resting head when the pointer has been quiet. Mouse activity timing stays inside the renderer; it is not conversation or model data.
- **Click to talk:** on-device English speech recognition starts after an explicit click. After about 1.6 seconds of silence, the recognized utterance goes to the local model and Lauren speaks through Kokoro. Hovering and petting never start the microphone.
- **Quiet controls:** right-click Lauren, or use the menu bar icon, for movement, voice, tasks, an occasional typed message, and a travel capsule. Captions appear temporarily when needed.
- **Reduced motion:** the macOS accessibility preference pauses wandering and ambient animation.

The local core retains saved conversations, approved memory, SQLite lists, one-time background jobs, optional public-web research, model switching, and run timings. Its model tools cannot send messages, publish, buy things, delete files, or execute shell commands.

## Quick start

Requirements: Apple Silicon Mac, LM Studio with a downloaded model, Node.js 24 or newer, and Xcode Command Line Tools to build the native shell.

1. Enable LM Studio's loopback server on **port 5321**.
2. Download or select `qwen/qwen3.5-9b` (default). The workspace also supports the installed `qwen/qwen3.8-27b` and `google/gemma-4-e2b` models.
3. Build and launch:

```sh
npm run build:mac
open Lauren.app
```

Keep `Lauren.app` beside `src/` and `scripts/`. It starts the local core. The menu bar keeps the app running if the character is hidden. Quit stops the core if this app started it. A pre-existing core is reused.

Use **Open tasks & lists** from Lauren's menu or visit `http://127.0.0.1:4327/tasks.html`. The browser preview at `/companion.html` shows the character, but moving across the actual desktop and on-device microphone capture require the native app. The previous full-screen camera prototype remains available at `/` as a separate legacy display.

The app is signed ad hoc for development, rather than notarized for distribution. Speech and microphone permission are requested only when you start a conversation; there is no automatic microphone activation on launch or hover. Availability of Apple's on-device speech recognizer varies by Mac setup. A typed-message option remains in the menu if speech is unavailable.

## Portable assistant state

Choose **Export travel capsule…** and select a folder, including a mounted USB drive. A `.lauren.json` capsule contains approved memory, conversations, and a consistent SQLite snapshot of lists, jobs, and run history. It excludes API credentials, host-specific configuration, model weights, and logs.

On another compatible host:

```sh
node scripts/capsule.mjs import /path/Lauren.lauren.json /empty/LaurenMemory
LAUREN_DATA_DIR=/empty/LaurenMemory npm start
```

Import requires an empty destination and validates file names and hashes before writing. A task running during export appears as interrupted on the receiving core, requiring review and retry. Use one active core at a time; a capsule is a snapshot, not live synchronization.

A USB drive carries her state. It does not make an arbitrary phone, robot, television, or microcontroller able to run a language model. Each target needs a compatible client/runtime and enough compute, or a connection to an always-on local model host. See [portable architecture](docs/PORTABLE_CORE.md).

## Choosing a model on a 24 GB Mac

The initial development machine is an M4 MacBook Air with 24 GB unified memory. Its 4-bit Qwen3.8 27B occupies about 15 GiB when loaded with an 8K context and one inference slot. It can work, but leaves limited memory for other apps and speech. A real two-step list-save request took **78.1 seconds** during development. This is a single end-to-end measurement, not a formal throughput benchmark.

The equivalent two-step request took **21.2 seconds** with Qwen3.5 9B. The default is the already-installed 4-bit Qwen3.5 9B for everyday interaction. Choose 27B in the workspace when you prefer the larger model. Switching unloads Lauren's previous model and loads the chosen one with an 8K context and one slot. Current timings are visible in the workspace. See [validation](docs/VALIDATION.md) for what was actually tested.

## Local voice setup

The existing development machine reuses its installed Kokoro environment through an ignored `.local/voice-python` file. For a fresh machine:

```sh
python3.11 -m venv voice-service/.venv
voice-service/.venv/bin/pip install kokoro soundfile
brew install espeak-ng
```

Download/cache the `hexgrad/Kokoro-82M` model and chosen voice once with an internet connection before running Lauren in offline mode. The server starts the voice process with `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1`; missing assets produce a visible text-only state. No cloud TTS or browser voice fallback is used. Use **Speak replies locally** in the companion menu to enable or mute speech. The default is Kokoro `af_heart`; it is a different voice from the previous cloud version.

## Research and background work

Offline is the default. Enable web access per task or turn it on for chat in the workspace. Inference stays local, but search queries and page requests necessarily go to the websites being researched. Do not enable web research for prompts containing information you do not want included in searches.

Search uses DuckDuckGo's HTML interface; it can be rate limited or challenged. A clearly labeled Wikipedia-only fallback is available. A supplied source URL can be read directly. This is basic research support, not exhaustive coverage of news or scholarly literature. Retrieved pages are untrusted evidence and cannot expand the tool set.

Jobs run only while the Mac is awake and the server is running. Missed queued tasks run on return. A task interrupted mid-run is marked **interrupted** for review and explicit retry, preventing silent replays of partially completed work. Closing the companion window keeps the app running; shutting down or sleeping the Mac stops computation. No login item, system daemon, or sleep-prevention setting is installed automatically.

## Development

```sh
npm run check
npm test
npm run test:mac
```

The JavaScript core uses Node built-ins and has no npm runtime dependencies. The full-screen camera prototype uses self-hosted MediaPipe assets; run `bash scripts/setup-vision.sh` once to download them on a fresh clone. They are already installed on the development machine and are excluded from Git. See [third-party notices](THIRD_PARTY_NOTICES.md). Models and voice weights are separate downloads governed by their own licenses.

- [Cartoon art direction and exact generation prompt](docs/ART_DIRECTION.md)
- [Architecture and data boundaries](docs/ARCHITECTURE.md)
- [Validation and limitations](docs/VALIDATION.md)
- [Portfolio and next milestones](docs/PORTFOLIO.md)

Personal conversations, memory, SQLite databases, logs, generated media, local configuration, and application binaries are ignored by Git. Never add `data/` or `.local/` to a public repository.
