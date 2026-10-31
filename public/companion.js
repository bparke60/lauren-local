const $ = (s) => document.querySelector(s);
let voice = false;
let audio;
let pending = false;
const session = "desktop-local";
async function post(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const p = await r.json();
    throw Error(p.error || "Request failed");
  }
  return r;
}
async function face(mode) {
  await post("/api/events", {
    type: "face.state",
    source: "desktop",
    payload: { mode, emotion: mode === "thinking" ? "focused" : "warm" },
  }).catch(() => {});
}
async function send() {
  const text = $("#input").value.trim();
  if (!text || pending) return;
  pending = true;
  $("#send").disabled = true;
  $("#input").value = "";
  if (audio) audio.pause();
  $("#answer").textContent = "Thinking…";
  $("#state").textContent = "Working locally";
  face("thinking");
  try {
    const r = await post("/api/lauren/chat", {
      message: text,
      sessionId: session,
    });
    const result = await r.json();
    $("#answer").textContent = result.text;
    $("#state").textContent =
      `${(result.elapsedMs / 1000).toFixed(1)}s · local`;
    face("idle");
    if (voice) {
      try {
        const speech = await post("/api/lauren/speak", {
          text: result.speechText || result.text,
        });
        const blob = await speech.blob();
        const url = URL.createObjectURL(blob);
        audio = new Audio(url);
        audio.onended = () => {
          URL.revokeObjectURL(url);
          face("idle");
        };
        face("speaking");
        await audio.play();
      } catch {
        face("idle");
        $("#state").textContent = "Local voice unavailable · text shown";
      }
    }
  } catch (error) {
    $("#answer").textContent = error.message;
    $("#state").textContent = "Try again when ready";
    face("idle");
  } finally {
    pending = false;
    $("#send").disabled = false;
  }
}
$("form").onsubmit = (e) => {
  e.preventDefault();
  send();
};
$("#voice").onclick = () => {
  voice = !voice;
  $("#voice").textContent = voice ? "Voice on" : "Voice off";
  if (!voice && audio) {
    audio.pause();
    face("idle");
  }
};
if (window.webkit?.messageHandlers?.lauren) {
  $("#mic").hidden = false;
  $("#mic").onclick = () =>
    window.webkit.messageHandlers.lauren.postMessage("listen");
}
window.laurenTranscript = (text) => {
  $("#input").value = text;
  $("#state").textContent = "Heard you · review and send";
};
window.laurenSpeechError = (text) => {
  $("#state").textContent = text;
};
$("iframe").addEventListener("load", () => face("idle"));
