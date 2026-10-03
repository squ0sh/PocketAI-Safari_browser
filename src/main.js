import "./style.css";
import userManualHtml from "virtual:user-manual";
import { PERFORMANCE_KEY, JOURNAL_KEY, median, profileFor, configFor, readMeasurements, recordMeasurement, recommendation, measureRuns } from "./performance.js";
import { SYSTEM_PROMPT, preparePrompt } from "./context.js";
import { offlineStatus, updateOfflineApp } from "./offline.js";

// Bundled at /tokenizer/* and precached by the service worker, so loading from a
// local file needs no network at all. Qwen2Tokenizer, byte-identical across the
// 1.7B/4B/8B checkpoints (md5 415df598feeb7a2dc86e8d009284dc94). The 27B hybrid
// is qwen3_5 with a 248k vocab, so it has a separate bundled tokenizer.
const TOKENIZER_JSON = "/tokenizer/tokenizer.json";
const TOKENIZER_CONFIG = "/tokenizer/tokenizer_config.json";

const MODELS = [
  {
    id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    name: "Qwen 0.5B",
    tier: "Fast",
    description: "Smallest · known-good WebLLM baseline.",
    runtime: "webllm",
    overrides: { context_window_size: 2048, prefill_chunk_size: 128 },
  },
  {
    id: "Bonsai-1.7B-bitgpu",
    name: "Bonsai 1.7B Q1",
    tier: "1-bit",
    description: "Recommended starting point for iPhone GGUF · ~290 MB download.",
    runtime: "bitgpu",
    manifestUrl:
      "https://cdn.jsdelivr.net/gh/stfurkan/bitgpu@v0.19.1/models/bonsai-1.7b-gguf/manifest.json",
    auxUrl:
      "https://cdn.jsdelivr.net/gh/stfurkan/bitgpu@v0.19.1/models/bonsai-1.7b-gguf/Bonsai-1.7B-Q1_0.aux.bin",
    dataUrl:
      "https://huggingface.co/prism-ml/Bonsai-1.7B-gguf/resolve/main/Bonsai-1.7B-Q1_0.gguf",
    tokenizerJsonUrl: TOKENIZER_JSON,
    tokenizerConfigUrl: TOKENIZER_CONFIG,
    maxSeqLen: 4096,
    kvCache: "q8",
    kvBytesPerToken: 31 * 1024,
    generation: { temperature: 0.7, topP: 0.9, topK: 40 },
  },
  {
    id: "Bonsai-4B-bitgpu",
    name: "Bonsai 4B Q1",
    tier: "1-bit",
    description: "Larger 1-bit model · ~570 MB · bitgpu WebGPU.",
    runtime: "bitgpu",
    manifestUrl:
      "https://cdn.jsdelivr.net/gh/stfurkan/bitgpu@v0.19.1/models/bonsai-4b-gguf/manifest.json",
    auxUrl:
      "https://cdn.jsdelivr.net/gh/stfurkan/bitgpu@v0.19.1/models/bonsai-4b-gguf/Bonsai-4B-Q1_0.aux.bin",
    dataUrl:
      "https://huggingface.co/prism-ml/Bonsai-4B-gguf/resolve/main/Bonsai-4B-Q1_0.gguf",
    tokenizerJsonUrl: TOKENIZER_JSON,
    tokenizerConfigUrl: TOKENIZER_CONFIG,
    maxSeqLen: 4096,
    kvCache: "q8",
    kvBytesPerToken: 79 * 1024,
    generation: { temperature: 0.7, topP: 0.9, topK: 40 },
  },
  {
    id: "Bonsai-8B-bitgpu",
    name: "Bonsai 8B Q1",
    tier: "1-bit · Experimental",
    description: "8B parameter 1-bit model · ~1.16 GB · bitgpu WebGPU.",
    runtime: "bitgpu",
    manifestUrl:
      "https://cdn.jsdelivr.net/gh/stfurkan/bitgpu@v0.19.1/models/bonsai-8b-gguf/manifest.json",
    auxUrl:
      "https://cdn.jsdelivr.net/gh/stfurkan/bitgpu@v0.19.1/models/bonsai-8b-gguf/Bonsai-8B-Q1_0.aux.bin",
    dataUrl:
      "https://huggingface.co/prism-ml/Bonsai-8B-gguf/resolve/main/Bonsai-8B-Q1_0.gguf",
    tokenizerJsonUrl: TOKENIZER_JSON,
    tokenizerConfigUrl: TOKENIZER_CONFIG,
    maxSeqLen: 8192,
    kvCache: "q8",
    kvBytesPerToken: 88 * 1024,
    generation: { temperature: 0.7, topP: 0.9, topK: 40 },
  },
  {
    id: "Bonsai-27B-bitgpu",
    name: "Bonsai 27B Q1",
    tier: "1-bit · EXTREME",
    description:
      "27B hybrid · streams ~3.8 GB into memory every launch · phones may refuse; desktop-class experiment.",
    runtime: "bitgpu",
    manifestUrl:
      "https://cdn.jsdelivr.net/gh/stfurkan/bitgpu@v0.19.1/models/bonsai-27b-gguf/manifest.json",
    auxUrl:
      "https://cdn.jsdelivr.net/gh/stfurkan/bitgpu@v0.19.1/models/bonsai-27b-gguf/Bonsai-27B-Q1_0.aux.bin",
    dataUrl:
      "https://huggingface.co/prism-ml/Bonsai-27B-gguf/resolve/main/Bonsai-27B-Q1_0.gguf",
    tokenizerJsonUrl:
      "/tokenizer-27b/tokenizer.json",
    tokenizerConfigUrl:
      "/tokenizer-27b/tokenizer_config.json",
    maxSeqLen: 2048,
    kvCache: "q8",
    approxBytes: 3803452480,
    generation: { temperature: 0.5, topP: 0.85, topK: 20 },
  },
  {
    id: "online-assist",
    name: "Online Assist",
    tier: "Cloud",
    description: "Sends this conversation and attached page to your configured AI service. Requires internet.",
    runtime: "online",
  },
];

MODELS.push({ id: "Bonsai-27B-online", name: "Bonsai 27B online", runtime: "online", profile: "bonsai-27b", fallbackOnly: true, maxSeqLen: 2048 });

const KEY = "pocket-ai-selected-model-v4";
const CHATKEY = "pocket-ai-chats-v5";

// v0.4.4: longer answers, honest truncation, context-window-safe history.
const LOCAL_MAX_TOKENS = 512; // response budget per generation segment
const MAX_CONTINUATIONS = 2;  // chained "Continue" segments a bubble may offer
const CONTEXT_TOKENS = 2048;  // fallback when a runtime has no configured window


// IndexedDB holds durable transcripts. Session storage is a best-effort first-paint
// mirror; small compatible conversations can also retain a GPU snapshot.
const chatStore = {
  get: () => sessionStorage.getItem(CHATKEY),
  set: (v) => sessionStorage.setItem(CHATKEY, v),
};

const IDB_NAME = "pocket-ai";
const IDB_VERSION = 1;
const IDB_CHATS = "chats";
const IDB_KV = "kv";
let idb = null;
let idbReady = null;
const persistedChats = new Map();

function idbOpen() {
  if (idb) return Promise.resolve(idb);
  if (idbReady) return idbReady;
  if (!("indexedDB" in window)) return Promise.resolve(null);
  idbReady = new Promise((resolve) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(IDB_CHATS))
        d.createObjectStore(IDB_CHATS, { keyPath: "id" });
      if (!d.objectStoreNames.contains(IDB_KV))
        d.createObjectStore(IDB_KV, { keyPath: "key" });
    };
    req.onsuccess = () => { idb = req.result; resolve(idb); };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return idbReady;
}

function idbPut(store, value) {
  const snapshot = structuredClone(value);
  return idbOpen().then((db) => new Promise((resolve, reject) => {
    if (!db) { reject(new Error("Device storage is unavailable")); return; }
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(snapshot);
    tx.oncomplete = () => resolve(true);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error("Storage write failed"));
  })).catch((error) => {
    console.warn("Local save failed", error);
    if (store === IDB_CHATS) {
      persistedChats.delete(value.id);
      notifyUser("This chat could not be saved to device storage. Export it before closing the app.");
    }
    return false;
  });
}

function idbDelete(store, key) {
  idbOpen().then((db) => {
    if (!db) return;
    try {
      db.transaction(store, "readwrite").objectStore(store).delete(key);
    } catch {}
  });
}

function idbGet(store, key) {
  return idbOpen().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(undefined);
        const rq = db.transaction(store, "readonly").objectStore(store).get(key);
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => resolve(undefined);
      })
  );
}

function idbGetAll(store) {
  return idbOpen().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve([]);
        const rq = db.transaction(store, "readonly").objectStore(store).getAll();
        rq.onsuccess = () => resolve(rq.result || []);
        rq.onerror = () => resolve([]);
      })
  );
}

let selected = localStorage.getItem(KEY) || MODELS[1].id;
// Cloud consent is per session; reopening returns to the local 27B option.
if (selected === "Bonsai-27B-online") selected = "Bonsai-27B-bitgpu";
let editingIndex = null;
let lastLoadMs = null;
let loadSource = "network";
let activeLoadAbort = null;
let hydrating = true;
let pickedFile = null;   // GGUF picked via "Load from a file…"; consumed on load
let engine = null;
let chatEngine = null;
let engineRuntime = null;
let busy = false;
let generating = false;
let genAbort = null;      // AbortController for the active bitgpu segment
let stopRequested = false;

// --- load lifecycle: a load must never wedge the UI ---
// loadToken increments for every load attempt; bumping it cancels whatever is in
// flight (the Cancel button, a model switch, or a new load). Thrown when a load
// discovers it was superseded, so it unwinds without touching the UI.
let loadToken = 0;
let loadProgressAt = 0;
const ABORTED = Symbol("pocket-ai-load-aborted");

let chats = loadChats();
let active = chats[0].id;
let connectionRequest = 0;
let lastHW = null;          // last inspect() result, for honest OOM messaging

const $ = (s) => document.querySelector(s);

