const canvas = document.querySelector("#faceCanvas");
const context = canvas.getContext("2d");
const connectionState = document.querySelector("#connectionState");
const faceState = document.querySelector("#faceState");
const emotionSelect = document.querySelector("#emotionSelect");
const modeSelect = document.querySelector("#modeSelect");
const controls = document.querySelector("#faceControls");
const fullscreenButton = document.querySelector("#fullscreenButton");
const mediaDisplay = document.querySelector("#mediaDisplay");
const embedded = new URLSearchParams(window.location.search).get("embed") === "1";
document.body.classList.toggle("embedded", embedded);
document.documentElement.classList.toggle("embedded", embedded);

const atlas = new Image();
const processedAtlas = document.createElement("canvas");
const atlasContext = processedAtlas.getContext("2d", { willReadFrequently: true });
const columns = 4;
const rows = 3;

const frames = {
  neutral: 0,
  blink: 1,
  listening: 2,
  thinking: 3,
  speechM: 4,
  speechA: 5,
  speechE: 6,
  speechO: 7,
  warm: 8,
  joy: 9,
  sad: 10,
  confident: 11
};

const emotionFrames = {
  calm: frames.neutral,
  warm: frames.warm,
  joy: frames.joy,
  curious: frames.listening,
  focused: frames.thinking,
  surprised: frames.speechO,
  sad: frames.sad,
  angry: frames.sad,
  confident: frames.confident
};

const state = {
  emotion: "calm",
  mode: "sleeping",
  connected: false,
  atlasReady: false,
  hideTimer: null,
  nextBlinkAt: performance.now() + 1800,
  blinkStartedAt: -1000,
  previousFrame: frames.neutral,
  activeFrame: frames.neutral,
  frameChangedAt: performance.now(),
  modeChangedAt: performance.now(),
  speechLevel: 0,
  smoothedSpeechLevel: 0,
  particles: Array.from({ length: 52 }, (_, index) => ({
    x: ((index * 47) % 101) / 100,
    y: ((index * 71) % 103) / 102,
    size: 0.6 + (index % 4) * 0.42,
    speed: 0.35 + (index % 7) * 0.08
  }))
};

function prepareAtlas() {
  processedAtlas.width = atlas.naturalWidth;
  processedAtlas.height = atlas.naturalHeight;
  atlasContext.drawImage(atlas, 0, 0);

  const image = atlasContext.getImageData(0, 0, processedAtlas.width, processedAtlas.height);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const brightness = Math.max(data[index], data[index + 1], data[index + 2]);
    if (brightness <= 7) {
      data[index + 3] = 0;
    } else if (brightness < 30) {
      data[index + 3] = Math.round(data[index + 3] * ((brightness - 7) / 23));
    }
  }
  atlasContext.putImageData(image, 0, 0);
  state.atlasReady = true;
}

atlas.addEventListener("load", prepareAtlas);
atlas.src = "/assets/lauren-anime-sprite-atlas.png";

function resizeCanvas() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(window.innerWidth * ratio);
  canvas.height = Math.round(window.innerHeight * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function setFace(next = {}, publish = false) {
  const emotion = Object.hasOwn(emotionFrames, next.emotion) ? next.emotion : state.emotion;
  const mode = ["idle", "listening", "thinking", "speaking", "sleeping"].includes(next.mode)
    ? next.mode
    : state.mode;
  if (state.mode !== mode) state.modeChangedAt = performance.now();
  state.emotion = emotion;
  state.mode = mode;
  emotionSelect.value = emotion;
  modeSelect.value = mode;
  faceState.textContent = `${mode} · ${emotion}`;

  if (publish) {
    fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "face.state",
        source: "face-display",
        target: "all-displays",
        payload: { emotion, mode }
      })
    }).catch(() => {});
  }
}

function getBlinkFrame(now) {
  if (state.mode === "sleeping") return frames.blink;
  if (now >= state.nextBlinkAt) {
    state.blinkStartedAt = now;
    state.nextBlinkAt = now + 2600 + Math.random() * 3400;
  }
  return now - state.blinkStartedAt < 145 ? frames.blink : null;
}

