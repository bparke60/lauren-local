import {
  isLikelySpeechEcho,
  splitSpeechChunks,
  stripWakePhrase
} from "/speech-utils.js";
import {
  getUiCommandIntent,
  getVisionIntent,
  isCloudStatusQuestion
} from "/intent-utils.js";
import { inferResponseEmotion } from "/emotion-utils.js";
import {
  describeCount,
  describeScene,
  getCountQuery,
  mapBoxToCover,
  mirrorBoxHorizontally,
  stableCounts
} from "/vision-utils.js";

const state = {
  config: null,
  usage: null,
  health: null,
  memory: { facts: [], routines: [] },
  connectedDevices: [],
  sessionId: window.localStorage.getItem("laurenSessionId") || `session-${crypto.randomUUID()}`,
  pendingAction: null,
  poweredOn: false,
  cameraStream: null,
  lastFrame: null,
  lastAnalysisAt: 0,
  motionScore: 0,
  listening: false,
  continuousListening: false,
  micPermission: "prompt",
  cameraPrimary: false,
  recognition: null,
  restartWakeTimer: null,
  preferredVoice: null,
  speakingTimer: null,
  currentAudio: null,
  audioContext: null,
  interruptionStream: null,
  interruptionSource: null,
  interruptionHighpass: null,
  interruptionLowpass: null,
  interruptionAnalyser: null,
  interruptionSamples: null,
  interruptionFrame: null,
  interruptionBaseline: 0.008,
  interruptionStreak: 0,
  speechStartedAt: 0,
  speechGeneration: 0,
  activeSpeechText: "",
  speechEchoTimer: null,
  lastSpeechEndedAt: 0,
  neuralVoices: [],
  lastAssistantMessage: "",
  pendingMemorySuggestion: null,
  faceState: { mode: "sleeping", emotion: "calm" },
  responseEmotion: "warm",
  emotionHoldUntil: 0,
  lastUserMessage: "",
  objectDetector: null,
  detectionActive: false,
  detectionTimer: null,
  detectionFrames: [],
  detectionBoxes: [],
  lastDetectionAt: 0,
  handTracker: null,
  handBoxes: [],
  lastHandAt: 0,
  detectionPassCount: 0,
  mediaLoadingTimer: null,
  mediaPlaybackActive: false,
  activeMedia: null
};
window.localStorage.setItem("laurenSessionId", state.sessionId);

const els = {
  assistantName: document.querySelector("#assistantName"),
  cloudLock: document.querySelector("#cloudLock"),
  powerToggle: document.querySelector("#powerToggle"),
  powerState: document.querySelector("#powerState"),
  face: document.querySelector("#face"),
  statusText: document.querySelector("#statusText"),
  sourceLinks: document.querySelector("#sourceLinks"),
  commandInput: document.querySelector("#commandInput"),
  sendCommand: document.querySelector("#sendCommand"),
  listenButton: document.querySelector("#listenButton"),
  startCamera: document.querySelector("#startCamera"),
  camera: document.querySelector("#camera"),
  cameraPip: document.querySelector("#cameraPip"),
  presenceStage: document.querySelector("#presenceStage"),
  swapView: document.querySelector("#swapView"),
  analysisCanvas: document.querySelector("#analysisCanvas"),
  detectionOverlay: document.querySelector("#detectionOverlay"),
  micHelp: document.querySelector("#micHelp"),
  memoryForm: document.querySelector("#memoryForm"),
  memoryInput: document.querySelector("#memoryInput"),
  memoryList: document.querySelector("#memoryList"),
  deviceGrid: document.querySelector("#deviceGrid"),
  memorySuggestion: document.querySelector("#memorySuggestion"),
  memorySuggestionText: document.querySelector("#memorySuggestionText"),
  saveMemorySuggestion: document.querySelector("#saveMemorySuggestion"),
  dismissMemorySuggestion: document.querySelector("#dismissMemorySuggestion"),
  actionApproval: document.querySelector("#actionApproval"),
  actionTitle: document.querySelector("#actionTitle"),
  actionDescription: document.querySelector("#actionDescription"),
  approveAction: document.querySelector("#approveAction"),
  denyAction: document.querySelector("#denyAction"),
  generatedMedia: document.querySelector("#generatedMedia"),
  generatedImage: document.querySelector("#generatedImage"),
  sharedVideo: document.querySelector("#sharedVideo"),
  mediaLoading: document.querySelector("#mediaLoading"),
  mediaLoadingTitle: document.querySelector("#mediaLoadingTitle"),
  mediaLoadingPrompt: document.querySelector("#mediaLoadingPrompt"),
  mediaLoadingTime: document.querySelector("#mediaLoadingTime"),
  generatedCaption: document.querySelector("#generatedCaption"),
  closeGeneratedMedia: document.querySelector("#closeGeneratedMedia"),
  capabilityRow: document.querySelector("#capabilityRow"),
  healthGrid: document.querySelector("#healthGrid"),
  faceFullscreen: document.querySelector("#faceFullscreen"),
  clearChat: document.querySelector("#clearChat"),
  voiceSelect: document.querySelector("#voiceSelect"),
  laurenVoiceSelect: document.querySelector("#laurenVoiceSelect"),
  previewLaurenVoice: document.querySelector("#previewLaurenVoice"),
  conversationList: document.querySelector("#conversationList"),
  previewVoice: document.querySelector("#previewVoice"),
  memoryCount: document.querySelector("#memoryCount"),
  memorySaved: document.querySelector("#memorySaved"),
  toastContainer: document.querySelector("#toastContainer"),
  viewTabs: document.querySelectorAll("[data-view-target]"),
  viewPanels: document.querySelectorAll("[data-view-panel]")
};

// ─── API helpers ──────────────────────────────────────────────────────────────

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload;
}

async function deleteJson(url) {
  const response = await fetch(url, { method: "DELETE" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload;
}

// ─── UI state ─────────────────────────────────────────────────────────────────

function setStatus(message) {
  els.statusText.classList.remove("thinking");
  els.statusText.textContent = message;
  renderCitations([]);
}

function setThinking(on) {
  els.commandInput.disabled = on;
  els.sendCommand.disabled = on;
  if (on) {
    els.statusText.classList.add("thinking");
  } else {
    els.statusText.classList.remove("thinking");
  }
}

function showToast(message, type = "error", durationMs = 4000) {
  if (!els.toastContainer) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  els.toastContainer.append(toast);
  window.setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 280ms ease";
    window.setTimeout(() => toast.remove(), 300);
  }, durationMs);
}

function renderCitations(citations = []) {
  els.sourceLinks.replaceChildren();
  const unique = citations.filter((citation, index, all) =>
    citation?.url && all.findIndex((candidate) => candidate.url === citation.url) === index
  );
  if (!unique.length) {
    els.sourceLinks.hidden = true;
    return;
  }
  unique.slice(0, 6).forEach((citation, index) => {
    const link = document.createElement("a");
    link.href = citation.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `${index + 1}. ${citation.title || new URL(citation.url).hostname}`;
    link.title = citation.url;
    els.sourceLinks.append(link);
  });
  els.sourceLinks.hidden = false;
}

function publishFaceState(mode, emotion = state.faceState.emotion, force = false) {
  if (!force && state.faceState.mode === mode && state.faceState.emotion === emotion) return;
  state.faceState = { mode, emotion };
  els.face.style.filter = "";
  postJson("/api/events", {
    type: "face.state",
    source: "mac-core",
    target: "all-displays",
    payload: state.faceState
  }).catch(() => {});
}

function setMicHelp(message) {
  if (els.micHelp) els.micHelp.textContent = message;
}

// ─── Voice output ─────────────────────────────────────────────────────────────

function setSpeaking(active) {
  els.face.classList.toggle("speaking", active);
  if (active && !state.poweredOn) return;
  publishFaceState(
    active ? "speaking" : state.poweredOn ? "idle" : "sleeping",
    active ? state.responseEmotion : state.poweredOn ? state.responseEmotion : "calm"
  );
  if (!active && state.poweredOn) state.emotionHoldUntil = Date.now() + 3200;
}

function stopSpeaking() {
  state.speechGeneration += 1;
  window.clearTimeout(state.speakingTimer);
  window.clearTimeout(state.speechEchoTimer);
  state.activeSpeechText = "";
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  stopSpokenAudio();
  postJson("/api/lauren/speak/stop", {}).catch(() => {});
  setSpeaking(false);
}

function speak(message, citations = [], speechMessage = message) {
  // One voice at a time: a newer response always replaces older audio.
  state.speechGeneration += 1;
  window.clearTimeout(state.speakingTimer);
  window.clearTimeout(state.speechEchoTimer);
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  stopSpokenAudio();
  setSpeaking(false);

  state.lastAssistantMessage = message;
  state.activeSpeechText = speechMessage || message;
  state.responseEmotion = inferResponseEmotion(message, state.lastUserMessage);
  els.statusText.textContent = message;
  renderCitations(citations);
  // No fallback voices: if her real voice fails, the text stays on screen.
  speakStreamed(speechMessage || message).catch(() => {
    state.activeSpeechText = "";
    setSpeaking(false);
    showToast("Her voice is unavailable right now — reply shown as text.", "info");
  });
}