const chat = $("#chat");
const welcome = $("#welcome");
const welcomeCopy = welcome.querySelector("p");
const load = $("#loadButton");
const modelButton = $("#modelButton");
const sheet = $("#modelSheet");
const modelList = $("#modelList");
const input = $("#input");
const send = $("#send");
const status = $("#status");
const progressWrap = $("#progressWrap");
const progress = $("#progress");
const progressText = $("#progressText");
// A tiny stand-in keeps the load lifecycle working even if the markup is edited
// to drop the button.
const cancelLoadButton =
  $("#cancelLoadButton") || { hidden: true, onclick: null };
const errorBox = $("#errorBox");
const hardwareBox = $("#hardwareBox");
const drawer = $("#historyDrawer");
const backdrop = $("#drawerBackdrop");

function model() {
  return MODELS.find((x) => x.id === selected) || MODELS[0];
}

function isOnlineModel(m = model()) {
  return m.runtime === "online";
}

function normName(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

window.pickModelFile = function () {
  fileInput.value = "";
  fileInput.click();
};

async function readGgufFromFile(file) {
  const { fromGgufBytes } = await import("bitgpu/gguf");
  let size = 1024 * 1024;
  let lastErr = null;
  while (size <= 64 * 1024 * 1024) {
    const header = await file.slice(0, size).arrayBuffer();
    try {
      return fromGgufBytes(header, file.name);
    } catch (e) {
      lastErr = e;
      if (!String(e.message).includes("pass more bytes") || size >= file.size) break;
      size *= 2;
    }
  }
  throw new Error(
    "Couldn't read the GGUF header from that file. " +
      (lastErr && lastErr.message ? lastErr.message : lastErr)
  );
}

function matchModelByFile(name) {
  const n = normName(name);
  for (const m of MODELS.filter(m => !m.fallbackOnly)) {
    if (m.runtime !== "bitgpu") continue;
    const base = normName(m.dataUrl.split("/").pop().replace(/\.gguf$/i, ""));
    if (base && n.includes(base)) return m;
  }
  const bySlug = MODELS.find((m) => m.runtime === "bitgpu" && n.includes(normName(m.name)));
  return bySlug || null;
}

function updateWelcome() {
  const online = isOnlineModel();
  refreshConnection();

  welcomeCopy.textContent = online
    ? "Online Assist sends this chat to your configured AI service for current information."
    : "Models run directly on the device GPU. Your chat is not sent to an AI API.";

  load.textContent = online
    ? `Connect ${model().name}`
    : "Load Local AI";

  if (!engine) {
    status.textContent = online
      ? `${model().name} · not connected`
      : "Local AI · choose a model or GGUF file";
  }
}

function renderModels() {
  modelList.replaceChildren();

  for (const m of MODELS.filter(m => !m.fallbackOnly)) {
    const b = document.createElement("button");
    b.className =
      "model-option" + (m.id === selected ? " active" : "");

    const a = document.createElement("span");
    a.className = "model-option-main";

    a.innerHTML =
      `<span class="model-option-name"></span>` +
      `<span class="model-option-description"></span>`;

    a.children[0].textContent = m.name;
    a.children[1].textContent = m.description;

    const badge = document.createElement("span");
    badge.className = "model-option-badge";
    badge.textContent = m.tier;

    b.append(a, badge);

b.onclick = () => {
      if (busy) return notifyUser("Wait for the reply or stop it before switching models.");
      pickedFile = null;
      selected = m.id;
      localStorage.setItem(KEY, selected);

      modelButton.textContent = m.name;
      sheet.classList.remove("open");
      updateWelcome();

      // Picking a model never starts a download by itself. If a load is already
      // running, cancel it so it can't hold the GPU or the progress bar; the
      // user taps Load when they're ready.
      if (engine) {
        location.reload();
      } else if (load.disabled) {
        cancelLoadButton.click();
      }
    };

modelList.append(b);
  }

  addFileControls();
  renderRecommendation();
}

function addFileControls() {
  const fileRow = document.createElement("div");
  fileRow.className = "model-file-row";

  const fileButton = document.createElement("button");
  fileButton.className = "model-file-load";
  fileButton.type = "button";
  fileButton.textContent = "Load from a file…";
  fileButton.onclick = window.pickModelFile;

  const saveRow = document.createElement("div");
  saveRow.className = "model-save-row";

  const saveLabel = document.createElement("span");
  saveLabel.className = "model-save-label";
  saveLabel.textContent = "Save to Files:";

  saveRow.append(saveLabel);

  for (const m of MODELS) {
    if (m.runtime !== "bitgpu") continue;
    const chip = document.createElement("a");
    chip.className = "model-save-link";
    chip.href = m.dataUrl;
    chip.download = "";
    chip.target = "_blank";
    chip.rel = "noopener";
    chip.textContent = m.name.replace(/^Bonsai /, "").replace(/ Q1.*$/, "");
    saveRow.append(chip);
  }

  fileRow.append(fileButton, saveRow);

  modelList.append(fileRow);
}

function addBubble(role, text) {
  const b = document.createElement("div");

  b.className = `message ${role}`;
  b.textContent = text;

  chat.append(b);
  chat.scrollTop = chat.scrollHeight;

  return b;
}

function render() {
  chat.querySelectorAll(".message").forEach((x) => x.remove());
  const c = chats.find((x) => x.id === active);
  welcome.hidden = !!c?.messages.length;
  if (!welcome.hidden) chat.append(welcome);
  const sourceBadge = $("#sourceBadge");
  sourceBadge.hidden = !c?.source;
  sourceBadge.replaceChildren();
  if (c?.source) {
    const title = document.createElement("span");
    title.textContent = `Attached: ${c.source.title} · ${c.source.text.length.toLocaleString()} characters`;
    const view = document.createElement("button");
    view.type = "button"; view.textContent = "View attached text";
    view.onclick = () => $("#pageButton").click();
    sourceBadge.append(title, view);
  }
  $("#textSuggestions").hidden = !c?.source;
  $("#textSuggestions").querySelectorAll("button").forEach(button => { button.disabled = busy || hydrating || editingIndex !== null; });
  c?.messages.forEach((message, index) => {
    const bubble = addBubble(message.role, message.content);
    if (message.role === "assistant" && message.model) {
      const label = document.createElement("span");
      label.className = "source-label";
      label.textContent = `${message.runtime === "online" ? "Online" : "On device"} · ${message.model}${message.sourceTitle ? " · Reference: " + message.sourceTitle : ""}`;
      bubble.append(label);
    }
    const actions = document.createElement("div");
    actions.className = "message-actions";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = message.role === "user" ? "Edit & resend" : "Retry";
    button.disabled = busy || !engine;
    button.onclick = () => {
      if (busy || !engine) return;
      let userIndex = index;
      while (userIndex >= 0 && c.messages[userIndex].role !== "user") userIndex--;
      if (userIndex < 0) return;
      editingIndex = userIndex;
      input.value = c.messages[userIndex].content;
      if (message.role === "assistant") sendMessage({ preventDefault() {} });
      else {
        notifyUser("Editing this prompt. Sending replaces its answer and later messages. Cancel to keep them.");
        const cancel = document.createElement("button");
        cancel.textContent = "Cancel edit";
        cancel.onclick = () => { editingIndex = null; input.value = ""; notifyUser(""); };
        $("#notice").append(" ", cancel);
        input.focus();
      }
    };
    actions.append(button);
    bubble.append(actions);
    if (!busy && message.finishReason === "length" && index === c.messages.length - 1 && message.runtime !== "online" && engineRuntime === message.runtime && message.model === model().name) {
      offerContinue(c, bubble, message.content, (message.continuations || 0) + 1);
    }
  });
}

function freshChat() {
  return {
    id: crypto.randomUUID(),
    title: "New Chat",
    messages: [],
    createdAt: Date.now(),
    source: null,
  };
}

function loadChats() {
  try {
    // One-time migration: chats that lived in localStorage (≤0.4.4) move into
    // the session mirror, then the durable copy is removed.
    const legacy = localStorage.getItem(CHATKEY);
    const current = chatStore.get();
    if (legacy && !current) {
      chatStore.set(legacy);
      localStorage.removeItem(CHATKEY);
    }
   const x = JSON.parse(
      chatStore.get() || "null"
    );

    if (Array.isArray(x) && x.length) {
      return x.map((c) => ({
        id: c.id || crypto.randomUUID(),
        title: c.title || "New Chat",
        messages: Array.isArray(c.messages) ? c.messages : [],
        createdAt: c.createdAt || Date.now(),
        updatedAt: c.updatedAt,
        source: c.source || null,
      }));
    }
  } catch {}

  return [freshChat()];
}

function save() {
  for (const c of chats) {
    const signature = JSON.stringify({ title: c.title, messages: c.messages, source: c.source });
    if (persistedChats.get(c.id) === signature) continue;
    c.updatedAt = Date.now();
    persistedChats.set(c.id, signature);
    idbPut(IDB_CHATS, c);
  }
  try { chatStore.set(JSON.stringify(chats)); }
  catch (error) { console.warn("Session mirror unavailable", error); }
  renderHistory();
}

// Rebuild the chat list from the durable IndexedDB copy (authoritative:
// survives tab closes). The session mirror stays as the synchronous first
// paint / reload scratch, then this merges in whatever durable data exists.
async function hydrateChatsFromIDB() {
  const rows = await idbGetAll(IDB_CHATS);
  if (!rows || !rows.length) return;
  rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const activeHadMessages = chats.some(
    (x) => x.id === active && x.messages.length
  );
  chats = rows.map((c) => ({
    id: c.id,
    title: c.title || "New Chat",
    messages: Array.isArray(c.messages) ? c.messages : [],
    createdAt: c.createdAt || Date.now(),
    updatedAt: c.updatedAt,
    source: c.source || null,
  }));
  if (!activeHadMessages || !chats.some((c) => c.id === active)) active = chats[0].id;
  try { chatStore.set(JSON.stringify(chats)); } catch {}
  render();
  renderHistory();
}

// The history drawer list. Rows: tap to open, ↓ downloads a Markdown
// transcript, × deletes. (This list was never rendered before v0.4.5.)
function renderHistory() {
  const list = $("#historyList");
  if (!list) return;
  list.innerHTML = "";
  const query = $("#historySearch").value.trim().toLowerCase();
  for (const c of chats) {
    if (query && ![c.title, ...c.messages.map((m) => m.content)].join("\n").toLowerCase().includes(query)) continue;
    const row = document.createElement("div");
    row.className = "history-item" + (c.id === active ? " active" : "");

    const open = document.createElement("button");
    open.type = "button";
    open.className = "history-open";
    open.textContent = c.title || "New Chat";
    open.onclick = () => {
      if (busy || hydrating) return notifyUser("Wait for the current operation before opening another chat.");
      editingIndex = null;
      input.value = "";
      saveKvSnapshot(true);
      resetChatKv();
      active = c.id;
      save();
      render();
      drawer.classList.remove("open");
  backdrop.hidden = true;
      drawer.setAttribute("aria-hidden", "true");
    };

    const dl = document.createElement("button");
    dl.type = "button";
    dl.className = "history-action";
    dl.textContent = "↓";
    dl.title = "Download transcript (Markdown)";
    dl.setAttribute("aria-label", "Download transcript");
    dl.onclick = (e) => { e.stopPropagation(); downloadChat(c); };

    const del = document.createElement("button");
    del.type = "button";
    del.className = "history-action";
    del.textContent = "×";
    del.title = "Delete this chat";
    del.setAttribute("aria-label", "Delete chat");
    del.onclick = (e) => { e.stopPropagation(); deleteChat(c.id); };

    row.append(open, dl, del);
    list.append(row);
  }
}

function downloadChat(c) {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [`# ${c.title}`, ``, `_Pocket AI · ${date} · ${c.messages.length} messages_`, ``];
  for (const m of c.messages) {
    lines.push(`**${m.role === "user" ? "You" : "Pocket AI"}:** ${m.content}`, ``);
  }
  if (c.source) lines.push("## Reference: " + c.source.title, "", c.source.text);
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const slug = (c.title || "chat").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "chat";
  a.href = url;
  a.download = `pocket-ai-${slug}-${date}.md`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function deleteChat(id) {
  if (busy || hydrating) return notifyUser("Wait for the current operation before deleting a chat.");
  if (!window.confirm("Delete this chat and its local snapshot? Export it first if you want to keep it.")) return;
  editingIndex = null;
  resetChatKv();
  chats = chats.filter((x) => x.id !== id);
  idbDelete(IDB_CHATS, id);
  // Tidy matching KV snapshots (chat id + every model that may have it).
  if (idb) {
    try {
      const tx = idb.transaction(IDB_KV, "readwrite");
      const st = tx.objectStore(IDB_KV);
      for (const m of MODELS) {
        if (m.runtime === "bitgpu") st.delete(`${m.id}::${id}`);
      }
    } catch {}
  }
  if (!chats.length) {
    chats = [freshChat()];
  }
  if (active === id) active = chats[0].id;
  save();
  render();
}

// Generation UI state: the send button morphs into a stop button.
function setGenerating(on) {
  generating = on;
  const m = model();
  send.disabled = false;
  send.textContent = on ? "⏹" : "↑";
  send.title = on ? "Stop generation" : "Send";
  status.textContent = on
    ? isOnlineModel()
      ? `${model().name} · generating…`
      : `Local AI · ${m.name} · generating…`
    : isOnlineModel()
      ? `${model().name} · ready`
      : engine ? `Local AI · ${m.name} · WebGPU` : "Local AI · load a model to continue";
  if (!on) send.disabled = !engine;
}

function stopGeneration() {
  stopRequested = true;
  if (engineRuntime === "bitgpu") {
    genAbort?.abort();
  } else if (engineRuntime === "online") {
    genAbort?.abort();
  } else {
    engine?.interruptGenerate?.().catch(() => {});
  }
}

// Human-readable megabytes for the download counter.
function fmtMB(bytes) {
  return `${Math.floor((bytes || 0) / 1048576)} MB`;
}

// Human-readable gigabytes for device memory caps.
function fmtGB(bytes) {
  return `${(Math.round((bytes || 0) / 1048576) / 1024).toFixed(1)} GB`;
}

// Preflight for heavyweight models that stream into memory with no persistent
// cache: ask for persistent storage, warn if the device looks tight, never block.
async function storagePreflight(m) {
  if (!m.approxBytes) return;
  progressText.textContent = `${m.name} downloads about ${fmtMB(m.approxBytes)}. Its memory use is higher than the file size. 27B is a desktop-class experiment; try 1.7B first on iPhone.`;
  await new Promise((resolve) => setTimeout(resolve, 1800));
}
// Technical wall → one sentence a human can act on.
function friendlyGenerationError(e) {
  const s = String(e?.message || e || "");
  if (/context|window|exceed|too[ -]?long|max.*tokens|numPromptTokens/i.test(s)) {
    return "This chat grew too long for the model's memory. Start a new chat to keep going — the detail panel below has the technical reason.";
  }
  return null;
}

/*
 * Robust WebGPU inspection.
 *
 * We intentionally do NOT force:
 *
 *   powerPreference: "high-performance"
 *
 * Safari/WebKit on iOS can behave differently when an
 * adapter preference is explicitly requested.
 *
 * Instead, we allow the browser to select the appropriate
 * adapter and verify the complete chain:
 *
 * navigator.gpu
 *      ↓
 * requestAdapter()
 *      ↓
 * GPUAdapter
 *      ↓
 * requestDevice()
 *      ↓
 * GPUDevice
 */

async function inspect() {
  const r = {
    secureContext: isSecureContext,
    webgpu: !!navigator.gpu,
    adapter: false,
    device: false,
    label: "WebGPU",
    maxBuffer: 0,
    error: "",
  };

  if (!r.webgpu) {
    r.error =
      "navigator.gpu is not available in this browser context.";

    return r;
  }

  try {
    /*
     * Let Safari/WebKit choose the appropriate GPU.
     */
    const a = await navigator.gpu.requestAdapter();

    if (!a) {
      r.error =
        "navigator.gpu exists, but requestAdapter() returned null.";

      return r;
    }

    r.adapter = true;

    /*
     * Identify the actual GPU when adapter.info is available.
     */
    const i = a.info;
    r.features = [...a.features].sort();
    r.limits = { maxStorageBufferBindingSize: a.limits.maxStorageBufferBindingSize, maxBufferSize: a.limits.maxBufferSize, maxComputeWorkgroupStorageSize: a.limits.maxComputeWorkgroupStorageSize };

    r.label =
      [
        i?.vendor,
        i?.architecture,
        i?.description,
      ]
        .filter(Boolean)
        .join(" · ") || "WebGPU";

    /*
     * Read the storage-buffer limit.
     */
    r.maxBuffer =
      a.limits?.maxStorageBufferBindingSize || 0;

    /*
     * Actually verify that this adapter can create
     * a usable GPUDevice.
     */
    try {
      const device = await a.requestDevice();

      r.device = !!device;

      /*
       * This device is only for diagnostics.
       * WebLLM / BitGPU will create its own device later.
       */
      device?.destroy?.();
    } catch (e) {
      r.error =
        "Adapter found, but requestDevice() failed:\n" +
        formatError(e);
    }
  } catch (e) {
    r.error = formatError(e);

    console.warn(
      "WebGPU inspection failed",
      e
    );
  }

  return r;
}

function showHW(h) {
  hardwareBox.textContent =
    `Connection: ${
      h.secureContext
        ? "HTTPS / secure"
        : "HTTP / not secure"
    }\n` +
    `WebGPU API: ${
      h.webgpu ? "yes" : "no"
    }\n` +
    `GPU adapter: ${
      h.adapter ? "yes" : "no"
    }\n` +
    `GPU device: ${
      h.device ? "yes" : "no"
    }\n` +
    `GPU: ${h.label}\n` +
    `Max storage buffer: ${
      Math.round(
        (h.maxBuffer || 0) / 1048576
      )
    } MB` +
    (
      h.error
        ? `\n\nWebGPU diagnostic:\n${h.error}`
        : ""
    );
}

function makeWebLLMConfig(m, prebuiltAppConfig) {
  const appConfig = {
    ...prebuiltAppConfig,
    cacheBackend: "indexeddb",
  };

  if (m.model && m.model_lib) {
    appConfig.model_list = [
      ...prebuiltAppConfig.model_list,
      {
        model: m.model,
        model_id: m.id,
        model_lib: m.model_lib,
        overrides: m.overrides,
      },
    ];
  }

  return appConfig;
}

async function loadModel() {
  if (busy || load.disabled) return;
  if (engine) return notifyUser("This model is already loaded. Choose a different model from the model menu or load a GGUF file.");
  const startedAt = performance.now();
  activeLoadAbort?.abort();
  activeLoadAbort = new AbortController();
  const myToken = ++loadToken;
  const alive = () => myToken === loadToken;
  loadProgressAt = Date.now();

  load.disabled = true;
  errorBox.hidden = true;
  $("#loadErrorDetails").hidden = true;

  progressWrap.hidden = false;
  cancelLoadButton.hidden = false;
  progress.style.width = "0%";

  // Watchdog: a stuck load (a stalled stream, a wedged runtime) must not look
  // like progress. Nudge the user toward Cancel instead of freezing silently.
  const stallWatch = setInterval(() => {
    if (!alive() || busy) return;
    if (Date.now() - loadProgressAt > 45000) {
      progressText.textContent =
        `No progress for 45s — this load looks stuck. Tap Cancel and pick another model.`;
    }
  }, 5000);

  const m = model();
  // Captured before the file handle is consumed by the load, so a file load is
  // never mistaken for a cached/live one.
  const journalId = `${Date.now()}-${myToken}`;
  if (!isOnlineModel(m)) startJournal(journalId, m);
  const wasFile = !!pickedFile;
  loadSource = wasFile ? "GGUF file" : "network/cache";
  localStorage.setItem("pocket-ai-last-source", wasFile ? "file" : "live");
  let h = null;

  try {
    if (isOnlineModel(m) && !navigator.onLine) throw new Error("Online Assist needs internet. Choose a local model or load a saved GGUF.");
    if (wasFile) {
      // Check tokenizer and runtime availability before allocating GPU weights.
      progressText.textContent = "Checking local model support files…";
      try {
        await Promise.all([cacheFirstJson(m.tokenizerJsonUrl), cacheFirstJson(m.tokenizerConfigUrl), import("bitgpu"), import("bitgpu/chat"), import("bitgpu/gguf")]);
      } catch {
        throw new Error("Required model support files are missing. Reconnect, update the app, and wait for App ready for offline GGUF before trying again. Your GGUF is kept in Files.");
      }
    }
    if (!isOnlineModel(m)) {
      /*
       * Run the complete hardware inspection before
       * attempting to initialize a local model.
       */
      h = await inspect();
      if (!alive()) throw ABORTED;
      lastHW = h;
      updateJournal(journalId, "GPU checked", measurementBase(m));
      renderRecommendation();
      hardwareBox.hidden = false;
      showHW(h);
} else {
      hardwareBox.hidden = true;
    }

    if (h && !h.secureContext) {
      throw Error(
        "WebGPU requires HTTPS."
      );
    }

    if (h && !h.webgpu) {
      throw Error(
        h.error ||
          "WebGPU is not available."
      );
    }

    if (h && !h.adapter) {
      throw Error(
        h.error ||
          "WebGPU adapter unavailable. " +
          "The browser exposed WebGPU but did not provide an adapter."
      );
    }

    if (h && !h.device) {
      throw Error(
        h.error ||
          "WebGPU adapter was found, but the GPU device could not be created."
      );
    }

    progressText.textContent =
      isOnlineModel(m)
        ? "Connecting to your secure Online Assist proxy..."
        : `GPU available · loading ${m.name}...`;

    if (m.runtime === "bitgpu") {
      if (pickedFile) {
        if (m.approxBytes) {
          const cap = h?.maxBuffer ? fmtGB(h.maxBuffer) : null;
          progressText.textContent =
            `Heads-up: ${m.name} has ~${fmtGB(m.approxBytes)} of weights, plus runtime memory` +
            (cap ? ` (device storage-buffer cap ≈ ${cap})` : "") +
            `. This experiment may exceed your device memory. Try 1.7B first on iPhone.`;
          await new Promise((r) => setTimeout(r, 1800));
        } else {
          progressText.textContent =
            `Loading weights from a local file (no download) · ${m.name}...`;
        }
      } else {
        await storagePreflight(m);
      }
    }

if (!alive()) throw ABORTED;

    if (m.runtime === "online") {
      await loadOnlineAssist(m, alive);
    } else if (m.runtime === "bitgpu") {
      await loadBonsaiBitGPU(m, alive, journalId);
    } else {
      await loadWebLLM(m, alive, journalId);
    }

    if (!alive()) throw ABORTED;

    clearInterval(stallWatch);
    lastLoadMs = performance.now() - startedAt;
    if (!isOnlineModel(m)) {
      finishJournal(journalId);
      recordMeasurement({ ...measurementBase(m), kind: "load", loadMs: lastLoadMs, source: loadSource });
      renderRecommendation();
    }
    refreshConnection();
    cancelLoadButton.hidden = true;
    load.disabled = false;

    status.textContent = isOnlineModel(m)
      ? `${model().name} · ready`
      : `Local AI · ${m.name} · WebGPU`;

    const hint = $("#reloadHint");
    if (hint) hint.hidden = true;

    progress.style.width = "100%";

    progressText.textContent = isOnlineModel(m)
      ? "Ready · messages will use your configured online service."
      : "Ready · model is running on this device.";

    setTimeout(() => {
      progressWrap.hidden = true;
    }, 500);

    welcome.hidden = true;

    input.disabled = false;
    send.disabled = false;

render();
welcome.hidden = true;
input.focus();
  } catch (e) {
    clearInterval(stallWatch);

    // A superseded load (Cancelled, model switched, or a newer load started)
// unwinds quietly. Whoever superseded it already reset the UI, and any engine
// this attempt built is disposed at its own assignment point (see
// loadBonsaiBitGPU) — never here, because `engine` may already belong to the
// newer attempt.
if (e === ABORTED || !alive()) return;
    if (!isOnlineModel(m)) {
      finishJournal(journalId);
      recordMeasurement({ ...measurementBase(m), kind: "failure", phase: "load" });
      renderRecommendation();
      if (m.id === "Bonsai-27B-bitgpu") offer27B(e.message || "The local load did not finish.");
    }
    try { chatEngine?.dispose?.(); } catch {}
    try { engine?.dispose?.(); } catch {}

    engine = null;
    chatEngine = null;
    engineRuntime = null;
    kvReady = null;
    const reason = String(e?.message || "");
    notifyUser(isOnlineModel(m)
      ? "The online model could not connect. Check your internet connection and service configuration, then retry. Technical details are below."
      : /memory|buffer|allocation/i.test(reason)
      ? "This model needs more memory than the browser could provide. Choose a smaller model from the model menu. Technical details are below."
      : "The model could not load. Check Offline setup or reselect its saved file, then retry. Technical details are below.");
    cancelLoadButton.hidden = true;



    errorBox.textContent =
      `${
        m.runtime === "online"
          ? "ONLINE ASSIST"
          : m.runtime === "bitgpu"
          ? "BITGPU"
          : "WEBLLM / MLC"
      } INITIALIZATION ERROR\n\n` +
      `${formatError(e)}\n\n` +
      `Model: ${m.name}\n` +
      `Model ID: ${m.id}\n` +
      `Runtime: ${m.runtime}\n` +
      `Browser: ${navigator.userAgent}`;

    errorBox.hidden = false;
    $("#loadErrorDetails").hidden = false;

    console.error(
      "Pocket AI initialization error",
      e
    );

    load.disabled = false;
  }
}

async function loadWebLLM(m, alive = () => true, journalId) {
  const { CreateMLCEngine, prebuiltAppConfig } = await import("@mlc-ai/web-llm");
  if (!alive()) throw ABORTED;
  engineRuntime = "webllm";

  const created = await CreateMLCEngine(
    m.id,
    {
      appConfig: makeWebLLMConfig(m, prebuiltAppConfig),

      initProgressCallback: (i) => {
        if (!alive()) return;
        loadProgressAt = Date.now();
        updateJournal(journalId, "WebLLM loading");
        if (i?.progress != null) {
          progress.style.width =
            `${Math.min(
              100,
              Math.max(
                0,
                i.progress * 100
              )
            )}%`;
        }

        progressText.textContent =
          i?.text ||
"Preparing local GPU runtime...";
      },
    },
    m.overrides
  );

  if (!alive()) {
    try { created.unload?.(); } catch {}
    throw ABORTED;
  }
  engine = created;
}

async function loadOnlineAssist(m, alive) {
  if (m.profile === "bonsai-27b") await check27BRoute(activeLoadAbort.signal);
  if (!alive()) throw ABORTED;
  engineRuntime = "online";
  engine = { remote: true };
  progress.style.width = "100%";
}

// Weights are NEVER cached by the app. iOS Safari materializes a cache.put()
// body inside the tab's page process, so storing a multi-hundred-MB GGUF there
// is exactly what crashes (4B, 546 MiB) or wedges (1.7B, 237 MiB) the tab — while
// 8B, which was never small enough to cache, loaded fine every time. The body
// streams straight to the GPU instead. Offline, load from a saved GGUF file:
// the "Save to Files" chips in the model sheet put the file on the device, and
// that path never touches the Cache API.
const OFFLINE_WEIGHTS_MSG =
  `You're offline, so the model weights can't be downloaded. ` +
  `Save the model to Files once (model sheet → "Save to Files"), then load it ` +
  `with "Load from a file…" — that works with no connection at all.`;

async function cachedModelStream(url, signal) {
  let response;
  try {
    response = await fetch(url, { signal });
  } catch (e) {
    if (!navigator.onLine) throw new Error(OFFLINE_WEIGHTS_MSG);
    throw e;
  }
  if (!response.ok || !response.body) {
    if (!navigator.onLine) throw new Error(OFFLINE_WEIGHTS_MSG);
    throw new Error(`Could not fetch model data: HTTP ${response.status}`);
  }
  return response.body;
}

// Small metadata (manifest.json, *.aux.bin, tokenizer.json/config): a few KB to
// a couple of MB at most, so these ARE cached — they're what makes an offline
// file-load work (the file supplies the weights, the cache supplies everything
// else). Network-first so updates flow through; the cache fallback covers
// airplane mode.
const META_CACHE = "pocket-ai-meta-v1";
const META_CACHE_MAX_BYTES = 16 * 1024 * 1024;

// Cache-first fetch with a network fallback, shared by manifest/aux/tokenizer.
// Cache-first is deliberate: once stored, these reads skip the network entirely.
// The bundled tokenizer is same-origin and precached by the service worker, so it
// normally never reaches this function; manifest/aux are small and only needed on
// the network download path. Never stores anything big.
async function metaFetch(url) {
  // Same-origin tokenizers belong to the shell cache. Do not duplicate them in metadata storage.
  if (url.startsWith("/tokenizer")) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Model tokenizer is unavailable. Reconnect and update the app.");
    return response;
  }
  let cache = null;
  try {
    cache = await caches.open(META_CACHE);
    if (cache) {
      const hit = await cache.match(url);
      if (hit && hit.ok) return hit;
    }
  } catch {
    cache = null;
  }
  const res = await fetch(url).catch((e) => {
    if (!navigator.onLine) {
      throw new Error(
        `You're offline and this model's support files (manifest/tokenizer) aren't ` +
          `saved on this device yet. Connect once so they cache, then airplane mode works.`
      );
    }
    throw e;
  });
  if (!res.ok) throw new Error(`Could not fetch ${url}: HTTP ${res.status}`);
  if (cache) {
    const len = Number(res.headers.get("content-length") || 0);
    if (len > 0 && len <= META_CACHE_MAX_BYTES) {
      // Logged rather than swallowed: a silently dropped write used to leave an
      // empty cache with no way to tell offline loads had quietly stopped working.
      await cache.put(url, res.clone()).catch((e) => {
        console.warn(`[meta] failed to cache ${url}`, e);
      });
    }
  }
  return res;
}

// bitgpu engine/chat hooks: createEngine.fetchJson (manifest),
// createEngine.fetchArrayBuffer (aux.bin), createChat.fetchJson (tokenizer).
async function cacheFirstJson(url) {
  const res = await metaFetch(url);
  return res.json();
}

async function cacheFirstBytes(url) {
  const res = await metaFetch(url);
  return res.arrayBuffer();
}

// Pending background prewarm/KV-restore for the loaded engine. The first local
// send awaits it so a restored context is never raced by a fresh prefill.
let kvReady = null;

// --- KV-context persistence (durable, instant-resume chats) ---

const KV_MAX_BYTES = 64 * 1024 * 1024;
const KV_MIN_INTERVAL = 5000;
let lastKvAt = 0;

function kvKey(modelId, chatId) {
  return `${modelId}::${chatId}`;
}

// Prewarm the pinned system prompt so the first real turn is a cheap cache
// append and delta snapshots have a stable prefix to ride on.
async function prewarmChat() {
  if (engineRuntime !== "bitgpu" || !chatEngine) return;
  try {
    await chatEngine.prewarm([
      { role: "system", content: SYSTEM_PROMPT },
    ]);
  } catch {}
}

// Make sure a switched/discarded conversation can never serve the wrong KV.
function resetChatKv() {
  if (kvReady) {
    const ownChat = chatEngine;
    kvReady = kvReady.catch(() => {}).then(() => { if (ownChat === chatEngine) ownChat?.reset?.(); });
    return;
  }
  try {
    chatEngine?.reset?.();
  } catch {}
}

// Persist the active chat's context window so a later launch re-opens it with
// its KV cache intact (instant resume, no re-prefill). Skipped for models
// without kvBytesPerToken (27B), when the context is too large to store
// comfortably, or while the engine is mid-generation. `force` bypasses the
// rate limit (used on tab close / model switch).
async function saveKvSnapshot(force = false) {
  if (engineRuntime !== "bitgpu" || !chatEngine || busy) return;
  const m = model(), c = chats.find((x) => x.id === active), ownChat = chatEngine;
  if (!m.kvBytesPerToken || !c?.messages.length || c.source) return;
  const signature = JSON.stringify(c.messages);
  const now = Date.now();
  if (!force && now - lastKvAt < KV_MIN_INTERVAL) return;
  try {
    const tokens = ownChat.countTokens([{ role: "system", content: SYSTEM_PROMPT }, ...c.messages]);
    if (tokens * m.kvBytesPerToken > KV_MAX_BYTES) return;
    const snap = await ownChat.save();
    if (!snap || busy || ownChat !== chatEngine || signature !== JSON.stringify(c.messages) || !chats.includes(c)) return;
    lastKvAt = now;
    idbPut(IDB_KV, { key: kvKey(m.id, c.id), chatId: c.id, modelId: m.id, savedAt: now, signature, snap });
  } catch (e) { console.warn("Snapshot not saved", e); }
}

async function tryRestoreKv(chatId) {
  if (engineRuntime !== "bitgpu" || !chatEngine) return false;
  const m = model(), ownChat = chatEngine;
  try {
    const rec = await idbGet(IDB_KV, kvKey(m.id, chatId));
    const c = chats.find((x) => x.id === chatId);
    if (!rec?.snap || !c || c.source || busy || active !== chatId || ownChat !== chatEngine || rec.signature !== JSON.stringify(c.messages)) return false;
    await ownChat.restore(rec.snap);
    return true;
  } catch { return false; }
}

async function loadBonsaiBitGPU(m, alive = () => true, journalId) {
  const signal = activeLoadAbort?.signal;
  engineRuntime = "bitgpu";

  progressText.textContent =
    `Starting browser-native 1-bit runtime · ${m.name}...`;

  // Tokenizers ship with the app; file loading has no remote dependencies.

  const ggufFile = pickedFile;
  pickedFile = null;

  let gguf = null;

  if (ggufFile) {
    progressText.textContent = `Reading ${ggufFile.name} header...`;
    gguf = await readGgufFromFile(ggufFile);
    if (!alive()) throw ABORTED;
    const hybrid = gguf.manifest.arch.model_type === "qwen3_5";
    if (hybrid !== m.id.includes("27B")) throw new Error("The file architecture does not match its model name. Choose a listed Bonsai Q1_0 GGUF.");
    progressText.textContent =
      `Loading weights from local file · ${ggufFile.name}...`;
  }

  const {
    createEngine: createBitGPUEngine,
    GpuOutOfMemoryError,
    WebGPUUnavailableError,
  } = await import("bitgpu");

  const {
    createChat: createBitGPUChat,
  } = await import("bitgpu/chat");

  if (!alive()) throw ABORTED;
  try {
    const created = await createBitGPUEngine({
      ...(gguf
        ? {
            manifest: gguf.manifest,
            aux: gguf.aux,
            dataUrl: "file://" + ggufFile.name,
            fetchStream: () => ggufFile.stream().pipeThrough(new TransformStream({ transform(chunk, controller) {
              if (!alive()) throw new Error("Model load cancelled");
              controller.enqueue(chunk);
            } })),
          }
        : {
            manifestUrl: m.manifestUrl,
            auxUrl: m.auxUrl,
            dataUrl: m.dataUrl,
            fetchJson: cacheFirstJson,
            fetchArrayBuffer: cacheFirstBytes,
            fetchStream: (url) => cachedModelStream(url, signal),
          }),
      kvCache: m.kvCache,
      maxSeqLen: m.maxSeqLen,

      // bitgpu reports { phase, loaded, total } — translate into an honest bar.
      // (Previously this read a nonexistent p.fraction, so the bar sat at 0%
      // through every Bonsai download.)
      onProgress: (p) => {
        if (!p) return;
        if (!alive()) return;
        loadProgressAt = Date.now();
        updateJournal(journalId, p.phase || "loading");

        let f = null;
        let text = null;

        if (p.phase === "manifest") {
          f = 0.02;
          text = gguf
            ? `Model header parsed · ${m.name}...`
            : `Reading model manifest · ${m.name}...`;
        } else if (p.phase === "weights") {
          if (gguf) {
            f = 0.02 + 0.96 * Math.min(1, (p.loaded || 0) / ggufFile.size);
            text = `Loading weights from file · ${ggufFile.name}`;
          } else if (p.total > 0 && p.loaded != null) {
            const pct = Math.min(100, Math.floor((100 * p.loaded) / p.total));
            f = 0.02 + 0.96 * (p.loaded / p.total);
            text = `Downloading & processing weights · ${fmtMB(p.loaded)} / ${fmtMB(p.total)} (${pct}%)`;
          } else {
            text = `Loading ${m.name} weights...`;
          }
        } else if (p.phase === "pipelines") {
          f = 0.98;
          text = "Compiling GPU pipelines...";
        }

        if (f != null) {
          progress.style.width = `${Math.min(100, Math.max(0, f * 100))}%`;
        }

        if (text) {
          progressText.textContent = text;
        }
      },
    });

    // Cancelled (or superseded) while the weights were streaming: release the
    // GPU memory this attempt grabbed instead of parking it in the module.
    if (!alive()) {
      try { created.dispose?.(); } catch {}
      throw ABORTED;
    }
    engine = created;
    created.lost?.then((info) => {
      if (engine !== created || info.reason === "destroyed") return;
      genAbort?.abort();
      stopRequested = true;
      engine = null; chatEngine = null; kvReady = null;
      input.disabled = true; send.disabled = true; load.disabled = false;
      welcome.hidden = false;
      recordMeasurement({ ...measurementBase(m), kind: "failure", phase: "GPU lost" });
      renderRecommendation();
      if (m.id === "Bonsai-27B-bitgpu") offer27B("The GPU released the local 27B model.");
      status.textContent = "GPU interrupted · reload your model";
      notifyUser("The device released the model's GPU memory. Your saved chat is kept. Load the model again, or reselect its GGUF file.");
    });
  } catch (e) {
    if (e === ABORTED) throw e;
    if (e instanceof GpuOutOfMemoryError) {
      const cap = lastHW?.maxBuffer ? ` (this device's storage-buffer cap ≈ ${fmtGB(lastHW.maxBuffer)})` : "";
      throw new Error(
        `This device ran out of GPU memory while loading ${m.name}${cap}. Runtime detail: ${e.message}. ` +
          `Close other tabs and apps and try again — on a tight iPhone this is often the limit, and Safari may kill the tab first.`
      );
    }
    if (e instanceof WebGPUUnavailableError) {
      throw new Error(`WebGPU is not available on this device. ${e.message}`);
    }
    throw e;
  }

  updateJournal(journalId, "creating chat");
  const ownEngine = engine;
  const createdChat = await createBitGPUChat(
    ownEngine,
    {
      fetchJson: cacheFirstJson,

      tokenizerJsonUrl:
        m.tokenizerJsonUrl,

      tokenizerConfigUrl:
        m.tokenizerConfigUrl,
    }
  );

  if (!alive()) {
    try { createdChat.dispose?.(); } catch {}
    try { ownEngine?.dispose?.(); } catch {}
    throw ABORTED;
  }
  chatEngine = createdChat;

  // Prewarm/restore run in the background after the load reports "ready" — they
  // only prime the KV cache, so a slow (or hanging) prewarm must never stall the
  // load itself. The first send awaits `kvReady` (see generateSegment).
  kvReady = (async () => {
    await prewarmChat();
    await tryRestoreKv(active);
  })();
  kvReady.catch((e) => console.warn("Pocket AI: prewarm/restore skipped:", e));
}

async function sendMessage(e) {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !engine || busy || hydrating) return;
  const c = chats.find((x) => x.id === active);
  if (engineRuntime === "online" && !navigator.onLine) return notifyUser("Online Assist needs internet. Your message is still in the composer.");
  if (editingIndex !== null) {
    c.messages = c.messages.slice(0, editingIndex);
    editingIndex = null;
    resetChatKv();
  }
  c.messages.push({ role: "user", content: text });
  if (c.title === "New Chat") c.title = text.slice(0, 42);
  input.value = "";
  busy = true;
  stopRequested = false;
  input.disabled = true;
  setGenerating(true);
  notifyUser("");
  save();
  render();
  const bubble = addBubble("assistant", "");
  let streamed = "";
  try {
    const result = engineRuntime === "online"
      ? await sendOnlineAssistMessage(c, bubble)
      : await generateSegment(c, { onText: (text) => {
          streamed = text;
          bubble.textContent = text;
          chat.scrollTop = chat.scrollHeight;
        } });
    if (engineRuntime !== "online" && engine && !stopRequested && result.finishReason !== "abort" && result.text.trim()) {
      recordMeasurement({ ...measurementBase(), kind: "generation" });
      renderRecommendation();
    }
    c.messages.push({ role: "assistant", content: result.text.trim() || (result.finishReason === "abort" ? "(stopped)" : "(No text returned — retry this answer.)"), finishReason: result.finishReason, model: model().name, runtime: engineRuntime, sourceTitle: c.source?.title });
    save();
  } catch (error) {
    const stopped = stopRequested || error.name === "AbortError";
    if (!stopped && engineRuntime !== "online" && /memory|allocation|buffer|gpu/i.test(error.message || "")) {
      recordMeasurement({ ...measurementBase(), kind: "failure", phase: "generation" });
      renderRecommendation();
      if (model().id === "Bonsai-27B-bitgpu") offer27B(error.message);
    }
    c.messages.push({ role: "assistant", content: streamed || (stopped ? "(stopped)" : "Could not finish this answer. Retry it when ready."), finishReason: stopped ? "abort" : "error", model: model().name, runtime: engineRuntime });
    if (!stopped) notifyUser(error.message || "Generation failed. Try a smaller model or a shorter question.");
    save();
  } finally {
    genAbort = null;
    busy = false;
    setGenerating(false);
    input.disabled = !engine;
    render();
    saveKvSnapshot(false);
    input.focus();
  }
}