function chooseFrame(now) {
  const blinkFrame = getBlinkFrame(now);
  if (blinkFrame !== null && state.mode !== "speaking") return blinkFrame;
  if (state.mode === "listening") return frames.listening;
  if (state.mode === "thinking") return frames.thinking;
  if (state.mode === "speaking") {
    state.smoothedSpeechLevel += (state.speechLevel - state.smoothedSpeechLevel) * 0.22;
    const expressionPhase = (now - state.modeChangedAt) % 2200;
    if (state.smoothedSpeechLevel < 0.08 || expressionPhase < 520) {
      if (state.emotion === "joy") return frames.warm;
      return emotionFrames[state.emotion] ?? frames.speechM;
    }
    if (state.smoothedSpeechLevel > 0.2) return frames.speechA;
    if (state.emotion === "joy") return frames.warm;
    return frames.speechM;
  }
  return emotionFrames[state.emotion] ?? frames.neutral;
}

function trackFrame(nextFrame, now) {
  if (nextFrame === state.activeFrame) return;
  state.previousFrame = state.activeFrame;
  state.activeFrame = nextFrame;
  state.frameChangedAt = now;
}

function drawBackdrop(now) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  context.clearRect(0, 0, width, height);

  if (!embedded) {
    const gradient = context.createRadialGradient(
      width * 0.5,
      height * 0.47,
      0,
      width * 0.5,
      height * 0.47,
      Math.max(width, height) * 0.68
    );
    gradient.addColorStop(0, "rgba(88, 25, 122, 0.22)");
    gradient.addColorStop(0.55, "rgba(10, 5, 18, 0.92)");
    gradient.addColorStop(1, "#000000");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }

  for (const particle of state.particles) {
    const y = ((particle.y - now * 0.000012 * particle.speed) % 1 + 1) % 1;
    context.fillStyle = `rgba(171, 108, 255, ${state.mode === "sleeping" ? 0.08 : 0.22})`;
    context.fillRect(particle.x * width, y * height, particle.size, particle.size);
  }
}