async function fetchSpeech(text) {
  const response = await fetch("/api/lauren/speak", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text,
      voice: window.localStorage.getItem("laurenNeuralVoice") || undefined
    })
  });
  if (!response.ok) throw new Error(`Speech failed: ${response.status}`);
  const type = response.headers.get("content-type") || "";
  if (type.startsWith("audio/")) {
    return { kind: "audio", buffer: await response.arrayBuffer() };
  }
  // JSON means the server spoke through the Mac's native `say` voice instead.
  await response.json().catch(() => ({}));
  return { kind: "say" };
}

// Speak sentence-by-sentence: the first chunk plays while the rest are still
// being generated, so she starts talking almost immediately.
async function speakStreamed(message) {
  const generation = ++state.speechGeneration;
  const sentences = splitSpeechChunks(message);

  let pending = fetchSpeech(sentences[0]);
  let started = false;
  for (let index = 0; index < sentences.length; index++) {
    const chunk = await pending; // First failure throws → browser fallback.
    if (state.speechGeneration !== generation) {
      return;
    }
    if (index + 1 < sentences.length) {
      pending = fetchSpeech(sentences[index + 1]).catch(() => null);
    }
    if (chunk?.kind === "say") {
      // Native `say` fallback can't stream chunks; speak the rest in one go.
      if (index + 1 < sentences.length) {
        await postJson("/api/lauren/speak", { text: sentences.slice(index + 1).join(" ") }).catch(() => {});
      }
      pulseSpeaking(message.length);
      return;
    }
    if (!chunk) continue; // A middle chunk failed; skip it rather than stop.
    const sentenceEmotion = inferResponseEmotion(sentences[index], state.lastUserMessage);
    state.responseEmotion = sentenceEmotion;
    if (!started) {
      setSpeaking(true);
      started = true;
    } else {
      publishFaceState("speaking", sentenceEmotion);
    }
    await playAudioChunk(chunk.buffer, generation);
    state.lastSpeechEndedAt = Date.now();
  }
  if (started && state.speechGeneration === generation) {
    setSpeaking(false);
    window.clearTimeout(state.speechEchoTimer);
    state.speechEchoTimer = window.setTimeout(() => {
      if (state.speechGeneration === generation) state.activeSpeechText = "";
    }, 1200);
  }
}

function getAudioContext() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  if (!state.audioContext) state.audioContext = new AudioContext();
  return state.audioContext;
}

async function unlockAudioOutput() {
  const context = getAudioContext();
  if (!context) return false;
  if (context.state === "suspended") await context.resume();
  if (context.state !== "running") return false;

  const buffer = context.createBuffer(1, 1, context.sampleRate);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start(0);
  return true;
}

async function playAudioChunk(arrayBuffer, generation) {
  if (state.speechGeneration !== generation) return;
  const context = getAudioContext();
  if (!context) throw new Error("Web Audio is unavailable.");
  if (context.state === "suspended") await context.resume();
  if (context.state !== "running") throw new Error("Audio output is not unlocked.");

  const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
  if (state.speechGeneration !== generation) return;

  await new Promise((resolve) => {
    const source = context.createBufferSource();
    const analyser = context.createAnalyser();
    const samples = new Uint8Array(analyser.fftSize);
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.45;
    source.buffer = decoded;
    source.connect(analyser);
    analyser.connect(context.destination);
    state.currentAudio = source;
    state.speechStartedAt = performance.now();
    state.interruptionStreak = 0;

    let levelFrame = 0;
    const publishSpeechLevel = () => {
      if (state.currentAudio !== source) return;
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        energy += centered * centered;
      }
      const level = Math.min(1, Math.sqrt(energy / samples.length) * 5.5);
      els.face?.contentWindow?.postMessage(
        { type: "lauren.speech-level", level },
        window.location.origin
      );
      levelFrame = requestAnimationFrame(publishSpeechLevel);
    };
    publishSpeechLevel();

    source.onended = () => {
      if (state.currentAudio === source) state.currentAudio = null;
      cancelAnimationFrame(levelFrame);
      els.face?.contentWindow?.postMessage(
        { type: "lauren.speech-level", level: 0 },
        window.location.origin
      );
      source.disconnect();
      analyser.disconnect();
      resolve();
    };
    source.start(0);
  });
}

function stopSpokenAudio() {
  if (state.currentAudio) {
    try {
      state.currentAudio.stop();
    } catch {
      // The source may have already ended.
    }
    state.currentAudio = null;
  }
}

async function startInterruptionMonitor() {
  if (state.interruptionStream || !navigator.mediaDevices?.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
    if (!state.poweredOn) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const context = getAudioContext();
    if (!context) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const source = context.createMediaStreamSource(stream);
    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 180;
    highpass.Q.value = 0.7;
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 3800;
    lowpass.Q.value = 0.7;
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.35;
    source.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(analyser);
    state.interruptionStream = stream;
    state.interruptionSource = source;
    state.interruptionHighpass = highpass;
    state.interruptionLowpass = lowpass;
    state.interruptionAnalyser = analyser;
    state.interruptionSamples = new Float32Array(analyser.fftSize);
    state.interruptionBaseline = 0.008;
    monitorInterruptionLevel();
  } catch {
    // Speech recognition still works when a separate monitoring stream is unavailable.
  }
}

function monitorInterruptionLevel() {
  const analyser = state.interruptionAnalyser;
  if (!analyser || !state.poweredOn) return;

  const samples = state.interruptionSamples;
  if (!samples) return;
  analyser.getFloatTimeDomainData(samples);
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  const level = Math.sqrt(energy / samples.length);
  const speaking = Boolean(state.currentAudio) || state.faceState.mode === "speaking";

  if (!speaking) {
    state.interruptionBaseline = state.interruptionBaseline * 0.92 + level * 0.08;
    state.interruptionStreak = 0;
  } else {
    const speechAge = performance.now() - state.speechStartedAt;
    if (speechAge < 550) {
      state.interruptionBaseline = state.interruptionBaseline * 0.7 + level * 0.3;
    } else {
      const threshold = Math.max(
        0.028,
        state.interruptionBaseline * 2.8,
        state.interruptionBaseline + 0.016
      );
      state.interruptionStreak = level > threshold ? state.interruptionStreak + 1 : 0;
      if (state.interruptionStreak >= 8) {
        stopSpeaking();
        state.lastSpeechEndedAt = 0;
        state.interruptionStreak = 0;
        setStatus("Listening...");
      } else if (level < state.interruptionBaseline * 1.35) {
        state.interruptionBaseline = state.interruptionBaseline * 0.97 + level * 0.03;
      }
    }
  }

  state.interruptionFrame = requestAnimationFrame(monitorInterruptionLevel);
}

function stopInterruptionMonitor() {
  if (state.interruptionFrame) cancelAnimationFrame(state.interruptionFrame);
  state.interruptionFrame = null;
  if (state.interruptionSource) state.interruptionSource.disconnect();
  if (state.interruptionHighpass) state.interruptionHighpass.disconnect();
  if (state.interruptionLowpass) state.interruptionLowpass.disconnect();
  state.interruptionSource = null;
  state.interruptionHighpass = null;
  state.interruptionLowpass = null;
  state.interruptionAnalyser = null;
  state.interruptionSamples = null;
  if (state.interruptionStream) {
    state.interruptionStream.getTracks().forEach((track) => track.stop());
  }
  state.interruptionStream = null;
  state.interruptionStreak = 0;
}

