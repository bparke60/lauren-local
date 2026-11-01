import { createServer } from "node:http";
import { Store, LocalBrain, startWorker } from "./local-core.js";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getReplyWordLimit,
  getReplyTokenLimit,
  limitConversationalReply,
  sanitizeAssistantText,
  toSpeechText,
} from "./response-utils.js";
import { extractYouTubeVideoId, parseMediaRequest } from "./media-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const dataDir = path.resolve(
  process.env.LAUREN_DATA_DIR || path.join(rootDir, "data"),
);
const generatedDir = path.join(publicDir, "generated");
const configPath = path.join(rootDir, "config", "jarvis.config.json");
const memoryPath = path.join(dataDir, "memory.json");
const usagePath = path.join(dataDir, "usage.json");
const eventsPath = path.join(dataDir, "events.json");
const devicesPath = path.join(dataDir, "devices.json");
const conversationsPath = path.join(dataDir, "conversations.json");
const actionsPath = path.join(dataDir, "actions.json");
const errorsPath = path.join(dataDir, "errors.json");
const envPath = path.join(rootDir, ".env.local");
const port = Number(process.env.PORT || 4327);
const host = "127.0.0.1";
const eventClients = new Set();
const writeLocks = new Map();
const startedAt = new Date().toISOString();
let activeSpeechProcess = null;

// ─── Local neural voice service (Kokoro) ─────────────────────────────────────
const voiceServiceUrl = "http://127.0.0.1:4318";
const voiceServicePython =
  process.env.LAUREN_VOICE_PYTHON ||
  path.join(rootDir, "voice-service", ".venv", "bin", "python");
const voiceServiceScript = path.join(rootDir, "voice-service", "service.py");
let voiceServiceProcess = null;

function startVoiceService() {
  if (!existsSync(voiceServicePython) || !existsSync(voiceServiceScript))
    return;
  voiceServiceProcess = spawn(voiceServicePython, [voiceServiceScript], {
    cwd: path.join(rootDir, "voice-service"),
    stdio: "ignore",
    env: { ...process.env, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" },
  });
  voiceServiceProcess.once("exit", () => {
    voiceServiceProcess = null;
  });
  voiceServiceProcess.once("error", () => {
    voiceServiceProcess = null;
  });
}

function stopVoiceService() {
  if (voiceServiceProcess && !voiceServiceProcess.killed)
    voiceServiceProcess.kill();
  voiceServiceProcess = null;
}

process.once("exit", stopVoiceService);
process.once("SIGINT", () => {
  stopVoiceService();
  process.exit(0);
});
process.once("SIGTERM", () => {
  stopVoiceService();
  process.exit(0);
});

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".tflite": "application/octet-stream",
  ".task": "application/octet-stream",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const knownApplications = new Map([
  ["calendar", "Calendar"],
  ["calculator", "Calculator"],
  ["facetime", "FaceTime"],
  ["finder", "Finder"],
  ["mail", "Mail"],
  ["maps", "Maps"],
  ["messages", "Messages"],
  ["music", "Music"],
  ["notes", "Notes"],
  ["preview", "Preview"],
  ["safari", "Safari"],
  ["settings", "System Settings"],
  ["system settings", "System Settings"],
]);

const knownWebsites = new Map([
  ["google", "https://www.google.com"],
  ["openai", "https://platform.openai.com"],
  ["youtube", "https://www.youtube.com"],
]);

// ─── Utilities ────────────────────────────────────────────────────────────────

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body, null, 2));
}

