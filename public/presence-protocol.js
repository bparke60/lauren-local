export const emotions = Object.freeze([
  "calm",
  "happy",
  "curious",
  "concerned",
  "confused",
  "focused",
  "playful",
  "surprised",
]);
export const forms = Object.freeze(["auto", "body", "face", "eyes"]);

// The local model can select appearance; it cannot request native commands.
export function parsePresenceReply(raw) {
  let presence = null;
  const text = String(raw || "")
    .replace(/\[\[presence:([^\]]*)\]\]/gi, (_, value) => {
      const fields = value.toLowerCase().split(":").map((field) => field.trim());
      const [emotion, form] = fields;
      if (fields.length === 2 && emotions.includes(emotion) && forms.includes(form))
        presence = { emotion, form };
      return "";
    })
    .trim();
  return { text, presence };
}

export function normalizePresence(value) {
  return {
    emotion: emotions.includes(value?.emotion) ? value.emotion : "calm",
    form: forms.includes(value?.form) ? value.form : "auto",
  };
}

export function glitchAmount(now, changedAt, impactAt, reducedMotion = false) {
  if (reducedMotion) return 0;
  const transition = Math.max(0, 1 - (now - changedAt) / 180);
  const impact = Math.max(0, 1 - (now - impactAt) / 130);
  return Math.min(1, Math.max(transition, impact, now % 11000 < 65 ? 0.28 : 0));
}
