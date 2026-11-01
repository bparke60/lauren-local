import { exportCapsule, importCapsule } from "../src/capsule.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [action, first, second] = process.argv.slice(2);
try {
  if (action === "export" && first) {
    let home = process.env.LAUREN_DATA_DIR;
    if (!home) {
      try {
        home = (
          await readFile(path.join(root, ".local/data-home"), "utf8")
        ).trim();
      } catch {}
    }
    console.log(
      JSON.stringify(
        await exportCapsule(
          home || path.join(root, "data"),
          path.resolve(first),
          path.join(root, "work"),
        ),
      ),
    );
  } else if (action === "import" && first && second)
    console.log(
      JSON.stringify(
        await importCapsule(path.resolve(first), path.resolve(second)),
      ),
    );
  else
    throw Error(
      "Usage: node scripts/capsule.mjs export /path/Lauren.lauren.json OR import /path/Lauren.lauren.json /empty/data/folder",
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
