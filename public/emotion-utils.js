const EMOTION_RULES = [
  {
    emotion: "angry",
    pattern: /\b(angry|furious|pissed|ridiculous|unacceptable|messed up|hate that|annoying)\b/iu
  },
  {
    emotion: "sad",
    pattern: /\b(sad|sorry|hurt|awful|terrible|unfortunate|heartbreaking|lost|grief|rough)\b/iu
  },
  {
    emotion: "surprised",
    pattern: /\b(wow|whoa|surprising|unexpected|shocked|can't believe|wild|seriously\?)\b/iu
  },
  {
    emotion: "joy",
    pattern: /\b(love that|amazing|awesome|excited|happy|great news|perfect|glad|congrats)\b/iu
  },
  {
    emotion: "confident",
    pattern: /\b(definitely|absolutely|clearly|my take|i think|i'd choose|best move|for sure|no question)\b/iu
  },
  {
    emotion: "curious",
    pattern: /\b(i wonder|interesting|curious|what if|why do you think|tell me more|how come)\b/iu
  },
  {
    emotion: "focused",
    pattern: /\b(first|next|steps?|configure|install|fix|build|calculate|compare|breakdown)\b/iu
  },
  {
    emotion: "warm",
    pattern: /\b(thank|appreciate|i'm here|with you|got you|sounds good|makes sense)\b/iu
  }
];

export function inferResponseEmotion(value, userMessage = "") {
  const text = String(value || "").trim();
  const user = String(userMessage || "").trim();
  if (!text) return "calm";

  for (const rule of EMOTION_RULES) {
    if (rule.pattern.test(text)) return rule.emotion;
  }

  if (/\b(?:lol|lmao|haha|that's funny|you funny|joking|kidding)\b/iu.test(`${user} ${text}`)) {
    return "joy";
  }
  if (/\b(?:thank you|thanks|appreciate|good news|we did it|i got it|that worked|i like|i love)\b/iu.test(user)) {
    return "warm";
  }
  if (/^(?:hey|hi|hello|yo|what'?s up|good (?:morning|afternoon|evening))/iu.test(user)) {
    return "warm";
  }
  if (/\b(?:what do you think|your (?:opinion|take|thoughts)|do you think|would you)\b/iu.test(user)) {
    return "confident";
  }
  if (/\b(?:wow|no way|guess what|can you believe|surpris)\b/iu.test(user)) {
    return "surprised";
  }
  if (/\b(?:sad|hurt|upset|bad day|rough day|died|lost|sorry)\b/iu.test(user)) {
    return "sad";
  }

  if (/[!?]{2,}/u.test(text)) return "surprised";
  if (text.endsWith("?")) return "curious";
  return "calm";
}