async function loadLocalEnv() {}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_500_000)
        req.destroy(new Error("Request body too large"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readBodyJson(req) {
  const body = await readRequestBody(req);
  try {
    return JSON.parse(body || "{}");
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return structuredClone(fallback);
    throw error;
  }
}

async function writeJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function mutateJson(filePath, fallback, mutate) {
  const previous = writeLocks.get(filePath) || Promise.resolve();
  const next = previous.then(async () => {
    const current = await readJson(filePath, fallback);
    const result = await mutate(current);
    await writeJson(filePath, current);
    return result;
  });
  writeLocks.set(
    filePath,
    next.catch(() => {}),
  );
  return next;
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanText(value, maxLength = 2400) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function sanitizeSessionId(value) {
  const cleaned = String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 90);
  return cleaned || "default";
}

function broadcastEvent(event) {
  const payload = `event: lauren\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of eventClients) client.write(payload);
}

async function publishEvent(incoming) {
  const event = {
    id: createId("event"),
    type: cleanText(incoming.type || "state", 60),
    source: cleanText(incoming.source || "mac-core", 80),
    target: cleanText(incoming.target || "all", 80),
    payload:
      incoming.payload && typeof incoming.payload === "object"
        ? incoming.payload
        : {},
    createdAt: new Date().toISOString(),
  };
  await mutateJson(eventsPath, [], (events) => {
    events.unshift(event);
    events.splice(250);
  });
  broadcastEvent(event);
  return event;
}

async function recordError(error, context = {}) {
  const entry = {
    id: createId("error"),
    message: cleanText(error instanceof Error ? error.message : error, 500),
    source: cleanText(context.source || "server", 80),
    route: cleanText(context.route || "", 180),
    detail: cleanText(context.detail || "", 800),
    createdAt: new Date().toISOString(),
  };
  try {
    await mutateJson(errorsPath, [], (errors) => {
      errors.unshift(entry);
      errors.splice(100);
    });
  } catch {
    // Error reporting should never hide the original failure.
  }
  return entry;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

async function getUsage() {
  const usage = await readJson(usagePath, {
    month: currentMonth(),
    estimatedUsd: 0,
    requests: [],
  });
  if (usage.month !== currentMonth()) {
    return { month: currentMonth(), estimatedUsd: 0, requests: [] };
  }
  return usage;
}

function estimateTokenCostUsd(config, usage) {
  const rates = config.cloud?.providers?.openai
    ?.estimatedPricingPerMillionTokens || {
    input: 0.4,
    output: 1.6,
  };
  return (
    ((usage?.input_tokens || 0) / 1_000_000) * rates.input +
    ((usage?.output_tokens || 0) / 1_000_000) * rates.output
  );
}

function extractOutputText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  const parts = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text)
        parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function extractCitations(response) {
  const citations = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      for (const annotation of content.annotations || []) {
        if (annotation.type !== "url_citation" || !annotation.url) continue;
        citations.push({
          url: annotation.url,
          title: annotation.title || annotation.url,
          startIndex: Number(annotation.start_index || 0),
          endIndex: Number(annotation.end_index || 0),
        });
      }
    }
    const sources = item.action?.sources || item.sources || [];
    for (const source of sources) {
      const url = source.url || source.source_url;
      if (!url) continue;
      citations.push({
        url,
        title: source.title || source.name || url,
        startIndex: 0,
        endIndex: 0,
      });
    }
  }
  return citations.filter(
    (citation, index, all) =>
      all.findIndex((candidate) => candidate.url === citation.url) === index,
  );
}

function formatTimestamp(iso) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

await mkdir(dataDir, { recursive: true });
const store = new Store(path.join(dataDir, "lauren.sqlite"));
const brain = new LocalBrain({
  store,
  config: () => readJson(configPath, {}),
  memory: () => readJson(memoryPath, { facts: [] }),
});
const worker = startWorker(store, brain);

async function callBrain({ input, tools = [] }) {
  if (tools.some((t) => t.type === "image_generation"))
    return {
      ok: false,
      status: 409,
      error:
        "Local image generation is not installed. No cloud request was made.",
    };
  const config = await readJson(configPath, {});
  try {
    return await brain.run(input, {
      network: Boolean(config.local.networkEnabled),
    });
  } catch (error) {
    return { ok: false, status: 503, error: error.message };
  }
}

async function getConversation(sessionId) {
  const store = await readJson(conversationsPath, { sessions: {} });
  return store.sessions?.[sessionId] || { id: sessionId, messages: [] };
}

async function appendConversation(sessionId, messages) {
  await mutateJson(conversationsPath, { sessions: {} }, (store) => {
    store.sessions ||= {};
    const session = store.sessions[sessionId] || {
      id: sessionId,
      messages: [],
    };
    session.messages = [
      ...(session.messages || []),
      ...messages.map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: cleanText(message.content, 3000),
        createdAt: new Date().toISOString(),
      })),
    ].slice(-24);
    session.updatedAt = new Date().toISOString();
    store.sessions[sessionId] = session;
  });
}

function normalizeActionTarget(value) {
  return cleanText(value, 500)
    .replace(/^(?:the\s+)/i, "")
    .replace(/\s+app$/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
}

function parseActionRequest(message) {
  const imageMatch = message.match(
    /^(?:please\s+)?(?:generate|create|draw|make)\s+(?:me\s+)?(?:an?\s+)?(?:image|picture|illustration|artwork)\s*(?:of|showing|for)?\s+(.+)/i,
  );
  if (imageMatch) {
    const prompt = cleanText(imageMatch[1], 1800);
    if (!prompt) return null;
    return {
      type: "generate_image",
      title: "Generate an image",
      description: prompt,
      payload: { prompt },
      estimatedCostUsd: 0.01,
    };
  }

  const openMatch = message.match(/^(?:please\s+)?open\s+(.+)/i);
  if (!openMatch) return null;
  const target = normalizeActionTarget(openMatch[1]);
  const normalized = target.toLowerCase();
  const application = knownApplications.get(normalized);
  if (application) {
    return {
      type: "open_application",
      title: `Open ${application}`,
      description: `Launch the ${application} app on this Mac.`,
      payload: { application },
      estimatedCostUsd: 0,
    };
  }

  const knownUrl = knownWebsites.get(normalized);
  const possibleUrl =
    knownUrl ||
    (/^https?:\/\//i.test(target)
      ? target
      : /^[^\s]+\.[a-z]{2,}(?:\/.*)?$/i.test(target)
        ? `https://${target}`
        : "");
  if (possibleUrl) {
    const parsed = new URL(possibleUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return {
      type: "open_url",
      title: `Open ${parsed.hostname}`,
      description: parsed.href,
      payload: { url: parsed.href },
      estimatedCostUsd: 0,
    };
  }
  return null;
}

async function createAction(proposal, sessionId) {
  const action = {
    id: createId("action"),
    ...proposal,
    sessionId,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await mutateJson(actionsPath, [], (actions) => {
    actions.unshift(action);
    actions.splice(100);
  });
  return action;
}

async function updateAction(actionId, update) {
  return mutateJson(actionsPath, [], (actions) => {
    const action = actions.find((candidate) => candidate.id === actionId);
    if (!action) return null;
    Object.assign(action, update, { updatedAt: new Date().toISOString() });
    return structuredClone(action);
  });
}

function launchOpen(argumentsList) {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/open", argumentsList, {
      detached: true,
      stdio: "ignore",
    });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
    child.once("error", reject);
  });
}