async function promptForChat(c, extra = [], maxTokens = LOCAL_MAX_TOKENS) {
  const result = await preparePrompt(c, {
    context: model().maxSeqLen || model().overrides?.context_window_size || CONTEXT_TOKENS,
    reserve: maxTokens,
    count: engineRuntime === "bitgpu" ? (messages) => chatEngine.countTokens(messages) : undefined,
    extra,
  });
  const warnings = [];
  if (result.sourceTruncated) warnings.push("Only the beginning of the attached page fits this model. Paste a shorter excerpt to discuss later sections.");
  if (result.droppedMessages) warnings.push("Older messages are saved in history but omitted from this answer's context.");
  if (warnings.length) notifyUser(warnings.join(" "));
  return result.messages;
}

async function generateSegment(c, { extra = [], onText = () => {}, maxTokens = LOCAL_MAX_TOKENS, benchmark = false } = {}) {
  if (kvReady) {
    const pending = kvReady;
    kvReady = null;
    await pending.catch(() => {});
  }
  const messages = await promptForChat(c, extra, maxTokens);
  if (stopRequested) return { text: "", finishReason: "abort" };
  if (engineRuntime === "bitgpu") {
    const ctl = new AbortController();
    genAbort = ctl;
    let out = "";
    const res = await chatEngine.send(messages, {
      maxTokens,
      ...(benchmark ? { temperature: 0, topK: 1, think: false } : model().generation),
      signal: ctl.signal,
      onText: (chunk) => { out += chunk; onText(out); },
    });
    genAbort = null;
    return { text: res?.text || out, finishReason: stopRequested || ctl.signal.aborted ? "abort" : res?.finishReason || "stop", tokens: res.tokens.length, tokensPerSecond: res.tokensPerSecond };
  }
  const request = { messages, temperature: benchmark ? 0 : 0.7, top_p: 0.9, max_tokens: maxTokens, stream: true, stream_options: { include_usage: true } };
  if (benchmark || model().thinking === false) request.extra_body = { enable_thinking: false };
  const stream = await engine.chat.completions.create(request);
  let out = "", finishReason = "stop", tokens = null;
  for await (const chunk of stream) {
    out += chunk.choices?.[0]?.delta?.content || "";
    onText(out);
    if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
    if (chunk.usage?.completion_tokens != null) tokens = chunk.usage.completion_tokens;
  }
  return { text: out, finishReason: stopRequested ? "abort" : finishReason, tokens };
}