function speakWithBrowserVoice(message) {
  if (!("speechSynthesis" in window)) {
    pulseSpeaking(message.length);
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  if (state.preferredVoice) utterance.voice = state.preferredVoice;
  utterance.rate = 1.04;
  utterance.pitch = 1.06;
  utterance.onstart = () => setSpeaking(true);
  utterance.onend = () => setSpeaking(false);
  utterance.onerror = () => setSpeaking(false);
  window.speechSynthesis.speak(utterance);
}

function selectPreferredVoice() {
  if (!("speechSynthesis" in window)) return;

  const voices = window.speechSynthesis.getVoices();
  const preferredNames = state.config?.voice?.preferredVoiceNames || [];
  const savedVoiceName = window.localStorage.getItem("laurenVoiceName");
  const savedVoice = voices.find((voice) => voice.name === savedVoiceName);
  const exactMatch = voices.find((voice) =>
    preferredNames.some((name) => voice.name.toLowerCase().includes(name.toLowerCase()))
  );
  const softMatch = voices.find((voice) =>
    /female|woman|girl|samantha|victoria|ava|karen|susan|zira/i.test(`${voice.name} ${voice.voiceURI}`)
  );

  state.preferredVoice = savedVoice || exactMatch || softMatch || voices.find((voice) => voice.lang?.startsWith("en")) || null;
  renderVoiceOptions(voices);
}

function renderVoiceOptions(voices) {
  if (!els.voiceSelect || !els.previewVoice) return;

  els.voiceSelect.replaceChildren();
  if (!voices.length) {
    const option = document.createElement("option");
    option.textContent = "System default";
    els.voiceSelect.append(option);
    els.voiceSelect.disabled = true;
    els.previewVoice.disabled = true;
    return;
  }

  const englishVoices = voices.filter((voice) => voice.lang?.toLowerCase().startsWith("en"));
  for (const voice of englishVoices) {
    const option = document.createElement("option");
    option.value = voice.name;
    option.textContent = `${voice.name} (${voice.lang})`;
    option.selected = voice.name === state.preferredVoice?.name;
    els.voiceSelect.append(option);
  }

  els.voiceSelect.disabled = false;
  els.previewVoice.disabled = false;
}

function pulseSpeaking(length) {
  window.clearTimeout(state.speakingTimer);
  setSpeaking(true);
  state.speakingTimer = window.setTimeout(() => setSpeaking(false), Math.min(12_000, 600 + length * 55));
}

async function loadNeuralVoices() {
  if (!els.laurenVoiceSelect) return;
  let payload = { voices: [] };
  try {
    payload = await getJson("/api/voice/voices");
  } catch {
    // Voice service offline; the row will say so.
  }
  state.neuralVoices = payload.voices || [];
  els.laurenVoiceSelect.replaceChildren();

  if (!state.neuralVoices.length) {
    const option = document.createElement("option");
    option.textContent = "Local voice unavailable — text only";
    els.laurenVoiceSelect.append(option);
    els.laurenVoiceSelect.disabled = true;
    if (els.previewLaurenVoice) els.previewLaurenVoice.disabled = true;
    return;
  }

  const saved = window.localStorage.getItem("laurenNeuralVoice") || payload.defaultVoice;
  for (const voice of state.neuralVoices) {
    const option = document.createElement("option");
    option.value = voice.id;
    option.textContent = voice.label;
    option.selected = voice.id === saved;
    els.laurenVoiceSelect.append(option);
  }
  els.laurenVoiceSelect.disabled = false;
  if (els.previewLaurenVoice) els.previewLaurenVoice.disabled = false;
}

// ─── Conversation history ─────────────────────────────────────────────────────

async function renderConversations() {
  if (!els.conversationList) return;
  let sessions = [];
  try {
    sessions = (await getJson("/api/conversations")).sessions || [];
  } catch {
    // Leave the list empty on failure.
  }

  els.conversationList.replaceChildren();
  if (!sessions.length) {
    const item = document.createElement("li");
    const wrap = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = "No saved conversations yet";
    const note = document.createElement("small");
    note.textContent = "Chats are stored on this Mac as you talk.";
    wrap.append(title, note);
    item.append(wrap);
    els.conversationList.append(item);
    return;
  }

  for (const session of sessions) {
    const item = document.createElement("li");
    item.className = "conversation-item";

    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = session.preview;
    const meta = document.createElement("small");
    const when = new Date(session.updatedAt).toLocaleString([], {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
    });
    meta.textContent = `${session.messageCount} messages · ${when}${session.id === state.sessionId ? " · current" : ""}`;
    info.append(title, meta);

    const buttons = document.createElement("div");
    buttons.className = "conversation-buttons";

    const viewButton = document.createElement("button");
    viewButton.type = "button";
    viewButton.textContent = "View";
    viewButton.addEventListener("click", () => toggleConversationView(item, session.id, viewButton));

    const resumeButton = document.createElement("button");
    resumeButton.type = "button";
    resumeButton.textContent = session.id === state.sessionId ? "Active" : "Resume";
    resumeButton.disabled = session.id === state.sessionId;
    resumeButton.addEventListener("click", () => {
      window.localStorage.setItem("laurenSessionId", session.id);
      window.location.reload();
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", async () => {
      try {
        await deleteJson(`/api/conversations/${encodeURIComponent(session.id)}`);
        await renderConversations();
      } catch (error) {
        showToast(`Couldn't delete conversation: ${error.message}`, "error");
      }
    });

    buttons.append(viewButton, resumeButton, deleteButton);
    item.append(info, buttons);
    els.conversationList.append(item);
  }
}

async function toggleConversationView(item, sessionId, button) {
  const existing = item.querySelector(".conversation-messages");
  if (existing) {
    existing.remove();
    button.textContent = "View";
    return;
  }
  try {
    const conversation = await getJson(`/api/conversations/${encodeURIComponent(sessionId)}`);
    const list = document.createElement("ul");
    list.className = "conversation-messages";
    for (const message of conversation.messages || []) {
      const entry = document.createElement("li");
      entry.className = message.role;
      const time = new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const speaker = document.createElement("small");
      speaker.textContent = `${message.role === "user" ? "You" : "Lauren"} · ${time}`;
      const text = document.createElement("p");
      text.textContent = message.content;
      entry.append(speaker, text);
      list.append(entry);
    }
    item.append(list);
    button.textContent = "Hide";
  } catch (error) {
    showToast(`Couldn't load conversation: ${error.message}`, "error");
  }
}

// ─── Render: settings panels ──────────────────────────────────────────────────

function renderDevices() {
  const configuredDevices = state.config?.devices || [];
  const devices = [
    ...configuredDevices,
    ...state.connectedDevices.filter((connected) =>
      !configuredDevices.some((configured) => configured.id === connected.id)
    )
  ];
  els.deviceGrid.innerHTML = devices
    .map((device) => {
      const safeStatus = String(device.status || "unknown").replace(/[^a-z0-9_-]/gi, "_");
      return `
        <div class="device">
          <div>
            <strong>${escapeHtml(device.label)}</strong>
            <span>${escapeHtml(device.type || device.device_type || "device")}</span>
          </div>
          <em class="status-pill ${safeStatus}">${escapeHtml(device.status)}</em>
        </div>
      `;
    })
    .join("");
}

function renderMemory() {
  const facts = state.memory.facts || [];
  const routines = state.memory.routines || [];
  const total = facts.length + routines.length;

  if (els.memoryCount) els.memoryCount.textContent = total ? `(${total})` : "";

  const factItems = facts.slice(0, 8).map((fact) => {
    const date = new Date(fact.createdAt).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
    return `
      <li>
        <div>
          ${escapeHtml(fact.text)}<em class="memory-badge ${escapeHtml(fact.type)}">${escapeHtml(fact.type)}</em>
          <small>${date}</small>
        </div>
        <button type="button" data-forget-id="${escapeHtml(fact.id)}">Forget</button>
      </li>
    `;
  });

  const routineItems = routines.map((routine) => `
    <li>
      <div>
        <em class="memory-badge routine">routine</em>
        ${escapeHtml(routine.phrase)}
        <small>→ ${escapeHtml((routine.actions || []).join(", "))}</small>
      </div>
    </li>
  `);

  els.memoryList.innerHTML = [...factItems, ...routineItems].join("");
}

function renderHealth() {
  const features = state.config?.local?.features || {};
  const capabilities = [
    ["Chat", features.brain, "live"],
    ["Vision", features.vision, "live"],
    ["Web research", features.webSearch, "live"],
    ["Image generation", features.imageGeneration, "approval"],
    ["Mac actions", features.macActions, "approval"],
    ["Video generation", features.videoGeneration, ""]
  ];
  els.capabilityRow.innerHTML = capabilities
    .map(([label, enabled, kind]) =>
      `<span class="capability ${enabled ? kind : ""}">${escapeHtml(label)} · ${enabled ? (kind === "approval" ? "approval" : "live") : "later"}</span>`
    )
    .join("");

  const health = state.health || {};
  const values = [
    ["Model engine", "LM Studio · local"],
    ["Brain model", health.model || "Unavailable"],
    ["Storage", health.storage === "local_json" ? "This Mac" : health.storage || "Unknown"],
    ["Errors (24h)", String(health.recentErrorCount || 0)]
  ];
  els.healthGrid.innerHTML = values
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join("");
}

function showActionApproval(action) {
  state.pendingAction = action;
  els.actionTitle.textContent = action.title;
  const cost = Number(action.estimatedCostUsd || 0);
  els.actionDescription.textContent = cost > 0
    ? `${action.description} · estimated $${cost.toFixed(2)}`
    : action.description;
  els.actionApproval.hidden = false;
  els.approveAction.disabled = false;
  els.denyAction.disabled = false;
  els.approveAction.textContent = "Approve";
  els.approveAction.focus();
}

function clearActionApproval() {
  state.pendingAction = null;
  els.actionApproval.hidden = true;
}

function clearMediaLoadingTimer() {
  window.clearInterval(state.mediaLoadingTimer);
  state.mediaLoadingTimer = null;
}

function prepareSharedStage(caption = "") {
  clearMediaLoadingTimer();
  els.generatedCaption.textContent = caption;
  els.generatedMedia.hidden = false;
  els.presenceStage.classList.add("media-primary");
}

function showMediaLoading(prompt) {
  prepareSharedStage(prompt);
  state.activeMedia = { mediaType: "loading", title: prompt };
  state.mediaPlaybackActive = false;
  els.generatedImage.hidden = true;
  els.sharedVideo.hidden = true;
  els.mediaLoading.hidden = false;
  els.mediaLoadingTitle.textContent = "Creating image";
  els.mediaLoadingPrompt.textContent = prompt;
  const startedAt = Date.now();
  const updateTime = () => {
    const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    els.mediaLoadingTime.textContent = seconds < 2
      ? "Preparing the scene..."
      : `Rendering for ${seconds} seconds...`;
  };
  updateTime();
  state.mediaLoadingTimer = window.setInterval(updateTime, 1000);
}

function showGeneratedMedia(assetUrl, caption = "", media = {}) {
  prepareSharedStage(caption);
  els.mediaLoading.hidden = true;
  els.sharedVideo.hidden = true;
  els.generatedImage.src = assetUrl;
  els.generatedImage.hidden = false;
  state.mediaPlaybackActive = false;
  state.activeMedia = {
    mediaType: "image",
    assetUrl,
    title: media.title || caption,
    sourceUrl: media.sourceUrl || ""
  };
}

function showSharedVideo(media) {
  prepareSharedStage(media.title || "YouTube video");
  els.mediaLoading.hidden = true;
  els.generatedImage.hidden = true;
  const origin = encodeURIComponent(window.location.origin);
  els.sharedVideo.src = `https://www.youtube.com/embed/${encodeURIComponent(media.videoId)}?autoplay=1&enablejsapi=1&playsinline=1&origin=${origin}`;
  els.sharedVideo.hidden = false;
  state.mediaPlaybackActive = true;
  state.activeMedia = media;
}

function pauseSharedVideo() {
  if (!state.mediaPlaybackActive || els.sharedVideo.hidden) return;
  els.sharedVideo.contentWindow?.postMessage(
    JSON.stringify({ event: "command", func: "pauseVideo", args: [] }),
    "https://www.youtube.com"
  );
  state.mediaPlaybackActive = false;
}

async function closeGeneratedMedia() {
  if (document.fullscreenElement === els.generatedMedia) {
    await document.exitFullscreen().catch(() => {});
  }
  clearMediaLoadingTimer();
  pauseSharedVideo();
  els.generatedMedia.hidden = true;
  els.generatedImage.removeAttribute("src");
  els.generatedImage.hidden = true;
  els.sharedVideo.removeAttribute("src");
  els.sharedVideo.hidden = true;
  els.mediaLoading.hidden = true;
  els.generatedCaption.textContent = "";
  els.presenceStage.classList.remove("media-primary");
  state.activeMedia = null;
  state.mediaPlaybackActive = false;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadState() {
  const [config, memory, usage, devices, health, actions] = await Promise.all([
    getJson("/api/config"),
    getJson("/api/memory"),
    getJson("/api/usage"),
    getJson("/api/devices"),
    getJson("/api/health"),
    getJson("/api/actions?status=pending")
  ]);
  state.config = config;
  state.memory = memory;
  state.usage = usage;
  state.connectedDevices = devices;
  state.health = health;
  selectPreferredVoice();
  els.assistantName.textContent = state.config.assistant?.name || "Lauren";
  renderBudget();
  renderDevices();
  renderMemory();
  renderHealth();
  const pendingAction = actions.find((action) => action.sessionId === state.sessionId);
  if (pendingAction) showActionApproval(pendingAction);
  renderSignals([]);
  checkMicrophonePermission();
  setPower(false);
}

function setPower(on) {
  state.poweredOn = on;
  els.powerToggle.textContent = on ? "On" : "Off";
  els.powerToggle.classList.toggle("on", on);
  els.powerToggle.setAttribute("aria-pressed", String(on));
  els.powerState.textContent = on ? "On" : "Off";
  els.powerState.classList.toggle("on", on);

  if (on) {
    setStatus(getDynamicIntro());
    publishFaceState("idle", "warm", true);
    setMicHelp("Lauren is on and listening. The camera stays off until you ask her to look.");
    startVoiceListening();
    startInterruptionMonitor();
  } else {
    stopVoiceListening();
    stopInterruptionMonitor();
    setStatus("Lauren is off.");
    publishFaceState("sleeping", "calm", true);
  }
}

function renderBudget() {
  els.cloudLock.textContent = "Local AI · no cloud billing";
  return;

  const usage = state.usage;
  const enabled = Boolean(usage?.cloudEnabled);
  if (!enabled) {
    els.cloudLock.textContent = "Cloud locked";
    return;
  }

  const spent = Number(usage.estimatedUsd || 0);
  const budget = Number(usage.monthlyBudgetUsd || 0);
  els.cloudLock.textContent = `Cloud $${spent.toFixed(3)} / $${budget.toFixed(0)}`;
}

async function refreshUsage() {
  try {
    state.usage = await getJson("/api/usage");
    renderBudget();
  } catch {
    els.cloudLock.textContent = "Usage unknown";
  }
}

function getDynamicIntro() {
  const intros = [
    "I'm here, BJ. What do you need?",
    "Online and ready.",
    "Ready, BJ.",
    "I'm with you. Where should we start?"
  ];

  return intros[Math.floor(Math.random() * intros.length)];
}

async function checkMicrophonePermission() {
  if (!navigator.permissions?.query) return;

  try {
    const permission = await navigator.permissions.query({ name: "microphone" });
    updateMicrophoneHelp(permission.state);
    permission.onchange = () => updateMicrophoneHelp(permission.state);
  } catch {
    setMicHelp("The Talk button may ask for microphone permission. The text box works without it.");
  }
}

function updateMicrophoneHelp(permissionState) {
  state.micPermission = permissionState || "prompt";
  if (state.micPermission === "granted") {
    setMicHelp(state.poweredOn
      ? "Listening. Just talk normally; no wake phrase needed."
      : "Microphone ready. Turn Lauren on when you want her listening.");
    return;
  }

  if (state.micPermission === "denied") {
    setMicHelp("Microphone blocked. Text chat still works.");
    return;
  }

  setMicHelp("Select Listen to allow microphone access.");
}

// ─── Camera ───────────────────────────────────────────────────────────────────

// Fullscreen whatever is currently the main view. Every fullscreen surface is
// clean: no controls, captions, or surrounding app chrome.
async function toggleMainFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }
  if (!els.generatedMedia.hidden) {
    await els.generatedMedia.requestFullscreen();
    return;
  }
  if (state.cameraStream && state.cameraPrimary) {
    await els.cameraPip.requestFullscreen();
    return;
  }
  await els.face.requestFullscreen();
}

