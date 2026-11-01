import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  rm,
  mkdtemp,
  rename,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportCapsule, importCapsule } from "../src/capsule.js";
import { assertHomeAvailable } from "../src/home-guard.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [action, target] = process.argv.slice(2);
try {
  if (action !== "bind" || !target)
    throw Error(
      "Usage: node scripts/usb-home.mjs bind /Volumes/Drive/LaurenHome",
    );
  let current = process.env.LAUREN_DATA_DIR;
  if (!current)
    try {
      current = (
        await readFile(path.join(root, ".local/data-home"), "utf8")
      ).trim();
    } catch {}
  current = current || path.join(root, "data");
  let currentId = process.env.LAUREN_HOME_ID;
  if (!currentId)
    try {
      currentId = (
        await readFile(path.join(root, ".local/home-id"), "utf8")
      ).trim();
    } catch {}
  try {
    const binding = JSON.parse(
      await readFile(path.join(root, ".local/home-binding.json"), "utf8"),
    );
    current = binding.directory;
    currentId = binding.id;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  assertHomeAvailable(current, currentId);
  const destination = path.resolve(target);
  if (destination === path.resolve(current))
    throw Error("Choose a separate empty home folder.");
  await mkdir(destination, { recursive: true });
  if ((await readdir(destination)).length)
    throw Error("Choose an empty folder. Existing files will not be replaced.");
  const scratch = path.join(root, "work");
  await mkdir(scratch, { recursive: true });
  const temporary = await mkdtemp(path.join(scratch, "bind-home-"));
  try {
    const capsule = path.join(temporary, "transfer.lauren.json");
    await exportCapsule(current, capsule, scratch);
    await importCapsule(capsule, destination);
    const id = randomUUID();
    await writeFile(
      path.join(destination, ".lauren-home.json"),
      JSON.stringify({
        format: "lauren-home",
        version: 1,
        id,
        assistant: "Lauren",
      }) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    await mkdir(path.join(root, ".local"), { recursive: true });
    const binding = { directory: destination, id };
    await writeFile(
      path.join(root, ".local/home-binding.json.tmp"),
      JSON.stringify(binding) + "\n",
      { mode: 0o600 },
    );
    await rename(
      path.join(root, ".local/home-binding.json.tmp"),
      path.join(root, ".local/home-binding.json"),
    );
    // The source is retained as a backup. The new folder becomes the active home.
    console.log(
      JSON.stringify({
        ok: true,
        directory: destination,
        id,
        backupRetained: true,
      }),
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