// Offer a "Continue" chip under a length-capped bubble. Each tap resumes the
// answer in the same bubble; the stored message always ends up complete.
function offerContinue(c, bubble, partial, count) {
  if (count > MAX_CONTINUATIONS) return;
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "continue-chip";
  chip.textContent = "Continue";
  chip.title = "The answer hit the length limit — keep it going.";
  chip.onclick = async () => {
    if (busy || !engine || c.id !== active || c.messages.at(-1)?.content !== partial.trim()) return;
    busy = true;
    stopRequested = false;
    chip.disabled = true;
    input.disabled = true;
    setGenerating(true);
    let full = partial;
    try {
      const r = await generateSegment(c, {
        extra: [
          {
            role: "user",
            content:
              "Continue your previous answer exactly where it stopped. Do not restart or repeat it.",
          },
        ],
        onText: (t) => {
          bubble.textContent = full + t;
          chat.scrollTop = chat.scrollHeight;
        },
      });
      full = partial + r.text;
      bubble.textContent = full;
      chip.remove();
      const last = c.messages[c.messages.length - 1];
      if (last?.role === "assistant") { last.content = full.trim(); last.finishReason = r.finishReason; last.continuations = count; }
      save();
      if (r.finishReason === "length") offerContinue(c, bubble, full, count + 1);
    } catch (e) {
      bubble.textContent = full;
      chip.disabled = false;
      errorBox.textContent = "Continuation failed.\n\n" + formatError(e);
      errorBox.hidden = false;
    $("#loadErrorDetails").hidden = false;
      notifyUser("Continuation failed. " + e.message);
    } finally {
      setGenerating(false);
      busy = false;
      input.disabled = !engine;
      send.disabled = !engine;
      render();
      saveKvSnapshot(false);
      input.focus();
    }
  };
  bubble.append(chip);
}