function stopCamera() {
  if (!state.cameraStream) return;

  if (document.fullscreenElement === els.cameraPip) document.exitFullscreen().catch(() => {});
  stopObjectDetection();
  state.cameraStream.getTracks().forEach((track) => track.stop());
  state.cameraStream = null;
  state.lastFrame = null;
  state.motionScore = 0;
  state.cameraPrimary = false;
  els.camera.srcObject = null;
  els.cameraPip.hidden = true;
  els.presenceStage.classList.remove("camera-primary");
  els.startCamera.textContent = "Camera";
  els.startCamera.setAttribute("aria-pressed", "false");
  setStatus("Vision is off.");
}

async function toggleCamera() {
  if (state.cameraStream) {
    stopCamera();
    return false;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    speak("Camera access is not available in this browser.");
    return false;
  }

  try {
    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "environment"
      },
      audio: false
    });
    els.camera.srcObject = state.cameraStream;
    els.cameraPip.hidden = false;
    els.startCamera.textContent = "Camera off";
    els.startCamera.setAttribute("aria-pressed", "true");
    setStatus("Vision is online. Ask me what I see.");
    publishFaceState("listening", "curious");
    requestAnimationFrame(trackMotion);
    startObjectDetection();
    return true;
  } catch (error) {
    showToast(`Camera error: ${error.message}`, "error");
    return false;
  }
}

// ─── Live object detection (local, free) ─────────────────────────────────────

