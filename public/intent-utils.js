function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’]/gu, "'")
    .replace(/[?.!]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function withoutPolitePrefix(value) {
  return normalize(value)
    .replace(/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?/u, "")
    .trim();
}

export function getUiCommandIntent(value, { speaking = false } = {}) {
  const command = withoutPolitePrefix(value);

  if (/^(?:stop talking|stop speaking|be quiet|quiet down|shush|hush)$/u.test(command)) return "stop";
  if (speaking && command === "stop") return "stop";
  if (/^(?:clear (?:the )?(?:chat|conversation)|start (?:over|fresh)|new conversation)$/u.test(command)) return "clear";

  if (
    /^(?:(?:turn|switch) (?:the |your )?camera on|turn on (?:the |your )?camera|(?:start|enable) (?:the |your )?camera|camera on)$/u.test(command)
  ) return "camera_on";
  if (
    /^(?:(?:turn|switch) (?:the |your )?camera off|turn off (?:the |your )?camera|(?:stop|disable) (?:the |your )?camera|camera off)$/u.test(command)
  ) return "camera_off";

  if (/^(?:(?:go|enter) (?:into )?full ?screen|make (?:this|your face) full ?screen|full ?screen)$/u.test(command)) {
    return "fullscreen";
  }
  if (/^(?:(?:turn|power|shut) (?:yourself )?off|power down|go to sleep)$/u.test(command)) return "power_off";
  if (/^(?:(?:turn|power) (?:yourself )?on|power up|wake up)$/u.test(command)) return "power_on";
  return null;
}

export function getVisionIntent(value) {
  const command = normalize(value);
  const direct = withoutPolitePrefix(command);

  if (
    /\b(?:how many|count|number of)\b.*\b(?:finger|fingers)\b/u.test(command) ||
    /\b(?:finger|fingers)\b.*\b(?:how many|count|number)\b/u.test(command)
  ) return "finger_count";

  if (
    /\b(?:what (?:am i|is he|is she|are they) holding|what(?:'s| is) (?:this|that) in my hand|identify (?:this|what i(?:'m| am) holding))\b/u.test(command)
  ) return "held_object";

  // Glance questions get answered locally from live object detection (free).
  if (
    /^(?:what (?:am i|are we) looking at|what do you see|what can you see|what(?:'s| is) in front of (?:me|you|us)|what(?:'s| is) behind (?:me|us)|what(?:'s| is) (?:in the background|around (?:me|us|here))|can you see (?:me|this|that))$/u.test(command)
  ) return "scene_glance";

  // Deep looks go to cloud vision for a real description.
  if (
    /^(?:look at|take a look at|scan|analyze|identify|recognize|describe)\s+(?:this|that|the scene|the room|my hand|what i(?:'m| am) showing you|what(?:'s| is) in front of me|what you see)\b/u.test(direct) ||
    /^(?:use|check) (?:the |your )?camera(?: to (?:look at|scan|analyze|identify|recognize).*)?$/u.test(direct)
  ) return "scene";

  return null;
}

export function isCloudStatusQuestion(value) {
  const command = normalize(value);
  return (
    /\bhow much (?:have|did) i (?:spend|spent|use|used).*\b(?:api|cloud)\b/u.test(command) ||
    /\b(?:api|cloud) (?:usage|spending|budget|cost)\b/u.test(command) ||
    /\bmonthly (?:api|cloud) (?:budget|limit|spending)\b/u.test(command)
  );
}
