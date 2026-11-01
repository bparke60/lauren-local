import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { homeAvailable, assertHomeAvailable } from "../src/home-guard.js";

test("USB-home transfer retains its source, routes startup, and refuses a missing bound home", async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), "lauren-bind-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  for (const name of ["scripts", "src", "data"]) await mkdir(path.join(folder, name));
  for (const name of ["scripts/usb-home.mjs", "scripts/home-env.mjs", "src/capsule.js", "src/home-guard.js"])
    await copyFile(new URL("../" + name, import.meta.url), path.join(folder, name));
  await writeFile(path.join(folder, "package.json"), '{"type":"module"}');
  const source = path.join(folder, "data", "memory.json");
  await writeFile(source, JSON.stringify({ facts: [{ text: "Synthetic memory" }] }));
  const target = path.join(folder, "USB home with spaces");
  const run = promisify(execFile);
  const options = { cwd: folder, env: { ...process.env, LAUREN_DATA_DIR: "", LAUREN_HOME_ID: "" } };
  await run(process.execPath, ["scripts/usb-home.mjs", "bind", target], options);
  assert.equal(await readFile(source, "utf8"), await readFile(path.join(target, "memory.json"), "utf8"));
  const binding = JSON.parse(await readFile(path.join(folder, ".local/home-binding.json"), "utf8"));
  assert.equal(homeAvailable(target, binding.id), true);
  const startup = await run(process.execPath, ["scripts/home-env.mjs"], options);
  assert.deepEqual(startup.stdout.split("\0"), [target, binding.id, ""]);
  await rename(target, target + " disconnected");
  await assert.rejects(run(process.execPath, ["scripts/home-env.mjs"], options), /disconnected/);
  await assert.rejects(run(process.execPath, ["scripts/usb-home.mjs", "bind", path.join(folder, "other")], options), /disconnected/);
  await assert.rejects(stat(path.join(folder, "other")), { code: "ENOENT" });
});

test("a bound home requires its exact marker rather than falling back to another folder", async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), "lauren-guard-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  assert.equal(homeAvailable(folder, "identity"), false);
  await writeFile(
    path.join(folder, ".lauren-home.json"),
    JSON.stringify({ format: "lauren-home", version: 1, id: "other" }),
  );
  assert.throws(() => assertHomeAvailable(folder, "identity"), /disconnected/);
  assert.equal(homeAvailable(folder, null), true);
});

test("a real bound core stops when its home disappears and does not recreate it", async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), "lauren-removal-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const home = path.join(folder, "home");
  await mkdir(home);
  await writeFile(
    path.join(home, ".lauren-home.json"),
    JSON.stringify({ format: "lauren-home", version: 1, id: "test-identity" }),
  );
  const reservation = createServer();
  await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: {
      ...process.env,
      PORT: String(port),
      LAUREN_DATA_DIR: home,
      LAUREN_HOME_ID: "test-identity",
      LAUREN_VOICE_PYTHON: path.join(folder, "no-voice"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise((resolve) =>
    child.once("exit", (code) => resolve(code)),
  );
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Bound core startup timed out")),
        8000,
      );
      child.stdout.on("data", (data) => {
        if (data.toString().includes("Lauren Local running")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(Error("Core exited at startup: " + code));
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    const health = await (
      await fetch(`http://127.0.0.1:${port}/api/health`)
    ).json();
    assert.equal(health.homeId, "test-identity");
    await rename(home, path.join(folder, "disconnected-home"));
    let timer;
    await Promise.race([
      exited,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("Core kept running without its home")),
          8000,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    await assert.rejects(stat(home), { code: "ENOENT" });
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await exited;
    }
  }
});