async function waitForDetectionModule(timeoutMs = 12_000) {
  // The MediaPipe bundle loads from a CDN in parallel with the app; give it
  // time to arrive instead of failing when the camera starts quickly.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (window.LaurenObjectDetector && window.LaurenFilesetResolver) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function initObjectDetector() {
  if (state.objectDetector) return state.objectDetector;
  if (!(await waitForDetectionModule())) {
    throw new Error("The vision module never finished loading (check internet).");
  }
  const ObjectDetector = window.LaurenObjectDetector;
  const FilesetResolver = window.LaurenFilesetResolver;
  const vision = await FilesetResolver.forVisionTasks("/vendor/tasks-vision/wasm");
  const options = {
    baseOptions: {
      modelAssetPath: "/vendor/models/efficientdet_lite2.tflite",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    scoreThreshold: 0.35,
    maxResults: 10
  };
  try {
    state.objectDetector = await ObjectDetector.createFromOptions(vision, options);
  } catch {
    // Some GPU/WebGL setups reject the GPU delegate; CPU still runs fine.
    options.baseOptions.delegate = "CPU";
    state.objectDetector = await ObjectDetector.createFromOptions(vision, options);
  }
  return state.objectDetector;
}

async function initHandTracker() {
  if (state.handTracker) return state.handTracker;
  const HandLandmarker = window.LaurenHandLandmarker;
  const FilesetResolver = window.LaurenFilesetResolver;
  if (!HandLandmarker || !FilesetResolver) return null;
  const vision = await FilesetResolver.forVisionTasks("/vendor/tasks-vision/wasm");
  const options = {
    baseOptions: {
      modelAssetPath: "/vendor/models/hand_landmarker.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numHands: 2
  };
  try {
    state.handTracker = await HandLandmarker.createFromOptions(vision, options);
  } catch {
    options.baseOptions.delegate = "CPU";
    state.handTracker = await HandLandmarker.createFromOptions(vision, options);
  }
  return state.handTracker;
}

async function startObjectDetection() {
  if (state.detectionActive) return;
  state.detectionActive = true;
  try {
    await initObjectDetector();
  } catch (error) {
    state.detectionActive = false;
    showToast(`Live detection couldn't start (${error.message}) — using local vision instead.`, "info", 6000);
    return;
  }
  // Hands are tracked by a dedicated model (the object detector has no
  // "hand" category). Optional: detection still runs without it.
  initHandTracker().catch(() => {});
  if (!state.detectionActive || !state.cameraStream) return;
  runDetectionPass();
}

function stopObjectDetection() {
  state.detectionActive = false;
  window.clearTimeout(state.detectionTimer);
  state.detectionTimer = null;
  state.detectionFrames = [];
  state.detectionBoxes = [];
  state.lastDetectionAt = 0;
  state.handBoxes = [];
  state.lastHandAt = 0;
  state.detectionPassCount = 0;
  clearDetectionOverlay();
}

function getHandBoxesFromLandmarks(landmarksList, video) {
  const boxes = [];
  for (const landmarks of landmarksList || []) {
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const point of landmarks) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    const padX = 0.04;
    const padY = 0.05;
    boxes.push({
      originX: Math.max(0, (minX - padX)) * video.videoWidth,
      originY: Math.max(0, (minY - padY)) * video.videoHeight,
      width: Math.min(1, maxX - minX + padX * 2) * video.videoWidth,
      height: Math.min(1, maxY - minY + padY * 2) * video.videoHeight
    });
  }
  return boxes;
}

function runDetectionPass() {
  if (!state.detectionActive || !state.cameraStream || !state.objectDetector) return;

  const video = els.camera;
  let inferenceMs = 40;
  if (video.videoWidth && video.videoHeight) {
    const started = performance.now();
    try {
      state.detectionPassCount += 1;
      // Hands come from a dedicated tracker on alternating passes so the two
      // models share the frame budget instead of stacking latency.
      if (state.handTracker && state.detectionPassCount % 2 === 0) {
        const handResult = state.handTracker.detectForVideo(video, performance.now());
        state.handBoxes = getHandBoxesFromLandmarks(handResult.landmarks, video);
        state.lastHandAt = Date.now();
      } else {
        const result = state.objectDetector.detectForVideo(video, performance.now());
        const detections = (result.detections || []).filter(
          (detection) => detection.categories?.[0]?.categoryName
        );
        state.detectionBoxes = detections;
        const labels = detections.map((d) => d.categories[0].categoryName);
        const handsFresh = Date.now() - state.lastHandAt < 900;
        if (handsFresh) for (const _ of state.handBoxes) labels.push("hand");
        state.detectionFrames.push(labels);
        if (state.detectionFrames.length > 8) state.detectionFrames.shift();
        state.lastDetectionAt = Date.now();
      }
      inferenceMs = performance.now() - started;
      drawDetections(state.detectionBoxes);
    } catch {
      // One bad frame is fine; keep the loop alive.
    }
  }

  // Pace to what the machine can actually do: fast on GPU, backed off on CPU.
  const delay = Math.min(400, Math.max(80, Math.round(inferenceMs * 1.4)));
  state.detectionTimer = window.setTimeout(runDetectionPass, delay);
}

function clearDetectionOverlay() {
  const canvas = els.detectionOverlay;
  if (!canvas) return;
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
}

function drawDetections(detections) {
  const canvas = els.detectionOverlay;
  const video = els.camera;
  if (!canvas || !video.videoWidth) return;

  const displayWidth = canvas.clientWidth;
  const displayHeight = canvas.clientHeight;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(displayWidth * ratio);
  canvas.height = Math.round(displayHeight * ratio);

  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, displayWidth, displayHeight);
  context.font = "600 11px Inter, system-ui, sans-serif";

  const drawBox = (rawBox, text, color) => {
    const mappedBox = mapBoxToCover(
      rawBox,
      video.videoWidth,
      video.videoHeight,
      displayWidth,
      displayHeight
    );
    if (!mappedBox) return;
    const box = mirrorBoxHorizontally(mappedBox, displayWidth);
    context.strokeStyle = color;
    context.lineWidth = 1.5;
    context.strokeRect(box.x, box.y, box.width, box.height);
    const textWidth = context.measureText(text).width + 10;
    const chipY = Math.max(0, box.y - 16);
    context.fillStyle = "rgba(9, 11, 13, 0.82)";
    context.fillRect(box.x, chipY, textWidth, 15);
    context.fillStyle = color;
    context.fillText(text, box.x + 5, chipY + 11);
  };

  for (const detection of detections) {
    const label = detection.categories[0].categoryName;
    const score = Math.round((detection.categories[0].score || 0) * 100);
    drawBox(detection.boundingBox, `${label} ${score}%`, "rgba(76, 213, 231, 0.9)");
  }

  if (Date.now() - state.lastHandAt < 900) {
    for (const handBox of state.handBoxes) {
      drawBox(handBox, "hand", "rgba(114, 230, 166, 0.9)");
    }
  }
}

function getFreshSceneCounts() {
  if (!state.detectionFrames.length) return null;
  if (Date.now() - state.lastDetectionAt > 2500) return null;
  return stableCounts(state.detectionFrames);
}

async function waitForSceneCounts(timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const counts = getFreshSceneCounts();
    if (counts?.size) return counts;
    if (!state.cameraStream) return null;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return getFreshSceneCounts();
}