async function sendOnlineAssistMessage(c, bubble) {
  bubble.textContent = "Thinking online…";
  const ctl = new AbortController();
  genAbort = ctl;
  const timer = setTimeout(() => ctl.abort(new Error("Online Assist timed out. Retry when your service is available.")), 60000);
  try {
    const messages = await promptForChat(c);
    const response = await fetch("/api/online-assist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, ...(model().profile ? { profile: model().profile } : {}) }), signal: ctl.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || `Online Assist returned ${response.status}.`);
    if (model().profile === "bonsai-27b" && (payload?.profile !== "bonsai-27b" || payload?.protocol !== "pocket-assist-v2")) throw new Error("The service did not confirm the Bonsai 27B route. Update the backend configuration.");
    if (typeof payload?.content !== "string" || !payload.content.trim()) throw new Error("Online Assist returned an empty response.");
    return { text: payload.content, finishReason: "stop" };
  } finally { clearTimeout(timer); genAbort = null; }
}

function formatError(e) {
  if (!e) {
    return "Unknown error";
  }

  if (e.stack) {
    return e.stack;
  }

  if (e.message) {
    return e.message;
  }

  try {
    return JSON.stringify(
      e,
      Object.getOwnPropertyNames(e),
      2
    );
  } catch {
    return String(e);
  }
}

modelButton.onclick = () => {
  renderModels();
  sheet.classList.add("open");
  sheet.setAttribute("aria-hidden", "false");
};

$("#closeModelButton").onclick = () => {
  sheet.classList.remove("open");
  sheet.setAttribute("aria-hidden", "true");
};

$("#menuButton").onclick = () => {
  drawer.classList.add("open");
  backdrop.hidden = false;

  drawer.setAttribute(
    "aria-hidden",
    "false"
  );
};

$("#closeDrawerButton").onclick = () => {
  drawer.classList.remove("open");
  backdrop.hidden = true;

  drawer.setAttribute(
    "aria-hidden",
    "true"
  );
};

backdrop.onclick = () => {
  drawer.classList.remove("open");
  backdrop.hidden = true;
};

$("#newChatButton").onclick = () => {
  if (busy || hydrating) return notifyUser("Wait for the current operation before starting a chat.");
  editingIndex = null;
  input.value = "";
  saveKvSnapshot(true);
  resetChatKv();
  const c = freshChat();

  chats.unshift(c);

  active = c.id;

  save();
  render();

  drawer.classList.remove("open");
  backdrop.hidden = true;
};

async function onFilePicked(file) {
  if (busy) return notifyUser("Stop the current response before loading a different file.");
  if (load.disabled) cancelLoadButton.click();
  const m = matchModelByFile(file.name);
  if (!m) {
    errorBox.textContent =
      "That file doesn't look like a Bonsai GGUF. Pick a Bonsai-*.gguf.";
    errorBox.hidden = false;
    $("#loadErrorDetails").hidden = false;
    notifyUser(errorBox.textContent);
    return;
  }

  // Persist the current engine's context for whatever model is active BEFORE
  // switching selected (snapshots are keyed per model).
  if (engine) {
    saveKvSnapshot(true);
  }

  pickedFile = file;
  selected = m.id;
  localStorage.setItem(KEY, selected);
  modelButton.textContent = m.name;
  sheet.classList.remove("open");
  updateWelcome();

  // In-session switch: dispose the previous engine instead of the usual
  // location.reload(), because reload would drop the File handle.
  if (engine) {
    busy = true;
    input.disabled = true;
    send.disabled = true;
    // Dispose also interrupts prewarming. Waiting for a stalled prewarm here
    // would prevent the user from escaping to a different model.
    kvReady = null;
    try { chatEngine?.dispose?.(); } catch {}
    try { if (engineRuntime === "webllm") await engine.unload(); else engine.dispose?.(); } catch {}
    engine = null;
    chatEngine = null;
    engineRuntime = null;
    busy = false;
  }

  localStorage.setItem("pocket-ai-last-source", "file");
  load.disabled = false;
  loadModel();
}

// Activate only a completely installed replacement; retain the working offline copy on failure.
async function updateSite() {
  if (busy || load.disabled) return notifyUser("Wait for the current operation before updating.");
  const button = $("#updateButton");
  button.disabled = true;
  button.textContent = "Checking update…";
  try {
    save();
    await saveKvSnapshot(true);
    const updating = await updateOfflineApp();
    if (!updating) { notifyUser("This app is up to date and its offline files are saved."); refreshConnection(); }
  } catch (e) { notifyUser(e.message); }
  finally { button.disabled = false; button.textContent = "Update site"; }
}

const updateButton = $("#updateButton");
if (updateButton) {
  updateButton.onclick = updateSite;
}

const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = ".gguf";
fileInput.style.display = "none";
fileInput.addEventListener("change", () => {
  if (fileInput.files && fileInput.files[0]) onFilePicked(fileInput.files[0]);
});
document.body.append(fileInput);

load.onclick = loadModel;

// Abort whatever load is in flight and hand the UI back. Bumping loadToken makes
// the abandoned attempt unwind (and dispose its engine) instead of leaving the
// Load button disabled forever.
cancelLoadButton.onclick = () => {
  if (busy) return;   // a load can't be cancelled while an answer is generating
  finishJournal();
  loadToken++;
  pickedFile = null;
  activeLoadAbort?.abort();
  try { engine?.dispose?.(); } catch {}
  try { chatEngine?.dispose?.(); } catch {}
  engine = null;
  chatEngine = null;
  engineRuntime = null;
  kvReady = null;
  load.disabled = false;
  cancelLoadButton.hidden = true;
  progressWrap.hidden = true;
  status.textContent = "Cancelled · pick a model or load again";
};

$("#composer").onsubmit = (e) => {
  if (generating) {
    e.preventDefault();
    stopGeneration();
    return;
  }
  sendMessage(e);
};

modelButton.textContent =
  model().name;

updateWelcome();
renderModels();
render();
renderHistory();

// Merge the durable (tab-close-proof) copy of the chats in the background.
hydrateChatsFromIDB().finally(() => { hydrating = false; render(); });

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.addEventListener("controllerchange", refreshConnection);
  navigator.serviceWorker.ready.then(refreshConnection);
  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((registration) => {
    registration.installing?.addEventListener("statechange", refreshConnection);
    registration.addEventListener("updatefound", () => {
      registration.installing?.addEventListener("statechange", refreshConnection);
    });
    refreshConnection();
  }).catch((e) => notifyUser("Offline installation could not finish: " + e.message));
}
window.addEventListener("offlineinstallationchange", refreshConnection);
window.addEventListener("online", refreshConnection);
window.addEventListener("offline", refreshConnection);

