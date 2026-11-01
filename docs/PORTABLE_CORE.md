# One Lauren, several compatible devices

Lauren's identity and persistent state belong to her core, while the display is a client. The Mac uses a transparent cartoon renderer; a robot screen could show just her face, and a larger display could use her body.

A travel capsule is a versioned snapshot of approved memory, conversations, and SQLite state. It is useful for backup or transfer using a USB drive. Its checksums detect accidental corruption; they are not a signature proving who created the capsule. Private capsules are excluded from Git by default.

The capsule does not contain model weights, an operating system, arbitrary executable code, or saved credentials. A receiving device needs a compatible Lauren host and local inference runtime, plus model weights it can run. A small microcontroller can drive a screen or sensors, but would normally connect to a stronger local core rather than run a 9B/27B model itself.

The next integration boundary is a versioned display/device protocol: state (idle, listening, thinking, speaking), pose and expression, speech level, and scoped action requests with receipts. The current `/api/events/stream` display gateway and separated memory directory provide a starting point. Authentication and a pairing protocol must precede exposing that gateway beyond loopback; this release does not expose it to the network.

## Export and import

From the native menu, select **Export travel capsule…** and choose a destination directory. CLI equivalent:

```sh
node scripts/capsule.mjs export /path/Lauren.lauren.json
node scripts/capsule.mjs import /path/Lauren.lauren.json /empty/memory/folder
LAUREN_DATA_DIR=/empty/memory/folder npm start
```

For native app startup, an ignored `.local/data-home` file can contain the absolute path to the selected memory directory. The local core then uses that folder. Host-specific model selection and voice installation remain local configuration. Do not run two independent copies expecting a capsule to synchronize their changes.

No USB drive was attached or written during development. Export/import was verified with synthetic memory and tasks in disposable test folders.