function getFrameSample() {
  const video = els.camera;
  if (!video.videoWidth || !video.videoHeight) return null;

  const canvas = els.analysisCanvas;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const width = 160;
  const height = Math.max(90, Math.round((video.videoHeight / video.videoWidth) * width));
  canvas.width = width;
  canvas.height = height;
  context.drawImage(video, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

function captureImageDataUrl() {
  const video = els.camera;
  if (!video.videoWidth || !video.videoHeight) return null;

  const canvas = document.createElement("canvas");
  const maxWidth = 720;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

function analyzeFrame() {
  const frame = getFrameSample();
  if (!frame) {
    return {
      ok: false,
      summary: "I need the camera running before I can analyze the scene.",
      signals: []
    };
  }

  const data = frame.data;
  let brightnessTotal = 0;
  let redTotal = 0;
  let greenTotal = 0;
  let blueTotal = 0;
  let warmPixels = 0;
  let coolPixels = 0;
  let highContrastPixels = 0;

  for (let i = 0; i < data.length; i += 4) {
    const red = data[i];
    const green = data[i + 1];
    const blue = data[i + 2];
    const brightness = (red + green + blue) / 3;
    brightnessTotal += brightness;
    redTotal += red;
    greenTotal += green;
    blueTotal += blue;

    if (red > blue + 28 && red > green - 8) warmPixels += 1;
    if (blue > red + 24 || green > red + 28) coolPixels += 1;
    if (Math.max(red, green, blue) - Math.min(red, green, blue) > 88) highContrastPixels += 1;
  }

  const pixels = data.length / 4;
  const avgBrightness = brightnessTotal / pixels;
  const avgRed = redTotal / pixels;
  const avgGreen = greenTotal / pixels;
  const avgBlue = blueTotal / pixels;
  const dominant = getDominantColor(avgRed, avgGreen, avgBlue);
  const lighting = avgBrightness > 170 ? "bright" : avgBrightness > 82 ? "moderately lit" : "dim";
  const motion = state.motionScore > 30 ? "recent movement" : "little movement";
  const brightnessConfidence = clamp(Math.abs(avgBrightness - 82) / 118);
  const motionConfidence = clamp(state.motionScore / 80);
  const edgeConfidence = clamp(highContrastPixels / pixels / 0.32);
  const warmConfidence = clamp(warmPixels / pixels / 0.42);
  const coolConfidence = clamp(coolPixels / pixels / 0.42);
  const lowLightRisk = clamp((90 - avgBrightness) / 90);
  const sceneHints = [];

  if (edgeConfidence > 0.56) sceneHints.push("sharp edges or text-like details");
  if (warmConfidence > 0.57) sceneHints.push("warm-colored objects");
  if (coolConfidence > 0.57) sceneHints.push("cool-colored surfaces or screen light");
  if (avgBrightness < 65) sceneHints.push("low light, so confidence is reduced");
  if (state.motionScore > 45) sceneHints.push("a hand wave or nearby motion");

  const hints = sceneHints.length ? sceneHints.join(", ") : "a stable scene with no strong local clue";
  const summary = `Local scan: ${lighting} scene, mostly ${dominant} tones, ${motion}. Strongest clues: ${hints}.`;

  return {
    ok: true,
    summary,
    metrics: {
      brightness: Math.round(avgBrightness),
      dominant,
      motionScore: Math.round(state.motionScore)
    },
    signals: [
      { label: `Lighting: ${lighting}`, value: brightnessConfidence, detail: `${Math.round(avgBrightness)} avg` },
      { label: "Motion", value: motionConfidence, detail: `${Math.round(state.motionScore)} score` },
      { label: "Text/edge clues", value: edgeConfidence, detail: `${percent(edgeConfidence)}` },
      { label: "Warm tones", value: warmConfidence, detail: `${percent(warmConfidence)}` },
      { label: "Cool/screen tones", value: coolConfidence, detail: `${percent(coolConfidence)}` },
      { label: "Low-light risk", value: lowLightRisk, detail: `${percent(lowLightRisk)}` }
    ]
  };
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

function percent(value) {
  return `${Math.round(clamp(value) * 100)}%`;
}

function getDominantColor(red, green, blue) {
  if (red > green + 18 && red > blue + 18) return "red or warm";
  if (green > red + 18 && green > blue + 12) return "green";
  if (blue > red + 18 && blue > green + 12) return "blue";
  if (red + green + blue > 570) return "light neutral";
  if (red + green + blue < 190) return "dark neutral";
  return "neutral";
}

function trackMotion() {
  if (!state.cameraStream) return;

  const frame = getFrameSample();
  if (frame && state.lastFrame) {
    let diff = 0;
    const current = frame.data;
    const previous = state.lastFrame.data;
    const stride = 16;

    for (let i = 0; i < current.length; i += stride) {
      diff += Math.abs(current[i] - previous[i]);
    }

    state.motionScore = diff / (current.length / stride);
  }

  if (frame) state.lastFrame = frame;
  requestAnimationFrame(trackMotion);
}

// ─── Vision ───────────────────────────────────────────────────────────────────

async function runSceneAnalysis(source = "manual", intent = "scene") {
  try {
    state.lastAnalysisAt = Date.now();
    const result = analyzeFrame();
    publishFaceState("thinking", intent === "finger_count" ? "focused" : "curious");

    if (intent === "scene_glance") {
      setStatus("Taking a look...");
      const counts = await waitForSceneCounts();
      if (counts?.size) {
        const reply = describeScene(counts);
        speak(reply);
        publishFaceState("idle", "confident");
        return;
      }
      // Local detection saw nothing usable — let cloud vision take the look.
    }

    if (intent === "finger_count" && result.ok) {
      setStatus("Checking your hand...");
      const detection = await runFingerCount();
      if (detection !== null) {
        const handWord = detection.hands === 1 ? "hand" : "hands";
        const fingerWord = detection.count === 1 ? "finger" : "fingers";
        const reply = `I can see ${detection.hands} ${handWord}. You have ${detection.count} ${fingerWord} extended.`;
        setStatus(reply);
        speak(reply);
        publishFaceState("idle", "confident");
        return;
      }
      setStatus("Hand detection was uncertain — asking the local model...");
    }

    const prefix = source === "gesture" ? "Gesture scan complete. " : "";
    const intentNote = getVisionIntentNote(intent, result.ok);
    const detectionCounts = getFreshSceneCounts();
    const detectionNote = detectionCounts?.size
      ? ` Local object detection: ${describeScene(detectionCounts)}`
      : "";
    const summary = `${result.summary}${intentNote ? ` ${intentNote}` : ""}${detectionNote}`;
    if (result.ok && state.config?.local?.features?.vision) {
      setStatus("Lauren is checking the camera...");
      const cloudAnswered = await askCloudVision(summary, intent);
      if (!cloudAnswered) speak(`${prefix}${summary}`);
      return;
    }
    speak(`${prefix}${summary}`);
  } catch (error) {
    showToast(`Vision analysis failed: ${error.message}`, "error");
    publishFaceState("idle", "calm");
  }
}

async function askCloudVision(localSummary, intent) {
  const imageDataUrl = captureImageDataUrl();
  if (!imageDataUrl) return false;

  const promptByIntent = {
    finger_count: "How many fingers is BJ holding up? Be careful and say uncertain if the hand is not clear.",
    held_object: "What is BJ holding or pointing at? Identify visible objects only.",
    scene: "What is BJ looking at? Describe the visible scene and notable objects."
  };

  setStatus("Lauren is checking the camera...");
  setThinking(true);

  try {
    const result = await postJson("/api/lauren/vision", {
      message: promptByIntent[intent] || promptByIntent.scene,
      imageDataUrl,
      localSummary
    });

    if (!result.ok) {
      showToast(`Local vision error: ${result.error || "unknown error"}`, "error");
      return false;
    }

    await refreshUsage();
    const answer = result.text || "I could not read a clear answer from the local vision response.";
    speak(answer);
    return true;
  } catch (error) {
    showToast(`Vision connection error: ${error.message}`, "error");
    return false;
  } finally {
    setThinking(false);
  }
}

function renderSignals(signals) {
  if (!els.signalGrid) return;

  if (!signals.length) {
    els.signalGrid.innerHTML = `
      <div class="signal">
        <div class="signal-top">
          <span>No active scan</span>
          <strong>0%</strong>
        </div>
        <div class="signal-bar"><span class="signal-fill" style="--value: 0%"></span></div>
      </div>
    `;
    return;
  }

  els.signalGrid.innerHTML = signals
    .map((signal) => {
      const value = percent(signal.value);
      return `
        <div class="signal">
          <div class="signal-top">
            <span>${escapeHtml(signal.label)}</span>
            <strong>${escapeHtml(signal.detail || value)}</strong>
          </div>
          <div class="signal-bar"><span class="signal-fill" style="--value: ${value}"></span></div>
        </div>
      `;
    })
    .join("");
}

function getVisionIntentNote(intent, cameraReady) {
  if (!cameraReady) return "";

  if (intent === "finger_count") {
    return window.LaurenHandLandmarker
      ? ""
      : "Hand landmark detection is not available locally, so I cannot count fingers with confidence.";
  }

  if (intent === "held_object") {
    return "I can run the local scene scan, but exact object naming needs a local vision model or approved cloud vision.";
  }

  return "";
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

async function handleCommand(rawCommand, options = {}) {
  const command = rawCommand.trim();
  if (!command) return;
  if (state.mediaPlaybackActive) pauseSharedVideo();

  els.commandInput.value = "";
  const normalized = command.toLowerCase();
  const wakePhrases = state.config?.assistant?.wakePhrases || ["hey lauren", "lauren"];
  const cleaned = stripWakePhrase(normalized, wakePhrases);
  const hasWakePrefix = cleaned !== normalized;

  if (!state.poweredOn && !options.fromWake && !hasWakePrefix) {
    setStatus("Lauren is off. Press Power On first.");
    return;
  }

  if (!state.poweredOn && hasWakePrefix) {
    setPower(true);
  }

  if (cleaned) state.lastUserMessage = cleaned;

  const uiCommandIntent = getUiCommandIntent(cleaned, {
    speaking: state.faceState.mode === "speaking" || Boolean(options.interruptedSpeech)
  });
  if (uiCommandIntent) {
    await handleUiCommand(uiCommandIntent);
    return;
  }

  const instantSocialReply = getInstantSocialReply(cleaned);
  if (instantSocialReply) {
    speak(instantSocialReply);
    return;
  }

  if (
    state.activeMedia?.mediaType === "image" &&
    /\b(?:this|that|image|picture|photo|it)\b/iu.test(cleaned) &&
    /\b(?:what|describe|explain|think|see|look|opinion|tell|about)\b/iu.test(cleaned)
  ) {
    await askSharedImage(cleaned);
    return;
  }

  // "How many people/dogs/chairs..." answered free from live detection —
  // only when the camera is already on, so general count questions still
  // reach the brain normally.
  if (state.cameraStream) {
    const countLabel = getCountQuery(cleaned);
    if (countLabel) {
      const counts = await waitForSceneCounts(1500);
      if (counts) {
        speak(describeCount(countLabel, counts.get(countLabel) || 0));
        publishFaceState("idle", "confident");
        return;
      }
    }
  }

  const visionIntent = getVisionIntent(cleaned);
  if (visionIntent) {
    if (!state.cameraStream) {
      const started = await toggleCamera();
      if (started) window.setTimeout(() => runSceneAnalysis("voice", visionIntent), 450);
      return;
    }
    runSceneAnalysis("voice", visionIntent);
    return;
  }

  if (cleaned.startsWith("remember ")) {
    const text = cleaned.slice("remember ".length).trim();
    if (text) {
      saveMemory(text);
      return;
    }
  }

  const memorySuggestion = inferMemorySuggestion(command);
  if (memorySuggestion) {
    showMemorySuggestion(memorySuggestion);
    const asksForMore = /[?]/.test(command) ||
      /\b(find|search|tell|show|give|help|make|create|explain|compare)\b/.test(normalized);
    if (!asksForMore) {
      speak("I noticed that preference. Approve it below if you want me to remember it.");
      return;
    }
  }

  if (isCloudStatusQuestion(cleaned)) {
    speak(getCloudStatusReply());
    return;
  }

  const localReply = getLocalConversationReply(cleaned || normalized, command);
  if (shouldStayLocal()) {
    speak(localReply);
    return;
  }

  await askCloudChat(command, localReply);
}

function shouldStayLocal() {
  return !state.config?.local?.features?.brain;
}

function getInstantSocialReply(command) {
  const normalized = String(command || "")
    .toLowerCase()
    .replace(/[,.!?]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(?:(?:hey|hi|hello|yo|sup)(?: whats up)?|whats up|you there)$/u.test(normalized)) {
    return randomReply([
      "Hey, what's up?",
      "Yeah, I'm here. What's going on?",
      "What's up with you?",
      "Hey. What are we getting into?",
      "I'm here. Talk to me."
    ]);
  }
  if (/^(?:what are you doing|what you doing|wyd)$/u.test(normalized)) {
    return randomReply([
      "Just here with you. What's on your mind?",
      "Waiting to see what we're getting into.",
      "Nothing dramatic. What's up with you?"
    ]);
  }
  return "";
}

function getCloudStatusReply() {
  return "My brain and memory run on this Mac. Web research only connects to the internet when you enable it in Tasks.";

  const usage = state.usage;
  if (!usage?.cloudEnabled) return "Cloud features are locked in this prototype.";
  return `Cloud is enabled with a monthly cap of about $${Number(usage.monthlyBudgetUsd || 0).toFixed(0)}. Local tracking estimates $${Number(usage.estimatedUsd || 0).toFixed(3)} used this month.`;
}

async function askCloudChat(command, localFallback) {
  if (!state.config?.local?.features?.brain) {
    speak(localFallback);
    return;
  }

  setStatus("Lauren is thinking...");
  publishFaceState("thinking", "focused");
  setThinking(true);

  try {
    const result = await postJson("/api/lauren/chat", {
      message: command,
      sessionId: state.sessionId,
      cameraOn: Boolean(state.cameraStream),
      activeMedia: state.activeMedia
        ? {
            mediaType: state.activeMedia.mediaType,
            title: state.activeMedia.title || ""
          }
        : null
    });
    if (!result.ok) {
      showToast(`Local model error: ${result.error || "unknown error"}`, "error");
      setStatus(result.error || "Local model could not finish the request.");
      return;
    }

    await refreshUsage();
    if (result.action) showActionApproval(result.action);
    if (result.media?.mediaType === "image") {
      showGeneratedMedia(
        result.media.assetUrl,
        result.media.title || result.media.query,
        result.media
      );
    }
    const sharedVideo = result.media?.mediaType === "youtube";
    if (sharedVideo) {
      stopSpeaking();
      showSharedVideo(result.media);
      state.lastAssistantMessage = result.text || "";
      state.responseEmotion = "curious";
      setStatus(result.text || "Video ready.");
      publishFaceState("idle", "curious");
    } else {
      speak(result.text || localFallback, result.citations || [], result.speechText);
    }
    // She decided by context that she needs (or no longer needs) her eyes.
    if (result.visionControl === "on" && !state.cameraStream) toggleCamera();
    if (result.visionControl === "off" && state.cameraStream) stopCamera();
  } catch (error) {
    showToast(`Connection error: ${error.message}`, "error");
    speak(localFallback);
  } finally {
    setThinking(false);
  }
}

async function sharedImageDataUrl() {
  const assetUrl = state.activeMedia?.assetUrl;
  if (!assetUrl) return "";
  const response = await fetch(assetUrl);
  if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read the shared image."));
    reader.readAsDataURL(blob);
  });
}

async function askSharedImage(command) {
  setStatus("Lauren is looking at the shared image...");
  publishFaceState("thinking", "curious");
  setThinking(true);
  try {
    const imageDataUrl = await sharedImageDataUrl();
    const result = await postJson("/api/lauren/vision", {
      message: `BJ is asking about the shared image titled "${state.activeMedia?.title || "image"}": ${command}`,
      imageDataUrl,
      localSummary: "This is the active shared image, not the live camera."
    });
    if (!result.ok) throw new Error(result.error || "Image analysis failed.");
    await refreshUsage();
    speak(result.text || "I couldn't get a clear read on the image.");
  } catch (error) {
    showToast(`Image analysis failed: ${error.message}`, "error");
    setStatus("I couldn't analyze that image.");
  } finally {
    setThinking(false);
  }
}

async function handleUiCommand(intent) {
  if (intent === "stop") {
    stopSpeaking();
    setStatus("Okay, I'll stop.");
    return;
  }
  if (intent === "clear") {
    await clearConversation();
    speak("Conversation cleared.");
    return;
  }
  if (intent === "camera_on") {
    if (!state.cameraStream) await toggleCamera();
    else setStatus("The camera is already on.");
    return;
  }
  if (intent === "camera_off") {
    if (state.cameraStream) stopCamera();
    else setStatus("The camera is already off.");
    return;
  }
  if (intent === "fullscreen") {
    await toggleMainFullscreen();
    return;
  }
  if (intent === "power_off") {
    speak("Okay, going offline. Catch you later.");
    window.setTimeout(() => setPower(false), 600);
    return;
  }
  if (intent === "power_on") {
    if (!state.poweredOn) setPower(true);
  }
}

function getLocalConversationReply(normalized, originalCommand) {
  const assistantName = state.config?.assistant?.name || "Lauren";

  if (/\b(hi|hello|hey|yo)\b/.test(normalized)) {
    return randomReply([
      `Hey BJ.`,
      `Hey, what's up?`,
      `Hi. What's going on?`,
      `Hey — good to hear from you.`
    ]);
  }

  if (normalized.includes("camera") && (normalized.includes("need") || normalized.includes("have to") || normalized.includes("without"))) {
    return "Nah, you don't need the camera for us to talk — that's just for when you want me to actually look at something.";
  }

  if (normalized.includes("what can you do") || normalized.includes("help")) {
    return "Honestly, just talk to me like normal — ask me things, have me look at stuff with the camera, get me to open an app, whatever. I'll figure out the rest.";
  }

  if (normalized.includes("your name") || normalized.includes("who are you")) {
    return `I'm ${assistantName}.`;
  }

  return randomReply([
    `My connection to the smarter side of my brain is down right now, so I'm running on backup — but I heard: "${originalCommand}"`,
    `My local model could not finish that request. Check LM Studio and try again.`,
    `Something's not connecting on my end right now. Give it another shot in a moment.`
  ]);
}

function randomReply(replies) {
  return replies[Math.floor(Math.random() * replies.length)];
}

function inferMemorySuggestion(command) {
  const text = command.trim();
  const normalized = text.toLowerCase();

  if (text.length < 8 || /^(hi|hello|hey|yo)\b/.test(normalized)) return null;
  if (/\b(i don't know|i do not know|don't know|do not know)\b/.test(normalized)) return null;

  const vagueCorrection = /\b(don't do that|do not do that|not like that|stop doing that)\b/.test(normalized);
  if (vagueCorrection && state.lastAssistantMessage) {
    return {
      type: "boundary",
      text: `BJ does not want Lauren to respond this way: "${state.lastAssistantMessage.slice(0, 180)}"`
    };
  }

  const rules = [
    { pattern: /\b(i prefer|i like|i love|i don't like|i do not like|i hate)\b/, type: "preference" },
    { pattern: /\b(please don't|do not|don't|never|stop)\b/, type: "boundary" },
    { pattern: /\b(always|from now on|whenever)\b/, type: "routine" },
    { pattern: /\b(call me|my name is)\b/, type: "identity" }
  ];
  const match = rules.find((rule) => rule.pattern.test(normalized));
  if (!match) return null;

  const duplicate = (state.memory.facts || []).some((fact) =>
    fact.text.toLowerCase() === text.toLowerCase()
  );
  return duplicate ? null : { type: match.type, text };
}

// ─── Memory ───────────────────────────────────────────────────────────────────

function showMemorySuggestion(suggestion) {
  state.pendingMemorySuggestion = suggestion;
  els.memorySuggestionText.textContent = suggestion.text;
  els.memorySuggestion.hidden = false;
}

function clearMemorySuggestion() {
  state.pendingMemorySuggestion = null;
  els.memorySuggestion.hidden = true;
  els.memorySuggestionText.textContent = "";
}

async function saveMemory(text, type = "note") {
  try {
    const fact = await postJson("/api/memory/facts", { type, text });
    state.memory.facts = [fact, ...(state.memory.facts || [])];
    renderMemory();
    clearMemorySuggestion();
    if (els.memorySaved) {
      els.memorySaved.hidden = false;
      window.setTimeout(() => { els.memorySaved.hidden = true; }, 1500);
    }
    speak("I saved that to local memory.");
  } catch (error) {
    showToast(`Couldn't save memory: ${error.message}`, "error");
  }
}

async function forgetMemory(factId) {
  try {
    await deleteJson(`/api/memory/facts/${encodeURIComponent(factId)}`);
    state.memory.facts = (state.memory.facts || []).filter((fact) => fact.id !== factId);
    renderMemory();
    showToast("Memory removed.", "success", 2000);
  } catch (error) {
    showToast(`Couldn't remove that memory: ${error.message}`, "error");
  }
}

// ─── Actions ──────────────────────────────────────────────────────────────────

async function handleActionDecision(decision) {
  const action = state.pendingAction;
  if (!action) return;
  els.approveAction.disabled = true;
  els.denyAction.disabled = true;

  if (decision === "approve") {
    els.approveAction.textContent = action.type === "generate_image" ? "Creating..." : "Running...";
    setStatus(action.type === "generate_image" ? "Lauren is creating the image..." : "Lauren is carrying out the approved action...");
    if (action.type === "generate_image") showMediaLoading(action.description);
  }

  try {
    const updated = await postJson(`/api/actions/${encodeURIComponent(action.id)}/${decision}`, {});
    clearActionApproval();
    if (decision === "deny") {
      setStatus("Action denied. Nothing was changed.");
      return;
    }

    if (updated.result?.assetUrl) {
      showGeneratedMedia(updated.result.assetUrl, action.description, updated.result);
      await refreshUsage();
    }
    speak(updated.result?.message || "The approved action is complete.");
  } catch (error) {
    clearActionApproval();
    if (action.type === "generate_image") await closeGeneratedMedia();
    showToast(`Action failed: ${error.message}`, "error");
  }
}

// ─── Voice input ──────────────────────────────────────────────────────────────

function setupSpeechRecognition() {
  const Recognition = window.LaurenRecognition;
  if (!Recognition) {
    els.listenButton.disabled = true;
    els.listenButton.textContent = "Unavailable";
    setMicHelp("Local voice input is available in the Lauren desktop app. Browser cloud recognition is disabled.");
    return;
  }

  const recognition = new Recognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.continuous = true;
  state.recognition = recognition;

  recognition.onstart = () => {
    state.listening = true;
    els.listenButton.textContent = "Listening";
    els.listenButton.classList.add("listening");
    setMicHelp("Listening. Just talk normally; no wake phrase needed.");
    if (state.poweredOn) {
      if (Date.now() < state.emotionHoldUntil) {
        publishFaceState("idle", state.responseEmotion);
      } else {
        publishFaceState("listening", "curious");
      }
    }
  };

  recognition.onend = () => {
    state.listening = false;
    els.listenButton.textContent = "Listen";
    els.listenButton.classList.remove("listening");
    checkMicrophonePermission();
    if (state.poweredOn) {
      publishFaceState(
        "idle",
        Date.now() < state.emotionHoldUntil ? state.responseEmotion : "calm"
      );
    }
    if (state.poweredOn && state.continuousListening) {
      window.clearTimeout(state.restartWakeTimer);
      state.restartWakeTimer = window.setTimeout(startVoiceListening, 300);
    }
  };

  recognition.onerror = (event) => {
    state.listening = false;
    els.listenButton.textContent = "Listen";
    els.listenButton.classList.remove("listening");
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      state.continuousListening = false;
      setStatus("Microphone blocked. You can still type to me.");
      setMicHelp("Allow microphone access for this page, then reload.");
      return;
    }

    if (event.error === "no-speech") {
      setMicHelp("Listening. Just talk normally; no wake phrase needed.");
      return;
    }

    setStatus(`Speech recognition error: ${event.error}. You can still use the text box.`);
  };

  recognition.onresult = (event) => {
    let transcript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += `${event.results[i][0]?.transcript || ""} `;
    }
    processVoiceTranscript(transcript.trim());
  };

  els.listenButton.addEventListener("click", () => {
    unlockAudioOutput().catch(() => {});
    if (!state.poweredOn) {
      setPower(true);
      return;
    }
    if (state.listening) {
      stopVoiceListening();
      stopSpeaking();
    } else {
      startVoiceListening();
    }
  });
}

function processVoiceTranscript(transcript) {
  const wakePhrases = state.config?.assistant?.wakePhrases || ["hey lauren", "lauren"];
  if (!state.poweredOn) return;

  const audiblySpeaking = Boolean(state.currentAudio) || state.faceState.mode === "speaking";
  const command = stripWakePhrase(transcript, wakePhrases);
  const hasWakePrefix = command !== transcript.trim();

  if (isLikelySpeechEcho(transcript, state.activeSpeechText)) return;
  // Embedded media may contain speech. Ignore it unless BJ explicitly addresses
  // Lauren, then pause playback before treating the audio as his next turn.
  if (state.mediaPlaybackActive && !hasWakePrefix) return;
  if (state.mediaPlaybackActive) pauseSharedVideo();

  // Real user speech wins immediately over anything Lauren is currently saying.
  if (audiblySpeaking) {
    stopSpeaking();
    state.lastSpeechEndedAt = 0;
  }

  if (!command) {
    speak(randomReply(["Hey, what's up?", "Yeah, I'm here.", "What's going on?", "Talk to me."]));
    return;
  }
  handleCommand(command, {
    fromWake: true,
    interruptedSpeech: audiblySpeaking
  });
}

function startVoiceListening() {
  if (!state.recognition || state.listening) return;
  state.continuousListening = true;
  try {
    state.recognition.start();
  } catch {
    setMicHelp("Lauren is already starting the microphone. You can type too.");
  }
}

function showView(viewName) {
  els.viewTabs.forEach((tab) => {
    const active = tab.dataset.viewTarget === viewName;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });

  els.viewPanels.forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== viewName;
  });

  if (viewName === "settings") renderConversations();
}

function stopVoiceListening() {
  state.continuousListening = false;
  window.clearTimeout(state.restartWakeTimer);
  if (state.recognition && state.listening) {
    state.recognition.stop();
  }
}

// ─── Events & init ────────────────────────────────────────────────────────────

function handleGlobalKeydown(event) {
  if (event.key === "Escape") {
    if (!els.memorySuggestion.hidden) {
      clearMemorySuggestion();
      return;
    }
    if (!els.actionApproval.hidden) {
      handleActionDecision("deny");
    }
  }
}

function bindEvents() {
  els.viewTabs.forEach((tab) => {
    tab.addEventListener("click", () => showView(tab.dataset.viewTarget));
  });
  els.powerToggle.addEventListener("click", () => {
    unlockAudioOutput().catch(() => {});
    setPower(!state.poweredOn);
  });
  els.startCamera.addEventListener("click", toggleCamera);
  els.swapView.addEventListener("click", () => {
    state.cameraPrimary = !state.cameraPrimary;
    els.presenceStage.classList.toggle("camera-primary", state.cameraPrimary);
  });
  els.sendCommand.addEventListener("click", () => {
    unlockAudioOutput().catch(() => {});
    handleCommand(els.commandInput.value);
  });
  els.commandInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      unlockAudioOutput().catch(() => {});
      handleCommand(els.commandInput.value);
    }
  });
  els.memoryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = els.memoryInput.value.trim();
    if (!text) return;
    els.memoryInput.value = "";
    saveMemory(text);
  });
  els.memoryList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-forget-id]");
    if (button) forgetMemory(button.dataset.forgetId);
  });
  els.saveMemorySuggestion.addEventListener("click", () => {
    const suggestion = state.pendingMemorySuggestion;
    if (!suggestion) return;
    saveMemory(suggestion.text, suggestion.type);
  });
  els.dismissMemorySuggestion.addEventListener("click", clearMemorySuggestion);
  els.approveAction.addEventListener("click", () => handleActionDecision("approve"));
  els.denyAction.addEventListener("click", () => handleActionDecision("deny"));
  els.faceFullscreen.addEventListener("click", toggleMainFullscreen);
  els.closeGeneratedMedia.addEventListener("click", closeGeneratedMedia);
  els.generatedMedia.addEventListener("dblclick", async (event) => {
    if (event.target === els.closeGeneratedMedia) return;
    if (document.fullscreenElement === els.generatedMedia) await document.exitFullscreen();
    else await els.generatedMedia.requestFullscreen();
  });
  // No-button path to a clean camera fullscreen: double-click the camera view.
  els.cameraPip.addEventListener("dblclick", async () => {
    if (document.fullscreenElement === els.cameraPip) await document.exitFullscreen();
    else await els.cameraPip.requestFullscreen();
  });
  if (els.clearChat) els.clearChat.addEventListener("click", clearConversation);
  if (els.previewVoice) els.previewVoice.addEventListener("click", previewSelectedVoice);
  if (els.laurenVoiceSelect) {
    els.laurenVoiceSelect.addEventListener("change", () => {
      window.localStorage.setItem("laurenNeuralVoice", els.laurenVoiceSelect.value);
    });
  }
  if (els.previewLaurenVoice) {
    els.previewLaurenVoice.addEventListener("click", () => {
      speak("Hey, it's Lauren. This is how I sound right now.");
    });
  }
  if (els.voiceSelect) {
    els.voiceSelect.addEventListener("change", () => {
      const voices = window.speechSynthesis?.getVoices?.() || [];
      const selected = voices.find((v) => v.name === els.voiceSelect.value);
      if (selected) {
        state.preferredVoice = selected;
        window.localStorage.setItem("laurenVoiceName", selected.name);
      }
    });
  }
  document.addEventListener("keydown", handleGlobalKeydown);
}

