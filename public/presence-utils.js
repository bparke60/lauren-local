// The atlas layout is measured from the generated art; unequal vertical crops
// retain complete feet/hands instead of clipping sprites to an assumed grid.
export function atlasCrop(frame) {
  if (!Number.isInteger(frame) || frame < 0 || frame > 11)
    throw Error("Unknown Lauren pose");
  const [x, y, right, bottom] = [
    [0, 0, 392, 390], [402, 0, 748, 403],
    [768, 0, 1118, 376], [1134, 0, 1448, 385],
    [0, 390, 420, 752], [428, 403, 730, 742],
    [740, 376, 1134, 744], [1174, 385, 1448, 748],
    [0, 752, 382, 1086], [390, 742, 746, 1086],
    [770, 744, 1100, 1086], [1136, 752, 1448, 1086],
  ][frame];
  return { x, y, w: right - x, h: bottom - y };
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
export function resolvedForm(
  preference,
  state,
  quietFor = 0,
  modelForm = "auto",
  stateAge = Infinity,
) {
  if (["face", "body", "eyes"].includes(preference)) return preference;
  if (state === "listening") return "eyes";
  if (state === "thinking") return stateAge < 2200 ? "eyes" : "body";
  if (["face", "body", "eyes"].includes(modelForm)) return modelForm;
  if (quietFor > 90000) return "eyes";
  return state === "speaking" ? "face" : "body";
}
export function cartoonPose({
  state,
  now = 0,
  quietFor = 0,
  dragging = false,
  reaction = null,
  emotion = "calm",
}) {
  if (dragging) return 11;
  if (reaction === "pet") return 5;
  if (reaction === "poke") return 6;
  if (state === "thinking") return 10;
  if (state === "listening") return 3;
  if (state === "speaking")
    return ["concerned", "confused"].includes(emotion)
      ? 6
      : Math.floor(now / 350) % 2
        ? 4
        : 7;
  const moodPoses = {
    happy: 4,
    curious: 3,
    concerned: 6,
    confused: 3,
    focused: 10,
    playful: 9,
    surprised: 6,
  };
  if (moodPoses[emotion] !== undefined) return moodPoses[emotion];
  if (state === "sleeping" || quietFor > 60_000) return 2;
  const cycle = Math.floor(now / 6000) % 8;
  return [1, 1, 3, 0, 1, 9, 7, 8][cycle];
}
export function faceFrame(
  state,
  now,
  level = 0,
  quietFor = 0,
  emotion = "calm",
) {
  if (state === "sleeping" || (quietFor > 90_000 && state === "idle")) return 1;
  if (state === "speaking")
    return level > 0.08 ? 2 : ["happy", "playful"].includes(emotion) ? 3 : 0;
  if (["happy", "playful"].includes(emotion)) return 3;
  return now % 4600 < 150 ? 1 : 0;
}
export function displayCaption(text, limit = 1400) {
  return String(text || "")
    .replace(/\[\[.*?\]\]/g, "")
    .trim()
    .slice(0, limit);
}