// ─── Action execution ─────────────────────────────────────────────────────────

async function generateImage(prompt) {
  const result = await callBrain({
    input: `Draw this image: ${prompt}`,
    maxOutputTokens: 120,
    tools: [
      {
        type: "image_generation",
        action: "generate",
        size: "1024x1024",
        quality: "low",
        output_format: "png",
      },
    ],
    toolChoice: { type: "image_generation" },
    kind: "image_generation",
    fixedExtraCostUsd: 0.006,
  });
  if (!result.ok) throw new Error(result.error);

  const generation = result.output.find(
    (item) => item.type === "image_generation_call" && item.result,
  );
  if (!generation)
    throw new Error("Image generation completed without an image result.");

  await mkdir(generatedDir, { recursive: true });
  const filename = `${createId("lauren-image")}.png`;
  await writeFile(
    path.join(generatedDir, filename),
    Buffer.from(generation.result, "base64"),
  );
  const assetUrl = `/generated/${filename}`;
  await publishEvent({
    type: "media.display",
    source: "mac-core",
    target: "all-displays",
    payload: { assetUrl, mediaType: "image", prompt },
  });
  return { assetUrl, usage: result.usage };
}

async function findCommonsPhoto(query) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: "8",
    prop: "imageinfo",
    iiprop: "url|mime",
    iiurlwidth: "1600",
    origin: "*",
  });
  const response = await fetch(
    `https://commons.wikimedia.org/w/api.php?${params}`,
    {
      headers: {
        "user-agent": "LaurenPrototype/0.1 (personal assistant media lookup)",
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) throw new Error(`Photo search failed: ${response.status}`);
  const payload = await response.json();
  const queryWords = query
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word.length > 2);
  const pages = Object.values(payload.query?.pages || {})
    .filter((page) => {
      const info = page.imageinfo?.[0];
      return info?.thumburl && String(info.mime || "").startsWith("image/");
    })
    .map((page, index) => {
      const title = String(page.title || "")
        .replace(/^File:/iu, "")
        .toLowerCase();
      const exact = title.includes(query.toLowerCase()) ? 12 : 0;
      const starts = title.startsWith(query.toLowerCase()) ? 8 : 0;
      const wordMatches =
        queryWords.filter((word) => title.includes(word)).length * 3;
      return { page, score: exact + starts + wordMatches - index * 0.01 };
    })
    .sort((left, right) => right.score - left.score);
  const match = pages[0]?.page;
  const info = match?.imageinfo?.[0];
  if (!match || !info)
    throw new Error("I couldn't find a usable Commons photo for that.");

  const title = String(match.title || query)
    .replace(/^File:/iu, "")
    .replace(/_/gu, " ");
  return {
    mediaType: "image",
    assetUrl: info.thumburl,
    title,
    sourceUrl: info.descriptionurl || info.url,
    query,
  };
}

