import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/local-core.js";
import { exportCapsule, importCapsule } from "../src/capsule.js";

test("a travel capsule preserves memory and SQLite state without model weights", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lauren-capsule-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const data = path.join(dir, "data");
  await mkdir(data);
  await writeFile(
    path.join(data, "memory.json"),
    JSON.stringify({ facts: [{ text: "Study AI" }] }),
  );
  const store = new Store(path.join(data, "lauren.sqlite"));
  store.saveList("Read", ["Chapter one"]);
  store.addJob("A task in progress", "2000-01-01");
  store.claim();
  const file = path.join(dir, "Travel.lauren.json");
  await exportCapsule(data, file, path.join(dir, "scratch"));
  const capsule = JSON.parse(await readFile(file, "utf8"));
  assert.equal(capsule.requires.modelWeightsIncluded, false);
  const imported = path.join(dir, "imported");
  await importCapsule(file, imported);
  const next = new Store(path.join(imported, "lauren.sqlite"));
  assert.equal(next.lists()[0].title, "Read");
  assert.equal(next.jobs()[0].status, "interrupted");
  assert.equal(
    JSON.parse(await readFile(path.join(imported, "memory.json"), "utf8"))
      .facts[0].text,
    "Study AI",
  );
  next.close();
  store.close();
});
test("corrupt or unexpected capsule contents are rejected before import", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lauren-capsule-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, "bad.json"),
    destination = path.join(dir, "new");
  const capsule = {
    format: "lauren-travel-capsule",
    version: 1,
    files: {
      "memory.json": { encoding: "base64", sha256: "wrong", content: "e30=" },
    },
  };
  await writeFile(source, JSON.stringify(capsule));
  await assert.rejects(importCapsule(source, destination), /integrity/);
  capsule.files = { "../outside": {} };
  await writeFile(source, JSON.stringify(capsule));
  await assert.rejects(importCapsule(source, destination), /Unexpected/);
});