// Older versions cached model weights in the Cache API, which is what made 4B
// crash and 1.7B wedge — iOS materializes that body inside the tab's page
// process. Those copies are dead weight now, and they eat into the ~1GB Cache
// API quota, so drop them once. Chats, KV snapshots and the metadata cache are
// untouched.
if (localStorage.getItem("pocket-ai-models-purged") !== "1") {
  caches
    .keys()
    .then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("pocket-ai-models-"))
          .map((key) => caches.delete(key))
      )
    )
    .then(() => localStorage.setItem("pocket-ai-models-purged", "1"))
    .catch(() => {});
}

// Reduce the odds of the browser evicting the metadata cache under storage
// pressure. Best-effort; iOS grants this without a user prompt.
if (navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {});
}

// Save a final KV snapshot when the tab is going away (close, reload, model
// switch, backgrounding) so the next open can resume instantly.
const persistBeforeUnload = () => {
  saveKvSnapshot(true);
};
window.addEventListener("pagehide", persistBeforeUnload);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) persistBeforeUnload();
});

const reloadHint = $("#reloadHint");
if (reloadHint) {
  reloadHint.onclick = () => {
    reloadHint.hidden = true;
    window.pickModelFile();
  };
}

// No auto-load. Nothing starts loading on open, ever: the user picks a model
// (or reloads a saved file) and taps Load. The one exception is a hint — if the
// last session ran from a picked .gguf, that File handle can't outlive a reload,
// so offer a button to re-pick it.
if (
  model().runtime === "bitgpu" &&
  localStorage.getItem("pocket-ai-last-source") === "file" &&
  !engine &&
  reloadHint
) {
  reloadHint.hidden = false;
}