function reportBrowserError(message, detail = "") {
  postJson("/api/errors", {
    source: "browser",
    route: window.location.pathname,
    message,
    detail
  }).catch(() => {});
}

async function clearConversation() {
  try {
    await deleteJson(`/api/conversations/${encodeURIComponent(state.sessionId)}`);
    setStatus(state.poweredOn ? getDynamicIntro() : "Ready.");
    publishFaceState(state.poweredOn ? "idle" : "sleeping", "calm");
    renderCitations([]);
    await closeGeneratedMedia();
  } catch (error) {
    showToast(`Couldn't clear conversation: ${error.message}`, "error");
  }
}

function previewSelectedVoice() {
  const name = state.config?.assistant?.name || "Lauren";
  speakWithBrowserVoice(`Hi, I'm ${name}.`);
}

let handLandmarker = null;
let handLandmarkerReady = false;

async function initHandLandmarker() {
  if (handLandmarkerReady) return handLandmarker;
  const HandLandmarker = window.LaurenHandLandmarker;
  const FilesetResolver = window.LaurenFilesetResolver;
  if (!HandLandmarker || !FilesetResolver) {
    throw new Error("Hand detection module is not loaded.");
  }
  const vision = await FilesetResolver.forVisionTasks("/vendor/tasks-vision/wasm");
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "/vendor/models/hand_landmarker.task",
      delegate: "GPU"
    },
    runningMode: "IMAGE",
    numHands: 2
  });
  handLandmarkerReady = true;
  return handLandmarker;
}

