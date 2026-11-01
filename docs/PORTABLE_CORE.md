# One Lauren, several compatible devices

Lauren's identity and persistent state belong to her core, while the display is a client. The Mac uses a transparent construct renderer; a robot screen could show just her face, and a larger display could use her body.

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

## Bound USB-C home

The native menu’s **Make a USB-C drive Lauren’s home…** accepts an empty folder on an external volume. It stops its own core before taking a capsule snapshot, imports that snapshot into the selected folder, writes a unique `.lauren-home.json` identity marker, and saves the host’s private `.local/home-binding.json`. The source stays as a backup. Host-specific model weights and voice installation stay on the Mac.

Both the startup script and core validate the expected marker. The core checks every 500 ms and exits if the folder disappears or the marker changes. The native host hides the character, clears its display, and stops listening when the drive is absent. With the host app still running, reconnecting the matching folder at the same path restarts the core and display. Starting Lauren with the drive absent waits for that home; it does not fall back to a new memory directory. The separate LM Studio engine may remain running.

The menu prevents binding while a conversation is active and requires the app to own its core. A running background task is interrupted when the core stops, and must be reviewed/retried on return. The CLI `node scripts/usb-home.mjs bind /Volumes/Drive/LaurenHome` performs the state transfer only; stop any core yourself before using it. The CLI also supports disposable folders for tests; the menu enforces external-volume selection.

Quit Lauren, then eject through macOS before removing a drive to avoid losing writes or corrupting the filesystem. Removal detection is a lifecycle feature, not a guarantee against unsafe physical removal. Capsules remain useful backups. The marker identifies a home; it is not encryption or authentication. Keep private state off a public repository.

No USB drive was attached or written during development. Export/import and missing-home exit were verified with synthetic state in disposable folders, including a real subprocess whose home was renamed to simulate removal. Actual USB eject/reconnect and filesystem durability remain unverified.