function notifyUser(message) {
  const notice = $("#notice");
  notice.textContent = message;
  notice.hidden = !message;
}

async function refreshConnection() {
  const request = ++connectionRequest;
  const local = !isOnlineModel();
  const label = $("#connectionLabel");
  label.textContent = local ? "On-device mode · checking offline setup…" : `${model().name} · messages and attached page leave this device`;
  const result = await offlineStatus();
  if (request !== connectionRequest) return;
  // Use the current selection after the async status request finishes.
  const mode = isOnlineModel() ? `${model().name} · chat and page sent to your service` : "On-device mode · chat stays here";
  label.textContent = mode + (navigator.onLine ? "" : " · no internet") + (result.ready ? " · App ready for offline GGUF" : result.pending ? " · Preparing offline setup…" : " · Offline setup incomplete");
  $("#offlineErrorDetails").hidden = result.ready || result.pending || !result.missing?.length;
  $("#offlineError").textContent = (result.missing || []).join(" · ");
  $("#offlineDetail").textContent = result.ready
    ? "App, runtime and tokenizers are saved. You still need a compatible GGUF downloaded onto this device in Files."
    : result.pending ? "Saving app support files… Keep this page open online." : "App support files need attention. Connect to the internet and tap Repair offline setup.";
}

function pageTextFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,noscript,nav,footer,header,iframe,svg,form").forEach((el) => el.remove());
  doc.querySelectorAll("p,div,section,article,li,h1,h2,h3,br").forEach((el) => el.append("\n"));
  return { title: doc.title.trim(), text: (doc.querySelector("article,main") || doc.body).textContent.replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim() };
}

