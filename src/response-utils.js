const PRIVATE_USE_CITATION = /\p{Co}*cite\p{Co}*turn\d+[a-z0-9_-]*\p{Co}*/giu;
const BRACKET_CITATION = /【[^】]*(?:†|source)[^】]*】/giu;
const MARKDOWN_LINK = /\[([^\]]+)\]\(\s*(?:https?:\/\/|www\.)[^)]+\)/giu;
const URL = /\(?\b(?:https?:\/\/|www\.)[^\s<>)\]}]+[)\]}]?/giu;
const DOMAIN_PATTERN = String.raw`(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:sports|news|com|app|dev|edu|gov|net|org|ai|co|io|tv)`;
const BARE_DOMAIN = new RegExp(
  String.raw`\(?\b${DOMAIN_PATTERN}(?:\/[^\s<>)\]}]*)?(?:\?[^\s<>)\]}]*)?\)?`,
  "giu"
);
const DOMAIN_ONLY = new RegExp(String.raw`^\s*${DOMAIN_PATTERN}\s*$`, "iu");

export function sanitizeAssistantText(value) {
  return String(value || "")
    .replace(MARKDOWN_LINK, (_match, label) => DOMAIN_ONLY.test(label) ? "" : label)
    .replace(PRIVATE_USE_CITATION, "")
    .replace(BRACKET_CITATION, "")
    .replace(/\bcite\s*turn\d+[a-z0-9_-]*/giu, "")
    .replace(/\bturn\d+(?:search|news|view)\d*\b/giu, "")
    .replace(URL, "")
    .replace(BARE_DOMAIN, "")
    .replace(/^\s*[-*_]{3,}\s*$/gmu, "")
    .replace(/^#{1,6}\s*/gmu, "")
    .replace(/\*{1,2}([^*\n]+)\*{1,2}/gu, "$1")
    .replace(/_{1,2}([^_\n]+)_{1,2}/gu, "$1")
    .replace(/\(\s*\)/gu, "")
    .replace(/[ \t]+([,.;!?])/gu, "$1")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function toSpeechText(value) {
  return sanitizeAssistantText(value)
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gmu, "")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\s*\n+\s*/gu, " ")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

export function getReplyWordLimit(message) {
  const request = String(message || "");
  const requestsDetail =
    /\b(detailed|in detail|deep dive|full breakdown|comprehensive|thorough|step[- ]by[- ]step|walk me through|explain fully)\b/iu.test(request);
  const requestsInstructions =
    /\b(how (?:do|can|should) i|instructions?|steps?|tutorial|set(?:ting)? up|install|configure|build|repair|fix|troubleshoot)\b/iu.test(request);
  const requestsExplanationOrList =
    /\b(explain|describe|list|name all|tell me (?:all|each|every|where|how)|where (?:are|is|can|do)|locations?|ways?|reasons?|examples?)\b/iu.test(request);
  const asksMultipleParts =
    /\b(?:and|also|plus)\b/iu.test(request) &&
    /\b(?:what|when|where|which|who|why|how|tell|explain|list)\b/iu.test(request);
  const safetySensitive =
    /\b(emergency|urgent|overdose|poison(?:ed|ing)?|suicid(?:e|al)|self[- ]harm|chest pain|can't breathe|cannot breathe|bleeding|fire|gas leak|electric shock|medical|legal)\b/iu.test(request);
  const requestsOpinion =
    /\b(what do you think|what's your (?:opinion|take)|what is your (?:opinion|take)|your thoughts|how do you feel|do you think|would you|which (?:one )?would you|is it worth|who (?:won|lost)|good idea|bad idea)\b/iu.test(request);

  if (
    requestsDetail ||
    requestsInstructions ||
    requestsExplanationOrList ||
    asksMultipleParts ||
    safetySensitive
  ) return 300;
  if (requestsOpinion) return 120;
  return 55;
}

export function getReplyTokenLimit(message) {
  const wordLimit = getReplyWordLimit(message);
  if (wordLimit >= 300) return 700;
  if (wordLimit >= 120) return 360;
  return 180;
}

export function limitConversationalReply(value, maxWords = 55) {
  const text = sanitizeAssistantText(value);
  if (!text) return "";
  const maxSentences = maxWords <= 55 ? 3 : Number.POSITIVE_INFINITY;

  const sentences = text
    .split(/(?<=[.!?…])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length > 1 && !/[.!?…]["')\]]*$/u.test(sentences.at(-1))) {
    sentences.pop();
  }

  const kept = [];
  let words = 0;
  for (const sentence of sentences) {
    if (kept.length >= maxSentences) break;
    const sentenceWords = sentence.split(/\s+/u).filter(Boolean).length;
    if (kept.length && words + sentenceWords > maxWords) break;
    // A complete thought matters more than an exact count. The model prompt is
    // the primary length control; this guard only drops later excess sentences.
    if (!kept.length && sentenceWords > maxWords) return sentence;
    kept.push(sentence);
    words += sentenceWords;
  }

  return (kept.join(" ") || text).trim();
}
