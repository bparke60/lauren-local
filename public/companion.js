import {
  resolvedForm,
  faceFrame,
  displayCaption,
  cartoonPose,
  atlasCrop,
  headCrop,
} from "./presence-utils.js";
const $ = (selector) => document.querySelector(selector);
const canvas = $("#sprite"),
  context = canvas.getContext("2d", { willReadFrequently: true }),
  root = $("#presence");
const native = window.webkit?.messageHandlers?.lauren;
const atlas = new Image();
atlas.src = "/assets/lauren-cartoon-atlas-v1.png";
const heads = new Image();
heads.src = "/assets/lauren-cartoon-heads-v1.png";
let reaction = null,
  reactionUntil = 0,
  petTimer;
let state = "idle",
  preference = localStorage.getItem("laurenForm") || "auto",
  voice = localStorage.getItem("laurenVoiceEnabled") !== "0";
let computerQuiet = 0;
let lastInteraction = performance.now(),
  vx = 20,
  vy = 0,
  dragged = false,
  impactAt = -1000;
let pending = false,
  audio,
  audioUrl,
  audioContext,
  analyser,
  level = 0,
  hideCaption,
  sendGeneration = 0;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
function bridge(action, extra = {}) {
  native?.postMessage({ action, ...extra });
}
function setState(next) {
  state = next;
  root.dataset.state = next;
  bridge("activity", {
    busy: ["listening", "thinking", "speaking"].includes(next),
  });
}
function caption(text, duration = 7000) {
  clearTimeout(hideCaption);
  $("#caption").textContent = displayCaption(text);
  $("#bubble").hidden = !text;
  if (duration > 0)
    hideCaption = setTimeout(() => {
      $("#bubble").hidden = true;
    }, duration);
}
$("#dismiss").onclick = () => {
  $("#bubble").hidden = true;
};
async function post(path, data) {
  const result = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  const payload = result.headers
    .get("content-type")
    ?.includes("application/json")
    ? await result.json()
    : null;
  if (!result.ok)
    throw Error(payload?.error || "Lauren could not finish that request.");
  return payload || result;
}
function stopAudio() {
  if (audio) {
    audio.pause();
    audio.src = "";
    audio = null;
  }
  if (audioUrl) {
    URL.revokeObjectURL(audioUrl);
    audioUrl = null;
  }
  analyser = null;
  level = 0;
}
async function speak(text, generation) {
  if (!voice) {
    setState("idle");
    return;
  }
  try {
    const response = await post("/api/lauren/speak", { text });
    const blob = await response.blob();
    if (generation !== sendGeneration || !voice) return;
    audioUrl = URL.createObjectURL(blob);
    audio = new Audio(audioUrl);
    audioContext ||= new AudioContext();
    await audioContext.resume();
    const source = audioContext.createMediaElementSource(audio);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(audioContext.destination);
    audio.onended = () => {
      stopAudio();
      setState("idle");
      hideCaption = setTimeout(() => {
        $("#bubble").hidden = true;
      }, 5000);
    };
    setState("speaking");
    await audio.play();
  } catch {
    if (generation !== sendGeneration) return;
    stopAudio();
    setState("idle");
    caption(
      "My local voice is unavailable. The reply is saved in the conversation history.",
      6500,
    );
  }
}
async function send(text) {
  text = String(text || "").trim();
  if (!text || pending) return;
  const generation = ++sendGeneration;
  pending = true;
  lastInteraction = performance.now();
  stopAudio();
  setState("thinking");
  caption("Thinking…", 0);
  try {
    const result = await post("/api/lauren/chat", {
      message: text,
      sessionId: "desktop-local",
    });
    if (generation !== sendGeneration) return;
    caption(result.text, voice ? 0 : 14000);
    await speak(result.speechText || result.text, generation);
  } catch (error) {
    setState("idle");
    caption(error.message, 9000);
  } finally {
    pending = false;
  }
}
function listen() {
  lastInteraction = performance.now();
  if (pending) {
    caption("I’m still working on that. Give me a moment.");
    return;
  }
  stopAudio();
  setState("idle");
  audioContext ||= new AudioContext();
  audioContext.resume().catch(() => {});
  if (native) bridge("listen");
  else
    caption(
      "Open the Lauren Mac app to talk on device. Browser cloud speech is disabled.",
      9000,
    );
}
window.laurenHeard = (text) => send(text);
window.laurenSpeechState = (next) => {
  if (next === "listening") {
    stopAudio();
    setState("listening");
    caption("Listening…", 0);
  } else if (next === "idle" && state === "listening") {
    setState("idle");
    caption("", 0);
  }
};
window.laurenTranscript = (text) => caption(text, 0);
window.laurenSpeechError = (text) => {
  setState("idle");
  caption(text, 10000);
};
window.laurenMotion = (motion) => {
  computerQuiet = motion.quietFor || 0;
  vx = motion.vx || 0;
  vy = motion.vy || 0;
  dragged = Boolean(motion.dragging);
  if (motion.bounce) {
    impactAt = performance.now();
    reaction = "poke";
    reactionUntil = performance.now() + 650;
  }
};
window.laurenPreference = (value) => {
  if (value.form) {
    preference = value.form;
    localStorage.setItem("laurenForm", preference);
  }
  if (typeof value.voice === "boolean") {
    voice = value.voice;
    localStorage.setItem("laurenVoiceEnabled", voice ? "1" : "0");
    if (!voice) {
      stopAudio();
      if (state === "speaking") setState("idle");
    }
  }
  if (value.hint) {
    $("#hint").hidden = false;
    setTimeout(() => {
      $("#hint").hidden = true;
    }, 5500);
  }
};
window.laurenHitTest = (x, y) => {
  for (const id of ["#bubble", "#browserMenu"]) {
    const node = $(id);
    if (node.hidden) continue;
    const r = node.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  const r = canvas.getBoundingClientRect();
  if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return false;
  try {
    return (
      context.getImageData(
        Math.floor(((x - r.left) / r.width) * canvas.width),
        Math.floor(((y - r.top) / r.height) * canvas.height),
        1,
        1,
      ).data[3] > 65
    );
  } catch {
    return false;
  }
};
let pointerStart,
  moved = false;
$("#character").onpointerdown = (event) => {
  if (event.button !== 0 || !window.laurenHitTest(event.clientX, event.clientY))
    return;
  event.preventDefault();
  event.currentTarget.setPointerCapture(event.pointerId);
  pointerStart = { x: event.screenX, y: event.screenY };
  moved = false;
  lastInteraction = performance.now();
  clearTimeout(petTimer);
  reaction = "poke";
  reactionUntil = performance.now() + 650;
  bridge("dragStart");
};
$("#character").onpointermove = (event) => {
  if (
    pointerStart &&
    Math.hypot(event.screenX - pointerStart.x, event.screenY - pointerStart.y) >
      5
  )
    moved = true;
};
$("#character").onpointerup = () => {
  if (!pointerStart) return;
  bridge("dragEnd");
  pointerStart = null;
  if (!moved) listen();
};
$("#character").onpointerenter = () => {
  clearTimeout(petTimer);
  if (state === "idle")
    petTimer = setTimeout(() => {
      reaction = "pet";
      reactionUntil = performance.now() + 2200;
      lastInteraction = performance.now();
    }, 900);
};
$("#character").onpointerleave = () => clearTimeout(petTimer);
$("#character").onpointercancel = () => {
  pointerStart = null;
  bridge("dragEnd");
};
$("#character").onclick = (event) => {
  if (event.detail === 0) listen();
};
$("#character").oncontextmenu = (event) => {
  event.preventDefault();
  if (native) bridge("menu");
  else $("#browserMenu").hidden = !$("#browserMenu").hidden;
};
$("#browserMenu").onclick = (event) => {
  const action = event.target.dataset.action;
  if (action === "listen") listen();
  if (action === "form")
    window.laurenPreference({ form: preference === "body" ? "face" : "body" });
  if (action === "voice") window.laurenPreference({ voice: !voice });
  $("#browserMenu").hidden = true;
};
const samples = new Uint8Array(128);
let lastPaint = 0;
function render(now) {
  requestAnimationFrame(render);
  if (now - lastPaint < 33) return;
  lastPaint = now;
  context.clearRect(0, 0, canvas.width, canvas.height);
  const quietFor = Math.min(now - lastInteraction, computerQuiet);
  const form = resolvedForm(preference, state, quietFor);
  root.dataset.form = form;
  if (analyser) {
    analyser.getByteTimeDomainData(samples);
    level = Math.sqrt(
      samples.reduce((sum, n) => sum + ((n - 128) / 128) ** 2, 0) /
        samples.length,
    );
  }
  const motion = reducedMotion.matches ? 0 : Math.sin(now / 1100) * 7;
  const tilt = reducedMotion.matches
    ? 0
    : Math.max(-0.13, Math.min(0.13, vx * 0.001)) +
      Math.sin(now / 2200) * 0.025;
  const impact = reducedMotion.matches
    ? 0
    : Math.max(0, 1 - (now - impactAt) / 340);
  context.save();
  context.translate(330, 430 + motion);
  context.rotate(dragged ? tilt * 2 : tilt);
  context.scale(1 + impact * 0.07, 1 - impact * 0.09);
  const art = form === "face" ? heads : atlas;
  if (art.complete && art.naturalWidth) {
    const pose = cartoonPose({
      state,
      now,
      quietFor,
      dragging: dragged,
      reaction: now < reactionUntil ? reaction : null,
    });
    root.dataset.pose = String(pose);
    const crop =
      form === "face"
        ? headCrop(faceFrame(state, now, level, quietFor))
        : atlasCrop(pose);
    const scale = form === "face" ? 0.86 : 1.65;
    const w = crop.w * scale,
      h = crop.h * scale;
    if (vx < -8 && form === "body" && ![8, 10].includes(pose))
      context.scale(-1, 1);
    context.imageSmoothingEnabled = true;
    context.drawImage(
      art,
      crop.x,
      crop.y,
      crop.w,
      crop.h,
      -w / 2,
      -h / 2 + 25,
      w,
      h,
    );
  }
  context.restore();
}
requestAnimationFrame(render);
bridge("ready", { form: preference, voice });