async function findYouTubeVideo(query, knownVideoId = "") {
  if (knownVideoId) {
    return {
      mediaType: "youtube",
      videoId: knownVideoId,
      title: "YouTube video",
      sourceUrl: `https://www.youtube.com/watch?v=${knownVideoId}`,
      query: "",
    };
  }

  const youtubeApiKey = String(process.env.YOUTUBE_API_KEY || "").trim();
  if (!youtubeApiKey) {
    const error = new Error(
      "I can play a YouTube link now, but searching YouTube by topic needs a YouTube Data API key.",
    );
    error.code = "YOUTUBE_KEY_REQUIRED";
    throw error;
  }

  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    videoEmbeddable: "true",
    safeSearch: "moderate",
    maxResults: "1",
    q: query,
    key: youtubeApiKey,
  });
  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/search?${params}`,
    {
      signal: AbortSignal.timeout(15_000),
    },
  );
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      payload.error?.message || `YouTube search failed: ${response.status}`,
    );
  }
  const result = payload.items?.[0];
  const videoId = result?.id?.videoId;
  if (!videoId)
    throw new Error("I couldn't find a playable YouTube result for that.");
  return {
    mediaType: "youtube",
    videoId,
    title: result.snippet?.title || query,
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    query,
  };
}

async function resolveMediaRequest(request) {
  const media =
    request.type === "show_photo"
      ? await findCommonsPhoto(request.query)
      : await findYouTubeVideo(request.query, request.videoId);
  await publishEvent({
    type: "media.display",
    source: "mac-core",
    target: "all-displays",
    payload: media,
  });
  return media;
}

async function executeAction(action) {
  if (action.type === "open_url") {
    await launchOpen([action.payload.url]);
    return { message: `Opened ${new URL(action.payload.url).hostname}.` };
  }
  if (action.type === "open_application") {
    await launchOpen(["-a", action.payload.application]);
    return { message: `Opened ${action.payload.application}.` };
  }
  if (action.type === "generate_image") {
    const generated = await generateImage(action.payload.prompt);
    return {
      message:
        "The image is ready and shared with Lauren's connected displays.",
      ...generated,
    };
  }
  throw new Error("This action type is not supported.");
}

// ─── API routes ───────────────────────────────────────────────────────────────

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/local") {
    const config = await readJson(configPath, {});
    let connected = false;
    try {
      const r = await fetch(config.local.baseUrl + "/models", {
        signal: AbortSignal.timeout(2500),
      });
      connected = r.ok;
    } catch {}
    return sendJson(res, 200, {
      model: config.local.model,
      connected,
      busy: brain.busy,
      networkEnabled: config.local.networkEnabled,
      jobs: store.jobs(),
      lists: store.lists(),
      runs: store.runs(),
    });
  }
  if (req.method === "POST" && pathname === "/api/local/settings") {
    const body = await readBodyJson(req);
    if (body.model) {
      if (
        !["qwen/qwen3.8-27b", "qwen/qwen3.5-9b", "google/gemma-4-e2b"].includes(
          body.model,
        )
      )
        return sendJson(res, 400, {
          error: "Choose one of the installed models.",
        });
      if (brain.busy)
        return sendJson(res, 409, {
          error:
            "Wait for Lauren’s current task to finish before switching models.",
        });
      brain.busy = true;
      try {
        const config = await readJson(configPath, {});
        if (config.local.model !== body.model) {
          const run = promisify(execFile);
          const cli = path.join(homedir(), ".lmstudio", "bin", "lms");
          await run(cli, ["unload", config.local.model], {
            timeout: 60000,
          }).catch(() => {});
          await run(
            cli,
            [
              "load",
              body.model,
              "--context-length",
              "8192",
              "--parallel",
              "1",
              "--yes",
            ],
            { timeout: 120000, maxBuffer: 2_000_000 },
          );
          await mutateJson(configPath, {}, (c) => {
            c.local.model = body.model;
          });
        }
      } catch (error) {
        return sendJson(res, 503, {
          error: "Model switch failed. Check LM Studio and try again.",
        });
      } finally {
        brain.busy = false;
      }
    }
    await mutateJson(configPath, {}, (config) => {
      if (typeof body.networkEnabled === "boolean")
        config.local.networkEnabled = body.networkEnabled;
    });
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === "POST" && pathname === "/api/local/jobs") {
    const body = await readBodyJson(req);
    try {
      return sendJson(
        res,
        201,
        store.addJob(body.prompt, body.dueAt, body.network),
      );
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }
  if (
    req.method === "POST" &&
    /^\/api\/local\/jobs\/[^/]+\/(cancel|retry)$/.test(pathname)
  ) {
    const [, id, action] = pathname.match(/\/jobs\/([^/]+)\/(cancel|retry)$/);
    const changed = action === "cancel" ? store.cancel(id) : store.retry(id);
    return sendJson(res, changed ? 200 : 409, { ok: Boolean(changed) });
  }

  if (req.method === "GET" && pathname === "/api/config") {
    return sendJson(res, 200, await readJson(configPath, {}));
  }

  if (req.method === "GET" && pathname === "/api/health") {
    await loadLocalEnv();
    const [config, usage, errors] = await Promise.all([
      readJson(configPath, {}),
      getUsage(),
      readJson(errorsPath, []),
    ]);
    return sendJson(res, 200, {
      ok: true,
      startedAt,
      uptimeSeconds: Math.round(process.uptime()),
      storage: "local_json",
      apiKeyConfigured: false,
      local: true,
      busy: brain.busy,
      endpoint: config.local.baseUrl,
      networkEnabled: config.local.networkEnabled,
      cloudEnabled: Boolean(
        config.cloud?.enabled && config.cloud?.providers?.openai?.enabled,
      ),
      model: config.local?.model || null,
      estimatedUsd: usage.estimatedUsd || 0,
      monthlyBudgetUsd: config.cloud?.monthlyBudgetUsd || 0,
      recentErrorCount: errors.filter(
        (entry) =>
          Date.now() - new Date(entry.createdAt).getTime() < 86_400_000,
      ).length,
    });
  }

  if (req.method === "GET" && pathname === "/api/memory") {
    return sendJson(
      res,
      200,
      await readJson(memoryPath, { facts: [], routines: [] }),
    );
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/memory/facts/")) {
    const factId = decodeURIComponent(
      pathname.slice("/api/memory/facts/".length),
    );
    const removed = await mutateJson(
      memoryPath,
      { facts: [], routines: [] },
      (memory) => {
        const before = memory.facts?.length || 0;
        memory.facts = (memory.facts || []).filter(
          (fact) => fact.id !== factId,
        );
        return before !== memory.facts.length;
      },
    );
    return sendJson(res, removed ? 200 : 404, { ok: removed });
  }

  if (req.method === "GET" && pathname === "/api/usage") {
    const config = await readJson(configPath, {});
    const usage = await getUsage();
    return sendJson(res, 200, {
      ...usage,
      monthlyBudgetUsd: config.cloud?.monthlyBudgetUsd || 0,
      cloudEnabled: Boolean(
        config.cloud?.enabled && config.cloud?.providers?.openai?.enabled,
      ),
    });
  }

  if (req.method === "GET" && pathname === "/api/events") {
    return sendJson(res, 200, (await readJson(eventsPath, [])).slice(0, 50));
  }

  if (req.method === "GET" && pathname === "/api/events/stream") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write("retry: 1500\n\n");
    eventClients.add(res);
    const events = await readJson(eventsPath, []);
    if (events[0])
      res.write(`event: lauren\ndata: ${JSON.stringify(events[0])}\n\n`);
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 20_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      eventClients.delete(res);
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/events") {
    return sendJson(res, 201, await publishEvent(await readBodyJson(req)));
  }

  if (req.method === "POST" && pathname === "/api/errors") {
    const body = await readBodyJson(req);
    const entry = await recordError(cleanText(body.message, 500), {
      source: cleanText(body.source || "browser", 80),
      route: cleanText(body.route, 180),
      detail: cleanText(body.detail, 800),
    });
    return sendJson(res, 201, { ok: true, id: entry.id });
  }

  if (req.method === "POST" && pathname === "/api/lauren/speak") {
    const body = await readBodyJson(req);
    const text = cleanText(body.text, 2400);
    if (!text) return sendJson(res, 400, { error: "Speech text is required." });
    const config = await readJson(configPath, {});

    // Prefer the local neural voice service; it returns WAV audio the browser
    // plays. Retry once so a transient hiccup doesn't switch her voice.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const voiceResponse = await fetch(`${voiceServiceUrl}/speak`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text,
            voice:
              cleanText(body.voice, 40) ||
              config.voice?.localService?.defaultVoice ||
              "af_heart",
          }),
          signal: AbortSignal.timeout(30_000),
        });
        if (voiceResponse.ok) {
          const audio = Buffer.from(await voiceResponse.arrayBuffer());
          res.writeHead(200, {
            "content-type": "audio/wav",
            "content-length": audio.length,
            "cache-control": "no-store",
          });
          return res.end(audio);
        }
      } catch {
        // Service not running or still warming up.
      }
      if (attempt === 0)
        await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    return sendJson(res, 503, {
      error:
        "Local voice is unavailable. No fallback voice or cloud speech was used.",
    });
  }

  if (req.method === "POST" && pathname === "/api/lauren/speak/stop") {
    if (activeSpeechProcess && !activeSpeechProcess.killed)
      activeSpeechProcess.kill();
    activeSpeechProcess = null;
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && pathname === "/api/devices") {
    return sendJson(res, 200, await readJson(devicesPath, []));
  }

  if (req.method === "POST" && pathname === "/api/devices/register") {
    const incoming = await readBodyJson(req);
    const id = cleanText(incoming.id, 80);
    if (!id) return sendJson(res, 400, { error: "Device id is required." });
    const device = {
      id,
      label: cleanText(incoming.label || id, 100),
      type: cleanText(incoming.type || "display", 40),
      capabilities: Array.isArray(incoming.capabilities)
        ? incoming.capabilities
            .map((value) => cleanText(value, 60))
            .slice(0, 20)
        : [],
      status: "online",
      lastSeenAt: new Date().toISOString(),
    };
    await mutateJson(devicesPath, [], (devices) => {
      const existingIndex = devices.findIndex((item) => item.id === device.id);
      if (existingIndex >= 0) devices.splice(existingIndex, 1);
      devices.unshift(device);
      devices.splice(100);
    });
    return sendJson(res, 200, device);
  }

  if (req.method === "GET" && pathname === "/api/actions") {
    const status = url.searchParams.get("status");
    const actions = await readJson(actionsPath, []);
    return sendJson(
      res,
      200,
      actions
        .filter((action) => !status || action.status === status)
        .slice(0, 30),
    );
  }

  const actionMatch = pathname.match(
    /^\/api\/actions\/([^/]+)\/(approve|deny)$/,
  );
  if (req.method === "POST" && actionMatch) {
    const [, actionId, decision] = actionMatch;
    const actions = await readJson(actionsPath, []);
    const action = actions.find((candidate) => candidate.id === actionId);
    if (!action) return sendJson(res, 404, { error: "Action not found." });
    if (action.status !== "pending") {
      return sendJson(res, 409, {
        error: `Action is already ${action.status}.`,
      });
    }
    if (decision === "deny") {
      const denied = await updateAction(actionId, { status: "denied" });
      return sendJson(res, 200, denied);
    }

    await updateAction(actionId, { status: "running" });
    try {
      const result = await executeAction(action);
      const completed = await updateAction(actionId, {
        status: "completed",
        result,
      });
      return sendJson(res, 200, completed);
    } catch (error) {
      await recordError(error, { source: "action", route: action.type });
      const failed = await updateAction(actionId, {
        status: "failed",
        error: cleanText(error.message, 500),
      });
      return sendJson(res, 500, failed);
    }
  }

  if (req.method === "GET" && pathname === "/api/voice/voices") {
    try {
      const health = await fetch(`${voiceServiceUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return sendJson(res, 200, await health.json());
    } catch {
      return sendJson(res, 200, { ok: false, voices: [] });
    }
  }

  if (req.method === "GET" && pathname === "/api/conversations") {
    const store = await readJson(conversationsPath, { sessions: {} });
    const sessions = Object.values(store.sessions || {})
      .map((session) => {
        const messages = session.messages || [];
        const firstUser = messages.find((entry) => entry.role === "user");
        return {
          id: session.id,
          messageCount: messages.length,
          preview: cleanText(firstUser?.content || "(empty)", 90),
          startedAt: messages[0]?.createdAt || session.updatedAt,
          updatedAt: session.updatedAt,
        };
      })
      .filter((session) => session.messageCount > 0)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return sendJson(res, 200, { sessions });
  }

  if (req.method === "GET" && pathname.startsWith("/api/conversations/")) {
    const sessionId = sanitizeSessionId(
      pathname.slice("/api/conversations/".length),
    );
    return sendJson(res, 200, await getConversation(sessionId));
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/conversations/")) {
    const sessionId = sanitizeSessionId(
      pathname.slice("/api/conversations/".length),
    );
    await mutateJson(conversationsPath, { sessions: {} }, (store) => {
      if (store.sessions?.[sessionId]) {
        store.sessions[sessionId] = {
          id: sessionId,
          messages: [],
          updatedAt: new Date().toISOString(),
        };
      }
    });
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/lauren/chat") {
    const body = await readBodyJson(req);
    const message = cleanText(body.message, 3000);
    const sessionId = sanitizeSessionId(body.sessionId);
    if (!message) return sendJson(res, 400, { error: "Message is required." });

    const config = await readJson(configPath, {});
    const conversation = await getConversation(sessionId);
    const history = (conversation.messages || []).slice(-12).map((entry) => ({
      role: entry.role,
      content: `[${formatTimestamp(entry.createdAt)}] ${
        entry.role === "assistant"
          ? sanitizeAssistantText(entry.content)
          : entry.content
      }`,
    }));
    // The search tool is always available; the model decides when to actually
    // use it, and only real searches cost the $0.01 tool fee.
    const useWebSearch = Boolean(config.local?.networkEnabled);
    const replyTokenLimit = getReplyTokenLimit(message);
    const result = await callBrain({
      input: [...history, { role: "user", content: message }],
      maxOutputTokens: replyTokenLimit,
      tools: useWebSearch
        ? [{ type: "web_search", search_context_size: "low" }]
        : [],
      include: useWebSearch ? ["web_search_call.action.sources"] : [],
      kind: useWebSearch ? "web_search" : "chat",
      instructionContext: {
        cameraOn: Boolean(body.cameraOn),
        activeMedia:
          body.activeMedia && typeof body.activeMedia === "object"
            ? {
                mediaType: cleanText(body.activeMedia.mediaType, 40),
                title: cleanText(body.activeMedia.title, 240),
              }
            : null,
      },
    });
    // The model marks genuine goodbyes with [[bye]]; strip it and tell the app.
    const conversationClosed =
      result.ok && /\[\[bye\]\]/i.test(result.text || "");
    if (conversationClosed) {
      result.text = result.text.replace(/\s*\[\[bye\]\]\s*/gi, " ").trim();
    }
    // She controls her own eyes by contextual judgment via [[vision:on|off]].
    let visionControl = null;
    if (result.ok && result.text) {
      const visionMarkers = [
        ...result.text.matchAll(/\[\[vision:(on|off)\]\]/gi),
      ];
      if (visionMarkers.length) {
        visionControl =
          visionMarkers[visionMarkers.length - 1][1].toLowerCase();
        result.text = result.text
          .replace(/\s*\[\[vision:(?:on|off)\]\]\s*/gi, " ")
          .trim();
      }
    }
    if (result.ok && result.text) {
      result.text = sanitizeAssistantText(result.text);
      result.speechText = toSpeechText(result.text);
    }
    if (result.ok) {
      await appendConversation(sessionId, [
        { role: "user", content: message },
        { role: "assistant", content: result.text },
      ]);
    }
    const { output, ...clientResult } = result;
    return sendJson(res, result.ok ? 200 : result.status || 500, {
      ...clientResult,
      conversationClosed,
      visionControl,
    });
  }

  if (req.method === "POST" && pathname === "/api/lauren/vision") {
    const body = await readBodyJson(req);
    const message = cleanText(
      body.message || "Analyze this camera frame.",
      1000,
    );
    const imageDataUrl = cleanText(body.imageDataUrl, 2_000_000);
    const localSummary = cleanText(body.localSummary, 1200);
    if (!imageDataUrl.startsWith("data:image/")) {
      return sendJson(res, 400, {
        error: "A camera image data URL is required.",
      });
    }
    const config = await readJson(configPath, {});
    const detail = config.cloud?.providers?.openai?.visionDetail || "low";
    const result = await callBrain({
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `${message}\n\nLocal scan clues:\n${localSummary || "No local scan available."}\n\nReply in 2-4 sentences. If counting fingers, give the count only if visible enough; otherwise say uncertain.`,
            },
            { type: "input_image", image_url: imageDataUrl, detail },
          ],
        },
      ],
      maxOutputTokens: 260,
      kind: "vision",
    });
    const { output, ...clientResult } = result;
    return sendJson(res, result.ok ? 200 : result.status || 500, clientResult);
  }

  if (req.method === "POST" && pathname === "/api/memory/facts") {
    const incoming = await readBodyJson(req);
    const text = cleanText(incoming.text, 2000);
    const type = cleanText(incoming.type || "note", 40) || "note";
    if (!text) return sendJson(res, 400, { error: "Memory text is required." });
    const fact = {
      id: createId("fact"),
      type,
      text,
      createdAt: new Date().toISOString(),
    };
    await mutateJson(memoryPath, { facts: [], routines: [] }, (memory) => {
      memory.facts ||= [];
      memory.routines ||= [];
      memory.facts.unshift(fact);
      memory.facts.splice(250);
    });
    return sendJson(res, 201, fact);
  }

  return sendJson(res, 404, { error: "API route not found." });
}

