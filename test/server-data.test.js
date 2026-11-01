import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

test("an alternate memory home routes real API writes into the selected folder", async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), "lauren-home-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const root = fileURLToPath(new URL("../", import.meta.url));
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      LAUREN_DATA_DIR: folder,
      LAUREN_VOICE_PYTHON: path.join(folder, "no-voice-runtime"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Isolated core did not start")),
        8000,
      );
      child.stdout.on("data", (data) => {
        if (data.toString().includes("Lauren Local running")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(Error("Core exited: " + code));
      });
    });
    const response = await fetch(`http://127.0.0.1:${port}/api/memory/facts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Portable test memory" }),
    });
    assert.equal(response.status, 201);
    const saved = JSON.parse(
      await readFile(path.join(folder, "memory.json"), "utf8"),
    );
    assert.equal(saved.facts[0].text, "Portable test memory");
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
    });
  }
});
