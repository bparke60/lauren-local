// The atlas layout is measured from the generated art; unequal vertical crops
// retain complete feet/hands instead of clipping sprites to an assumed grid.
export function atlasCrop(frame) {
  if (!Number.isInteger(frame) || frame < 0 || frame > 11)
    throw Error("Unknown Lauren pose");
  const col = frame % 4,
    row = Math.floor(frame / 4);
  if (row === 0) return { x: col * 362, y: 0, w: 362, h: 388 };
  if (row === 1)
    return { x: col * 362, y: 388, w: 362, h: col === 0 ? 390 : 360 };
  return {
    x: col * 362,
    y: col === 0 ? 778 : 748,
    w: 362,
    h: col === 0 ? 308 : 338,
  };
}
export function headCrop(frame) {
  if (!Number.isInteger(frame) || frame < 0 || frame > 3)
    throw Error("Unknown Lauren face");
  return {
    x: (frame % 2) * 627,
    y: Math.floor(frame / 2) * 627,
    w: 627,
    h: 627,
  };
}
export function resolvedForm(preference, state, quietFor = 0) {
  if (preference === "face" || preference === "body") return preference;
  return ["listening", "speaking"].includes(state) || quietFor > 90_000
    ? "face"
    : "body";
}
export function cartoonPose({
  state,
  now = 0,
  quietFor = 0,
  dragging = false,
  reaction = null,
}) {
  if (dragging) return 11;
  if (reaction === "pet") return 5;
  if (reaction === "poke") return 6;
  if (state === "thinking") return 10;
  if (state === "listening") return 3;
  if (state === "speaking") return Math.floor(now / 350) % 2 ? 4 : 7;
  if (state === "sleeping" || quietFor > 60_000) return 2;
  const cycle = Math.floor(now / 6000) % 8;
  return [1, 1, 3, 0, 1, 9, 7, 8][cycle];
}
export function faceFrame(state, now, level = 0, quietFor = 0) {
  if (state === "sleeping" || (quietFor > 90_000 && state === "idle")) return 1;
  if (state === "speaking") return level > 0.08 ? 2 : 3;
  return now % 4600 < 150 ? 1 : 0;
}
export function displayCaption(text, limit = 1400) {
  return String(text || "")
    .replace(/\[\[.*?\]\]/g, "")
    .trim()
    .slice(0, limit);
}
