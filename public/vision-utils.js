// Pure helpers for the local object-detection layer. No DOM, no MediaPipe —
// everything here is testable with plain data.

const LABEL_ALIASES = new Map([
  ["people", "person"],
  ["persons", "person"],
  ["humans", "person"],
  ["human", "person"],
  ["guys", "person"],
  ["dogs", "dog"],
  ["puppies", "dog"],
  ["puppy", "dog"],
  ["cats", "cat"],
  ["kittens", "cat"],
  ["kitten", "cat"],
  ["couches", "couch"],
  ["sofa", "couch"],
  ["sofas", "couch"],
  ["tvs", "tv"],
  ["televisions", "tv"],
  ["television", "tv"],
  ["screens", "tv"],
  ["phones", "cell phone"],
  ["phone", "cell phone"],
  ["cellphones", "cell phone"],
  ["cellphone", "cell phone"],
  ["laptops", "laptop"],
  ["computers", "laptop"],
  ["computer", "laptop"],
  ["bottles", "bottle"],
  ["cups", "cup"],
  ["mugs", "cup"],
  ["mug", "cup"],
  ["chairs", "chair"],
  ["books", "book"],
  ["plants", "potted plant"],
  ["plant", "potted plant"],
  ["beds", "bed"],
  ["remotes", "remote"],
  ["keyboards", "keyboard"],
  ["backpacks", "backpack"],
  ["bags", "backpack"],
  ["hands", "hand"],
  ["arms", "hand"],
  ["arm", "hand"]
]);

export function canonicalLabel(word) {
  const cleaned = String(word || "").toLowerCase().trim();
  return LABEL_ALIASES.get(cleaned) || cleaned;
}

// Collapse raw per-frame detections into stable label counts. Detections from
// several recent frames are merged by majority so one flickering frame does
// not change the answer: a label counts if it appears in at least half the
// sampled frames, and its count is the median across those frames.
export function stableCounts(frames) {
  if (!frames?.length) return new Map();

  const labelFrameCounts = new Map();
  for (const frame of frames) {
    const counts = new Map();
    for (const label of frame) {
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    for (const [label, count] of counts) {
      if (!labelFrameCounts.has(label)) labelFrameCounts.set(label, []);
      labelFrameCounts.get(label).push(count);
    }
  }

  const stable = new Map();
  const minFrames = Math.max(1, Math.ceil(frames.length / 2));
  for (const [label, counts] of labelFrameCounts) {
    if (counts.length < minFrames) continue;
    const sorted = [...counts].sort((a, b) => a - b);
    stable.set(label, sorted[Math.floor(sorted.length / 2)]);
  }
  return stable;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function countPhrase(count, label) {
  const word = count <= 10 ? NUMBER_WORDS[count] : String(count);
  if (label === "person") return count === 1 ? "one person" : `${word} people`;
  const plural = count === 1 ? label : `${label}s`;
  return `${word} ${plural}`;
}

// Turn stable counts into one natural spoken sentence.
export function describeScene(counts) {
  if (!counts?.size) return "";
  const parts = [...counts.entries()]
    .sort((a, b) => (a[0] === "person" ? -1 : b[0] === "person" ? 1 : b[1] - a[1]))
    .map(([label, count]) => countPhrase(count, label));

  if (parts.length === 1) return `I can see ${parts[0]}.`;
  if (parts.length === 2) return `I can see ${parts[0]} and ${parts[1]}.`;
  const last = parts.pop();
  return `I can see ${parts.join(", ")}, and ${last}.`;
}

// Detect "how many X ..." style questions answerable from local detections.
// Returns the canonical label to count, or null.
const COUNT_STOP_WORDS = new Set([
  "are", "is", "am", "do", "does", "did", "can", "could", "you", "u", "in",
  "on", "around", "behind", "near", "there", "here", "right", "now", "with",
  "at", "we", "i", "me", "us", "the", "this", "that", "holding", "up"
]);

export function getCountQuery(value) {
  const command = String(value || "").toLowerCase().replace(/[?.!]+$/gu, "").trim();
  const match = command.match(/\b(?:how many|count(?: the)?|number of)\s+(.+)$/u);
  if (!match) return null;

  // Keep words up to the first stop word: "people are behind me" -> "people".
  const words = [];
  for (const word of match[1].split(/\s+/u)) {
    if (COUNT_STOP_WORDS.has(word)) break;
    words.push(word);
    if (words.length === 2) break; // longest label is two words ("cell phone")
  }
  if (!words.length) return null;
  if (words[0] === "finger" || words[0] === "fingers") return null;

  return canonicalLabel(words.join(" ")) || canonicalLabel(words[0]);
}

export function describeCount(label, count) {
  if (count === 0) {
    const plural = label === "person" ? "people" : `${label}s`;
    return `I don't see any ${plural} right now.`;
  }
  return `I can see ${countPhrase(count, label)}.`;
}

// Map a detection box from video-intrinsic coordinates onto a display box
// rendered with object-fit: cover (the video is scaled up and cropped).
export function mapBoxToCover(box, videoWidth, videoHeight, displayWidth, displayHeight) {
  if (!videoWidth || !videoHeight || !displayWidth || !displayHeight) return null;
  const scale = Math.max(displayWidth / videoWidth, displayHeight / videoHeight);
  const offsetX = (videoWidth * scale - displayWidth) / 2;
  const offsetY = (videoHeight * scale - displayHeight) / 2;
  return {
    x: box.originX * scale - offsetX,
    y: box.originY * scale - offsetY,
    width: box.width * scale,
    height: box.height * scale
  };
}

export function mirrorBoxHorizontally(box, displayWidth) {
  if (!box || !displayWidth) return box;
  return {
    ...box,
    x: displayWidth - box.x - box.width
  };
}
