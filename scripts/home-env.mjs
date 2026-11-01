import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertHomeAvailable } from "../src/home-guard.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  const config = JSON.parse(
    await readFile(path.join(root, ".local/home-binding.json"), "utf8"),
  );
  if (typeof config.directory !== "string" || typeof config.id !== "string")
    throw Error("Invalid home binding.");
  assertHomeAvailable(config.directory, config.id);
  // Null-separated output avoids shell evaluation or newline-sensitive paths.
  process.stdout.write(config.directory + "\0" + config.id + "\0");
} catch (error) {
  if (error.code !== "ENOENT") {
    console.error(error.message);
    process.exitCode = 1;
  }
}