function getFrameCrop(frame) {
  const cellWidth = processedAtlas.width / columns;
  const cellHeight = processedAtlas.height / rows;
  const column = frame % columns;
  const row = Math.floor(frame / columns);
  const horizontalInset = 3;
  const verticalInset = 14;
  const left = Math.floor(column * cellWidth) + horizontalInset;
  const top = Math.floor(row * cellHeight) + verticalInset;
  const right = Math.floor((column + 1) * cellWidth) - horizontalInset;
  const bottom = Math.floor((row + 1) * cellHeight) - verticalInset;
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function drawFrame(frame, alpha, now) {
  if (!state.atlasReady || alpha <= 0) return;

  const crop = getFrameCrop(frame);
  const width = window.innerWidth;
  const height = window.innerHeight;
  const sourceRatio = crop.width / crop.height;
  const maxWidth = embedded ? width * 0.98 : Math.min(width * 0.92, height * 1.06);
  const maxHeight = height * 1.02;
  let targetWidth = maxWidth;
  let targetHeight = targetWidth / sourceRatio;
  if (targetHeight > maxHeight) {
    targetHeight = maxHeight;
    targetWidth = targetHeight * sourceRatio;
  }

  const glitchPhase = now % 5300;
  const glitching = state.mode !== "sleeping" && glitchPhase < 95;
  const glitchDirection = Math.floor(glitchPhase / 24) % 2 === 0 ? 1 : -1;
  const glitchX = glitching ? glitchDirection * 2.5 : 0;
  const glitchY = glitching ? -glitchDirection : 0;
  const emotionTilt = state.emotion === "curious" ? 0.008
    : state.emotion === "sad" ? -0.006
      : 0;
  const anchoredCenterY = height + 10 - targetHeight / 2;

  context.save();
  context.translate(width / 2 + glitchX, anchoredCenterY + glitchY);
  context.rotate(emotionTilt);
  context.globalAlpha = alpha * (state.mode === "sleeping" ? 0.5 : 1);
  context.shadowColor = "rgba(168, 91, 255, 0.7)";
  context.shadowBlur = embedded ? 10 : 22;
  if (state.mode !== "sleeping") {
    context.save();
    context.globalCompositeOperation = "screen";
    context.globalAlpha = alpha * (glitching ? 0.14 : 0.07);
    context.shadowColor = "rgba(58, 224, 255, 0.9)";
    context.shadowBlur = 18;
    context.drawImage(
      processedAtlas,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      -targetWidth / 2 - (glitching ? 5 : 2),
      -targetHeight / 2,
      targetWidth,
      targetHeight
    );
    context.globalAlpha = alpha * (glitching ? 0.11 : 0.05);
    context.shadowColor = "rgba(235, 74, 255, 0.85)";
    context.drawImage(
      processedAtlas,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      -targetWidth / 2 + (glitching ? 5 : 2),
      -targetHeight / 2,
      targetWidth,
      targetHeight
    );
    context.restore();
  }
  context.drawImage(
    processedAtlas,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    -targetWidth / 2,
    -targetHeight / 2,
    targetWidth,
    targetHeight
  );
  context.restore();
}

function drawModeEffects(now) {
  const width = window.innerWidth;
  const height = window.innerHeight;

  if (state.mode !== "sleeping") {
    const scanY = ((now * 0.0003) % 1) * height;
    const scan = context.createLinearGradient(0, scanY - 36, 0, scanY + 36);
    scan.addColorStop(0, "rgba(0,0,0,0)");
    scan.addColorStop(
      0.5,
      state.mode === "thinking"
        ? "rgba(93, 220, 255, 0.12)"
        : "rgba(93, 220, 255, 0.08)"
    );
    scan.addColorStop(1, "rgba(0,0,0,0)");
    context.save();
    context.globalCompositeOperation = "source-atop";
    context.fillStyle = scan;
    context.fillRect(0, scanY - 36, width, 72);
    context.restore();
  }

  context.fillStyle = "rgba(7, 2, 13, 0.1)";
  for (let y = 0; y < height; y += 4) context.fillRect(0, y, width, 1);
}

function render(now) {
  const frame = chooseFrame(now);
  trackFrame(frame, now);
  drawBackdrop(now);

  const transitionDuration = state.mode === "speaking" ? 110 : 125;
  const transition = Math.min(1, (now - state.frameChangedAt) / transitionDuration);
  drawFrame(state.previousFrame, 1 - transition, now);
  drawFrame(state.activeFrame, transition, now);
  drawModeEffects(now);
  requestAnimationFrame(render);
}

function connectEvents() {
  const stream = new EventSource("/api/events/stream");
  stream.addEventListener("open", () => {
    state.connected = true;
    connectionState.textContent = "Live 2D display";
  });
  stream.addEventListener("error", () => {
    state.connected = false;
    connectionState.textContent = "Reconnecting";
  });
  stream.addEventListener("lauren", (message) => {
    const event = JSON.parse(message.data);
    if (event.type === "face.state") setFace(event.payload || {});
    if (event.type === "media.display" && event.payload?.assetUrl) {
      mediaDisplay.src = event.payload.assetUrl;
      mediaDisplay.alt = event.payload.prompt || "Media displayed by Lauren";
      mediaDisplay.hidden = false;
    }
  });
}

function registerDisplay() {
  const id = window.localStorage.getItem("laurenFaceDeviceId") || `display-${crypto.randomUUID()}`;
  window.localStorage.setItem("laurenFaceDeviceId", id);
  fetch("/api/devices/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id,
      label: embedded ? "Lauren Main Anime Face" : "Lauren Anime Display",
      type: "display",
      capabilities: ["face-2d", "anime-sprites", "viseme", "fullscreen", "hologram-ready"]
    })
  }).catch(() => {});
}

function revealControls() {
  controls.classList.remove("quiet");
  window.clearTimeout(state.hideTimer);
  state.hideTimer = window.setTimeout(() => controls.classList.add("quiet"), 4000);
}

emotionSelect.addEventListener("change", () => setFace({ emotion: emotionSelect.value }, true));
modeSelect.addEventListener("change", () => setFace({ mode: modeSelect.value }, true));
fullscreenButton.addEventListener("click", async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await document.documentElement.requestFullscreen();
});
mediaDisplay.addEventListener("click", () => {
  mediaDisplay.hidden = true;
  mediaDisplay.removeAttribute("src");
});
window.addEventListener("resize", resizeCanvas);
window.addEventListener("pointermove", revealControls);
window.addEventListener("pointerdown", revealControls);
window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data?.type !== "lauren.speech-level") return;
  state.speechLevel = Math.max(0, Math.min(1, Number(event.data.level) || 0));
});

resizeCanvas();
setFace();
connectEvents();
registerDisplay();
revealControls();
requestAnimationFrame(render);
