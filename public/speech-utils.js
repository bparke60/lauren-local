export function splitSpeechChunks(value) {
  const text = String(value || "").trim();
  if (!text) return [];

  const sentences = text
    .split(/(?<=[.!?…])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (sentences.length < 2) return [text];

  const remaining = [...sentences];
  let first = remaining.shift();
  while (
    first.length < 70 &&
    remaining.length &&
    first.length + remaining[0].length + 1 <= 220
  ) {
    first = `${first} ${remaining.shift()}`;
  }

  const chunks = [first];
  let current = "";
  for (const sentence of remaining) {
    if (!current) {
      current = sentence;
      continue;
    }
    if (current.length + sentence.length + 1 <= 300) {
      current = `${current} ${sentence}`;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function stripWakePhrase(value, wakePhrases = ["hey lauren", "lauren"]) {
  const text = String(value || "").trim();
  const phrases = [...wakePhrases]
    .map((phrase) => String(phrase || "").trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  for (const phrase of phrases) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const prefix = new RegExp(`^${escaped}\\b[\\s,.:;!?-]*`, "iu");
    if (prefix.test(text)) return text.replace(prefix, "").trim();
  }
  return text;
}

function speechWords(value) {
  return String(value || "")
    .toLowerCase()
    .match(/[a-z0-9']+/gu) || [];
}

export function isLikelySpeechEcho(transcript, activeSpeech) {
  const heard = speechWords(transcript);
  const spoken = speechWords(activeSpeech);
  if (heard.length < 3 || spoken.length < 3) return false;

  const heardPhrase = heard.join(" ");
  const spokenPhrase = spoken.join(" ");
  if (spokenPhrase.includes(heardPhrase)) return true;

  const spokenWords = new Set(spoken);
  const overlap = heard.filter((word) => spokenWords.has(word)).length / heard.length;
  return heard.length >= 4 && overlap >= 0.75;
}
