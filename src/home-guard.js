import { readFileSync } from "node:fs";
import path from "node:path";

export function homeAvailable(directory, id) {
  if (!id) return true;
  try {
    const marker = JSON.parse(
      readFileSync(path.join(directory, ".lauren-home.json"), "utf8"),
    );
    return (
      marker.format === "lauren-home" &&
      marker.version === 1 &&
      marker.id === id
    );
  } catch {
    return false;
  }
}
export function assertHomeAvailable(directory, id) {
  if (!homeAvailable(directory, id))
    throw Error(
      "Lauren’s USB home is disconnected or does not match. Reconnect it to start her.",
    );
}
