import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  mkdtemp,
} from "node:fs/promises";
import path from "node:path";

const allowed = new Set(["memory.json", "conversations.json", "lauren.sqlite"]);
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");

export async function exportCapsule(dataDir, destination, scratchRoot) {
  await mkdir(scratchRoot, { recursive: true });
  const temporary = await mkdtemp(path.join(scratchRoot, "capsule-"));
  try {
    const files = {};
    for (const name of ["memory.json", "conversations.json"]) {
      let data;
      try {
        data = await readFile(path.join(dataDir, name));
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      JSON.parse(data.toString("utf8"));
      files[name] = {
        encoding: "base64",
        sha256: hash(data),
        content: data.toString("base64"),
      };
    }
    const source = path.join(dataDir, "lauren.sqlite");
    try {
      await readFile(source);
      const database = new DatabaseSync(source, { readOnly: true });
      const backup = path.join(temporary, "lauren.sqlite");
      try {
        database.prepare("VACUUM INTO ?").run(backup);
      } finally {
        database.close();
      }
      const data = await readFile(backup);
      files["lauren.sqlite"] = {
        encoding: "base64",
        sha256: hash(data),
        content: data.toString("base64"),
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const capsule = {
      format: "lauren-travel-capsule",
      version: 1,
      assistant: "Lauren",
      appearance: "lauren-construct-v1",
      createdAt: new Date().toISOString(),
      requires: {
        compatibleHost: true,
        localModelRuntime: true,
        modelWeightsIncluded: false,
      },
      files,
    };
    // A capsule never overwrites an existing file, even if a file picker reuses a name.
    await writeFile(destination, JSON.stringify(capsule, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    return {
      path: destination,
      files: Object.keys(files),
      modelWeightsIncluded: false,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function importCapsule(source, destination) {
  const raw = await readFile(source);
  if (raw.length > 64 * 1024 * 1024)
    throw Error("Capsule exceeds the 64 MB limit.");
  const capsule = JSON.parse(raw.toString("utf8"));
  if (
    capsule.format !== "lauren-travel-capsule" ||
    capsule.version !== 1 ||
    !capsule.files ||
    Array.isArray(capsule.files)
  )
    throw Error("Unsupported Lauren capsule.");
  const contents = [];
  for (const [name, entry] of Object.entries(capsule.files)) {
    if (
      !allowed.has(name) ||
      entry.encoding !== "base64" ||
      typeof entry.content !== "string"
    )
      throw Error("Unexpected capsule content.");
    const data = Buffer.from(entry.content, "base64");
    if (hash(data) !== entry.sha256)
      throw Error("Capsule integrity check failed.");
    if (name.endsWith(".json")) JSON.parse(data.toString("utf8"));
    if (
      name.endsWith(".sqlite") &&
      data.subarray(0, 16).toString() !== "SQLite format 3\0"
    )
      throw Error("Invalid assistant database.");
    contents.push([name, data]);
  }
  if (!contents.length) throw Error("Capsule contains no assistant state.");
  await mkdir(destination, { recursive: true });
  if ((await readdir(destination)).length)
    throw Error(
      "Import into an empty data folder to preserve existing memory.",
    );
  // All validation happens before writing any state.
  const written = [];
  try {
    for (const [name, data] of contents) {
      await writeFile(path.join(destination, name), data, {
        flag: "wx",
        mode: 0o600,
      });
      written.push(name);
    }
  } catch (error) {
    for (const name of written)
      await rm(path.join(destination, name), { force: true });
    throw error;
  }
  return { path: destination, files: contents.map(([name]) => name) };
}