// ─── Static file serving ──────────────────────────────────────────────────────

function getSafePublicPath(urlPath) {
  const requested =
    urlPath === "/"
      ? "/index.html"
      : urlPath === "/face"
        ? "/face.html"
        : decodeURIComponent(urlPath);
  const filePath = path.normalize(path.join(publicDir, requested));
  if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep))
    return null;
  return filePath;
}

async function handleStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const filePath = getSafePublicPath(url.pathname);
  if (!filePath || !existsSync(filePath)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const contents = await readFile(filePath);
  res.writeHead(200, {
    "content-type":
      contentTypes[path.extname(filePath)] || "application/octet-stream",
    "cache-control": "no-store",
  });
  res.end(contents);
}

const server = createServer(async (req, res) => {
  try {
    const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (!allowed.has(req.headers.host))
      return sendJson(res, 403, { error: "Invalid local host." });
    if (req.headers.origin && !allowed.has(new URL(req.headers.origin).host))
      return sendJson(res, 403, {
        error: "Cross-origin requests are blocked.",
      });
    if (req.headers["sec-fetch-site"] === "cross-site")
      return sendJson(res, 403, { error: "Cross-site requests are blocked." });
    if (req.url?.startsWith("/api/")) await handleApi(req, res);
    else await handleStatic(req, res);
  } catch (error) {
    await recordError(error, { route: req.url || "" });
    sendJson(res, error.statusCode || 500, {
      error: error.statusCode ? error.message : "Lauren core error.",
      detail: error.statusCode ? undefined : error.message,
    });
  }
});

await loadLocalEnv();
startVoiceService();
server.listen(port, host, () => {
  console.log(`Lauren Local running at http://localhost:${port}`);
});