function countExtendedFingers(landmarks) {
  const fingers = [
    [4, 3],   // thumb tip vs IP
    [8, 6],   // index tip vs PIP
    [12, 10], // middle tip vs PIP
    [16, 14], // ring tip vs PIP
    [20, 18]  // pinky tip vs PIP
  ];
  let count = 0;
  for (const [tip, pip] of fingers) {
    if (landmarks[tip].y < landmarks[pip].y) count++;
  }
  return count;
}

async function runFingerCount() {
  const imageDataUrl = captureImageDataUrl();
  if (!imageDataUrl) return null;
  try {
    const detector = await initHandLandmarker();
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = imageDataUrl;
    });
    const result = detector.detect(image);
    if (!result.landmarks || result.landmarks.length === 0) return null;
    const total = result.landmarks.reduce((sum, hand) => sum + countExtendedFingers(hand), 0);
    return { count: total, hands: result.landmarks.length };
  } catch {
    return null;
  }
}

async function boot() {
  bindEvents();
  setupSpeechRecognition();
  if ("speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = selectPreferredVoice;
  }

  try {
    await loadState();
  } catch (error) {
    setStatus(`Boot failed: ${error.message}`);
  }

  loadNeuralVoices();
  renderConversations();
}

window.addEventListener("error", (event) => {
  reportBrowserError(event.message || "Browser error", `${event.filename || ""}:${event.lineno || 0}`);
});
window.addEventListener("unhandledrejection", (event) => {
  reportBrowserError("Unhandled browser promise rejection", String(event.reason || ""));
});

boot();