$("#historySearch").oninput = renderHistory;
$("#loadTools").onclick = () => {
  if (busy) return notifyUser("Stop the reply before loading another model.");
  welcome.hidden = false;
  chat.prepend(welcome);
  welcome.scrollIntoView({ block: "start" });
};
$("#setupButton").onclick = () => { refreshConnection(); $("#setupDialog").showModal(); };
$("#refreshOffline").onclick = async () => {
  const button = $("#refreshOffline");
  button.disabled = true;
  $("#offlineDetail").textContent = "Saving offline files… Keep this page open online. This can take a few minutes.";
  try {
    const updating = await updateOfflineApp();
    if (!updating) await refreshConnection();
  } catch (error) {
    $("#offlineDetail").textContent = "Setup could not finish. Check your connection and try Repair again.";
    $("#offlineErrorDetails").hidden = false;
    $("#offlineError").textContent = error.message;
  }
  finally { button.disabled = false; }
};
$("#pageButton").onclick = () => {
  if (busy || hydrating) return notifyUser("Wait for the current operation before changing the page reference.");
  const source = chats.find((c) => c.id === active)?.source;
  $("#pageTitle").value = source?.title || "";
  $("#pageText").value = source?.text || "";
  $("#pageUrl").value = source?.url || "";
  $("#pageError").textContent = "";
  $("#pagePrivacy").textContent = isOnlineModel()
    ? `${model().name}: sending a question uploads relevant chat and attached text to your configured service.`
    : "Local mode: your question and attached text stay on this device. Saved text works offline after setup.";
  $("#pageDialog").showModal();
};
$("#pageFile").onchange = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (!/\.(txt|md|html?|htm)$/i.test(file.name)) throw new Error("Choose a text, Markdown or HTML file. Copy and paste text from PDFs or images instead.");
    if (file.size > 2 * 1024 * 1024) throw new Error("Choose a text or HTML file under 2 MB.");
    const body = await file.text();
    const page = /\.html?$/i.test(file.name) ? pageTextFromHtml(body) : { title: file.name, text: body };
    if (page.text.length > 100000) throw new Error("The page is too long. Paste an excerpt of up to 100,000 characters.");
    $("#pageTitle").value = page.title || file.name;
    $("#pageText").value = page.text;
    $("#pageUrl").value = "";
    $("#pageError").textContent = "";
  } catch (error) { $("#pageError").textContent = error.message; }
  event.target.value = "";
};
$("#fetchPage").onclick = async () => {
  const button = $("#fetchPage");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  button.disabled = true;
  $("#pageError").textContent = "Fetching page…";
  try {
    if (!navigator.onLine) throw new Error("Fetching a URL needs internet. Paste text or open a saved file offline.");
    const url = new URL($("#pageUrl").value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Enter a public HTTPS page URL without credentials.");
    const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", signal: ctl.signal });
    if (!response.ok || !response.body) throw new Error("The website could not be read. Paste its text instead.");
    const type = response.headers.get("content-type") || "";
    if (!/text\/(html|plain)/i.test(type)) throw new Error("Use an HTML or plain text page, or paste the text.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let body = "", bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw new Error("Page exceeds 2 MB. Paste a shorter excerpt."); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    const page = /html/i.test(type) ? pageTextFromHtml(body) : { title: url.hostname, text: body };
    if (page.text.length > 100000) throw new Error("Page exceeds 100,000 characters. Paste the section you want to discuss.");
    if (!page.text.trim()) throw new Error("This page has no readable text. Copy text from Safari instead.");
    $("#pageTitle").value = page.title || url.hostname;
    $("#pageText").value = page.text;
    $("#pageError").textContent = "Fetched. Review the text before starting a chat.";
  } catch (error) { $("#pageError").textContent = error.name === "TypeError" ? "This site blocks browser access or is unreachable. Copy its text from Safari and paste it here." : error.name === "AbortError" ? "The page took too long. Paste its text instead." : error.message; }
  finally { clearTimeout(timer); button.disabled = false; }
};
$("#attachPage").onclick = () => {
  const text = $("#pageText").value.trim();
  if (!text || text.length > 100000) { $("#pageError").textContent = "Add between 1 and 100,000 characters of page text."; return; }
  if (busy || hydrating) return;
  saveKvSnapshot(true);
  resetChatKv();
  const c = freshChat();
  c.source = { title: $("#pageTitle").value.trim() || "Pasted page", text, url: $("#pageUrl").value.trim() };
  c.title = c.source.title.slice(0, 42);
  chats.unshift(c);
  active = c.id;
  editingIndex = null;
  save(); render();
  $("#pageDialog").close();
  input.value = "Summarize the main points of this page.";
  notifyUser(engine ? "Text attached to a new chat. Choose a suggestion or write a question, then tap Send." : "Text attached. Load a model, then choose a suggestion or write a question and tap Send.");
  input.focus();
};

function measurementBase(m = model()) {
  return { model: m.id, name: m.name, config: configFor(m), profile: profileFor(lastHW, navigator.userAgent) };
}
function renderRecommendation() {
  const target = $("#modelRecommendation");
  if (target) target.textContent = lastHW ? recommendation(readMeasurements(), profileFor(lastHW, navigator.userAgent)) : "Model fit is based on successful loads and replies on this browser. Load a local model to check its GPU profile.";
}
function readJournal() {
  try { return JSON.parse(sessionStorage.getItem(JOURNAL_KEY)); } catch { return null; }
}
function startJournal(id, m) {
  try { sessionStorage.setItem(JOURNAL_KEY, JSON.stringify({ id, model: m.id, phase: "preparing", at: Date.now() })); } catch {}
}
function updateJournal(id, phase, extra = {}) {
  const row = readJournal();
  if (!row || row.id !== id || (row.phase === phase && !Object.keys(extra).length)) return;
  try { sessionStorage.setItem(JOURNAL_KEY, JSON.stringify({ ...row, ...extra, phase })); } catch {}
}
function finishJournal(id) {
  if (!id || readJournal()?.id === id) { try { sessionStorage.removeItem(JOURNAL_KEY); } catch {} }
}
function renderBenchmarks() {
  const list = $("#benchmarkResults");
  list.replaceChildren();
  const all = readMeasurements();
  const rows = all.filter(r => r.kind === "benchmark");
  if (!rows.length) list.textContent = "No three-run measurements yet. Load a local model first.";
  for (const row of rows) {
    const loads = all.filter(r => r.kind === "load" && r.profile === row.profile && r.config === row.config && r.source === row.source);
    const loadMedian = median(loads.map(r => r.loadMs));
    const item = document.createElement("div");
    item.className = "benchmark-result";
    item.textContent = `${row.name} · ${new Date(row.at).toLocaleString()}\nThree-run medians · First visible text: ${(row.firstTextMs / 1000).toFixed(2)}s · ${row.tokensPerSecond == null ? "Token rate unavailable" : row.tokensPerSecond.toFixed(1) + " tokens/s (whole reply)"}\nActual load median: ${loadMedian == null ? "unavailable" : (loadMedian / 1000).toFixed(1) + "s"} (${loads.length} loads, ${row.source})`;
    const device = document.createElement("small");
    try { const p = JSON.parse(row.profile); device.textContent = `${p.gpu} · ${p.browser}`; } catch {}
    item.append(device); list.append(item);
  }
}
$("#benchmarkButton").onclick = () => { renderBenchmarks(); $("#benchmarkDialog").showModal(); };
$("#clearBenchmarks").onclick = () => { localStorage.removeItem(PERFORMANCE_KEY); localStorage.removeItem("pocket-ai-benchmarks-v1"); renderBenchmarks(); renderRecommendation(); };
$("#runBenchmark").onclick = async () => {
  const output = $("#benchmarkStatus");
  if (!engine || engineRuntime === "online") { output.textContent = "Load a local model first. Online models are not benchmarked."; return; }
  if (busy || load.disabled) { output.textContent = "Wait for the current operation to finish."; return; }
  const button = $("#runBenchmark");
  button.disabled = true;
  busy = true; stopRequested = false; input.disabled = true; setGenerating(true);
  try {
    if (kvReady) { await kvReady.catch(() => {}); kvReady = null; }
    const result = await measureRuns({
      reset: async () => {
        if (engineRuntime === "webllm") await engine.resetChat();
        else resetChatKv();
      }, stopped: () => stopRequested || !engine,
      progress: text => { output.textContent = text + " Close this panel and tap Stop to interrupt."; },
      generate: onText => generateSegment({ messages: [{ role: "user", content: "Explain how rain forms in five short sentences." }] }, { maxTokens: 128, benchmark: true, onText }),
    });
    const saved = recordMeasurement({ ...measurementBase(), kind: "benchmark", source: loadSource, ...result });
    output.textContent = saved ? "Saved locally: warm-up excluded, three measured runs. Speed is not a measure of answer quality." : "Completed, but browser storage could not save the results.";
    renderBenchmarks(); renderRecommendation();
  } catch (error) { output.textContent = "Benchmark did not finish: " + error.message; }
  finally {
    try { if (engineRuntime === "webllm" && engine) await engine.resetChat(); else resetChatKv(); } catch {}
    busy = false; input.disabled = !engine; setGenerating(false); button.disabled = false; render();
  }
};

let capabilityAbort = null;
let routeConfirmed = false;
async function check27BRoute(signal) {
  if (!navigator.onLine) throw new Error("27B online requires internet. Local models remain available offline.");
  const response = await fetch("/api/online-assist", { method: "GET", cache: "no-store", signal });
  const value = await response.json().catch(() => null);
  if (!response.ok || value?.protocol !== "pocket-assist-v2") throw new Error("The deployed backend does not support the 27B route yet.");
  if (value.bonsai27b !== true) throw new Error("The server has no specific Bonsai 27B route configured yet.");
}
function offer27B(reason) {
  routeConfirmed = false;
  $("#confirm27B").disabled = true;
  $("#fallbackReason").textContent = reason;
  $("#fallbackStatus").textContent = "Nothing has been sent online.";
  if (!$("#fallbackDialog").open) $("#fallbackDialog").showModal();
}
$("#try27BOnline").onclick = () => offer27B("Local 27B needs about 3.8 GB for weights plus working memory. GPU buffer limits and available memory may prevent loading, even with its 2K context.");
$("#fallbackDialog").addEventListener("close", () => { capabilityAbort?.abort(); routeConfirmed = false; $("#confirm27B").disabled = true; });
$("#check27B").onclick = async () => {
  capabilityAbort?.abort();
  const ctl = new AbortController(); capabilityAbort = ctl;
  const timeout = setTimeout(() => ctl.abort(), 15000);
  routeConfirmed = false; $("#confirm27B").disabled = true;
  $("#fallbackStatus").textContent = "Checking server configuration; no chat or page is sent…";
  try {
    await check27BRoute(ctl.signal);
    if (ctl.signal.aborted || !$("#fallbackDialog").open) return;
    routeConfirmed = true; $("#confirm27B").disabled = false;
    $("#fallbackStatus").textContent = "A 27B route is configured. Service availability will be checked when you send.";
  } catch (error) {
    if (capabilityAbort === ctl && $("#fallbackDialog").open) $("#fallbackStatus").textContent = ctl.signal.aborted ? "Check cancelled or timed out. Try again." : error.message;
  } finally { clearTimeout(timeout); }
};
$("#confirm27B").onclick = async () => {
  if (!routeConfirmed || busy || load.disabled) { $("#fallbackStatus").textContent = "Finish or cancel the current operation before switching."; return; }
  if (!navigator.onLine) { $("#fallbackStatus").textContent = "Reconnect to use 27B online."; return; }
  busy = true;
  try {
    await kvReady?.catch(() => {}); kvReady = null;
    try { chatEngine?.dispose?.(); } catch {}
    try { if (engineRuntime === "webllm") await engine?.unload?.(); else engine?.dispose?.(); } catch {}
    engine = null; chatEngine = null; engineRuntime = null; pickedFile = null;
    selected = "Bonsai-27B-online";
    localStorage.setItem(KEY, "Bonsai-27B-bitgpu");
    modelButton.textContent = model().name;
    engineRuntime = "online"; engine = { remote: true };
    updateWelcome(); render(); renderModels();
    input.disabled = false; send.disabled = false;
    status.textContent = "Bonsai 27B online · ready";
    $("#fallbackDialog").close();
    sheet.classList.remove("open");
    notifyUser("Bonsai 27B online selected. Tap Send to submit your question and relevant chat/page context. Nothing is sent automatically.");
  } finally { busy = false; }
};
const interruptedLoad = readJournal();
finishJournal();
if (interruptedLoad) {
  if (interruptedLoad.profile && interruptedLoad.config) recordMeasurement({ ...interruptedLoad, kind: "failure", phase: "interrupted" });
  const reason = `The previous model load stopped during ${interruptedLoad.phase || "loading"}. This can follow a reload or tab interruption; it does not prove a memory failure.`;
  if (interruptedLoad.model === "Bonsai-27B-bitgpu") offer27B(reason);
  else notifyUser(reason);
}

// This HTML is compiled from the repository manual, never from attached text.
$("#guideContent").innerHTML = userManualHtml;
for (const id of ["#welcomeHelp", "#drawerHelp"]) $(id).onclick = () => $("#guideDialog").showModal();
$("#guideContent").addEventListener("click", event => {
  const link = event.target.closest('a[href^="#guide-"]');
  if (!link) return;
  event.preventDefault();
  const target = document.getElementById(link.getAttribute("href").slice(1));
  target?.scrollIntoView({ block: "start" });
  target?.focus({ preventScroll: true });
});
$("#offlineModels").onclick = () => { $("#setupDialog").close(); modelButton.click(); };
$("#textSuggestions").addEventListener("click", event => {
  const button = event.target.closest("button[data-question]");
  if (!button || busy || hydrating || editingIndex !== null) return;
  input.value = button.dataset.question;
  if (engine) input.focus();
  else notifyUser("Question prepared. Load a model, then tap Send.");
});
// Native dialogs keep keyboard focus inside and restore it to their opener.
for (const dialog of document.querySelectorAll("dialog")) {
  let opener;
  const show = dialog.showModal.bind(dialog);
  dialog.showModal = () => { opener = document.activeElement; show(); };
  dialog.addEventListener("close", () => {
    const target = opener?.isConnected ? opener : !input.disabled ? input : $("#loadTools");
    target?.focus({ preventScroll: true });
  });
}
