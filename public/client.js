/** Keep in sync with server `ALLOWED_MODES` when you add modes. */
const GAME_MODES = [
  {
    id: "arena",
    label: "Classic Arena",
    description: "Random maze, free-for-all. Bullets bounce off walls.",
    available: true,
  },
  {
    id: "teams",
    label: "Teams",
    description: "Same arena with team colors and friendly fire off.",
    available: false,
  },
  {
    id: "survival",
    label: "Survival",
    description: "Waves of bots or shrinking ring — placeholder.",
    available: false,
  },
];

const STORAGE_NAME = "famhack_name";
const STORAGE_MODE = "famhack_mode";
const STORAGE_ROOM = "famhack_room";

const ROOM_CODE_LEN = 6;

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const scoresEl = document.getElementById("scores");
const screenLobby = document.getElementById("screen-lobby");
const screenGame = document.getElementById("screen-game");
const nameInput = document.getElementById("name-input");
const roomInput = document.getElementById("room-input");
const modeOptionsEl = document.getElementById("mode-options");
const btnPlay = document.getElementById("btn-play");
const lobbyError = document.getElementById("lobby-error");
const roomHud = document.getElementById("room-hud");
const roomCodeDisplay = document.getElementById("room-code-display");
const btnCopyCode = document.getElementById("btn-copy-code");
const btnCopyLink = document.getElementById("btn-copy-link");

let socket = null;
let state = null;
let myId = null;
let gameActive = false;
let selectedModeId = "arena";
let currentRoomCode = null;

function normalizeRoomCode(raw) {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, "")
    .slice(0, ROOM_CODE_LEN);
}

function showLobbyError(msg) {
  lobbyError.textContent = msg;
  lobbyError.hidden = !msg;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function buildModeOptions() {
  const stored = localStorage.getItem(STORAGE_MODE) || "arena";
  const firstAvailable = GAME_MODES.find((m) => m.available);
  const resolved =
    GAME_MODES.find((m) => m.available && m.id === stored)?.id || firstAvailable?.id || "arena";
  selectedModeId = resolved;

  GAME_MODES.forEach((m) => {
    const id = `mode-${m.id}`;
    const label = document.createElement("label");
    label.className = `mode-option${m.available ? "" : " mode-option--disabled"}`;

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "gameMode";
    input.value = m.id;
    input.id = id;
    input.disabled = !m.available;
    input.checked = m.id === resolved;
    if (input.checked) label.classList.add("mode-option--selected");

    const body = document.createElement("div");
    body.className = "mode-option-body";
    const title = document.createElement("div");
    title.className = "mode-option-title";
    title.appendChild(document.createTextNode(m.label));
    if (!m.available) {
      const badge = document.createElement("span");
      badge.className = "mode-badge";
      badge.textContent = "Soon";
      title.appendChild(badge);
    }
    const desc = document.createElement("p");
    desc.className = "mode-option-desc";
    desc.textContent = m.description;

    body.appendChild(title);
    body.appendChild(desc);
    label.appendChild(input);
    label.appendChild(body);

    label.addEventListener("click", (e) => {
      if (!m.available) {
        e.preventDefault();
        showLobbyError("That mode is not available yet.");
        return;
      }
      selectedModeId = m.id;
      document.querySelectorAll(".mode-option").forEach((el) => {
        el.classList.remove("mode-option--selected");
        const inp = el.querySelector('input[name="gameMode"]');
        if (inp) inp.checked = false;
      });
      input.checked = true;
      label.classList.add("mode-option--selected");
      showLobbyError("");
    });

    modeOptionsEl.appendChild(label);
  });
}

const savedName = localStorage.getItem(STORAGE_NAME);
if (savedName) nameInput.value = savedName;

buildModeOptions();

roomInput.addEventListener("input", () => {
  roomInput.value = normalizeRoomCode(roomInput.value);
});

function setRoomHud(code) {
  currentRoomCode = code;
  roomCodeDisplay.textContent = code;
  roomHud.classList.remove("hidden");
}

function buildInviteUrl() {
  const u = new URL(window.location.href);
  u.searchParams.set("room", currentRoomCode);
  const n = nameInput.value.trim();
  if (n) u.searchParams.set("name", n);
  u.searchParams.set("mode", selectedModeId);
  return u.toString();
}

btnCopyCode.addEventListener("click", async () => {
  if (!currentRoomCode) return;
  try {
    await navigator.clipboard.writeText(currentRoomCode);
    const t = btnCopyCode.textContent;
    btnCopyCode.textContent = "Copied!";
    setTimeout(() => {
      btnCopyCode.textContent = t;
    }, 1400);
  } catch {
    window.prompt("Copy this room code:", currentRoomCode);
  }
});

btnCopyLink.addEventListener("click", async () => {
  if (!currentRoomCode) return;
  const link = buildInviteUrl();
  try {
    await navigator.clipboard.writeText(link);
    const t = btnCopyLink.textContent;
    btnCopyLink.textContent = "Copied!";
    setTimeout(() => {
      btnCopyLink.textContent = t;
    }, 1400);
  } catch {
    window.prompt("Copy this invite link:", link);
  }
});

const keys = {
  forward: false,
  back: false,
  left: false,
  right: false,
  fire: false,
};

function setKey(code, down) {
  switch (code) {
    case "KeyW":
    case "ArrowUp":
      keys.forward = down;
      break;
    case "KeyS":
    case "ArrowDown":
      keys.back = down;
      break;
    case "KeyA":
    case "ArrowLeft":
      keys.left = down;
      break;
    case "KeyD":
    case "ArrowRight":
      keys.right = down;
      break;
    case "Space":
      keys.fire = down;
      break;
    default:
      return;
  }
}

window.addEventListener("keydown", (e) => {
  if (!gameActive) return;
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
    e.preventDefault();
  }
  setKey(e.code, true);
});

window.addEventListener("keyup", (e) => {
  if (!gameActive) return;
  setKey(e.code, false);
});

function emitInput() {
  if (!gameActive || !socket?.connected) return;
  socket.emit("input", { ...keys });
}

setInterval(emitInput, 1000 / 30);

function enterGame() {
  screenLobby.classList.add("hidden");
  screenLobby.setAttribute("hidden", "");
  screenGame.classList.remove("hidden");
  screenGame.removeAttribute("hidden");
  gameActive = true;
}

function leaveGameUi() {
  gameActive = false;
  roomHud.classList.add("hidden");
  currentRoomCode = null;
  screenGame.classList.add("hidden");
  screenGame.setAttribute("hidden", "");
  screenLobby.classList.remove("hidden");
  screenLobby.removeAttribute("hidden");
}

function connect(name, mode, roomQuery) {
  socket?.disconnect();
  socket = io({ query: { name, mode, room: roomQuery } });

  socket.on("connect", () => {
    myId = socket.id;
  });

  socket.on("room", ({ code }) => {
    setRoomHud(code);
    localStorage.setItem(STORAGE_ROOM, code);
    const params = new URLSearchParams({ name, mode: selectedModeId, room: code });
    history.replaceState(null, "", `${window.location.pathname}?${params}`);
    enterGame();
  });

  socket.on("room_error", (data) => {
    showLobbyError(data?.message || "Could not join that room.");
    socket?.disconnect();
    socket = null;
    btnPlay.disabled = false;
  });

  socket.on("state", (snap) => {
    state = snap;
    renderScores(snap);
    draw();
  });

  socket.on("connect_error", (err) => {
    socket = null;
    showLobbyError(err.message || "Could not connect.");
    if (gameActive) leaveGameUi();
    btnPlay.disabled = false;
  });
}

function startFromLobby() {
  showLobbyError("");
  const raw = nameInput.value.trim();
  const name = raw || `Player${Math.floor(Math.random() * 900 + 100)}`;
  if (name.length > 24) {
    showLobbyError("Name is too long.");
    return;
  }

  const modeDef = GAME_MODES.find((m) => m.id === selectedModeId);
  if (!modeDef?.available) {
    showLobbyError("Pick an available game mode.");
    return;
  }

  const rc = normalizeRoomCode(roomInput.value);
  if (rc.length > 0 && rc.length < ROOM_CODE_LEN) {
    showLobbyError(`Room code must be ${ROOM_CODE_LEN} characters (or leave empty to create a room).`);
    return;
  }

  const roomQuery = rc.length === ROOM_CODE_LEN ? rc : "new";

  localStorage.setItem(STORAGE_NAME, name);
  localStorage.setItem(STORAGE_MODE, selectedModeId);

  btnPlay.disabled = true;
  connect(name, selectedModeId, roomQuery);
}

btnPlay.addEventListener("click", startFromLobby);

nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startFromLobby();
});

roomInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startFromLobby();
});

const params = new URLSearchParams(window.location.search);
const quickName = params.get("name")?.trim();
const quickModeRaw = params.get("mode");
const quickRoomRaw = params.get("room");
const quickModeDef = quickModeRaw ? GAME_MODES.find((m) => m.id === quickModeRaw && m.available) : null;
if (quickName) {
  nameInput.value = quickName.slice(0, 24);
}
if (quickModeDef) {
  selectedModeId = quickModeDef.id;
  document.querySelectorAll('input[name="gameMode"]').forEach((input) => {
    const on = input.value === quickModeDef.id;
    input.checked = on;
    const label = input.closest(".mode-option");
    if (label) {
      label.classList.toggle("mode-option--selected", on);
    }
  });
}
if (quickRoomRaw && quickRoomRaw.toLowerCase() !== "new") {
  const qr = normalizeRoomCode(quickRoomRaw);
  if (qr.length === ROOM_CODE_LEN) roomInput.value = qr;
} else {
  const savedRoom = localStorage.getItem(STORAGE_ROOM);
  if (savedRoom && normalizeRoomCode(savedRoom).length === ROOM_CODE_LEN) {
    roomInput.value = normalizeRoomCode(savedRoom);
  }
}
const quickRoomNorm = quickRoomRaw ? normalizeRoomCode(quickRoomRaw) : "";
const roomOkForAutoplay =
  !quickRoomRaw ||
  quickRoomRaw.toLowerCase() === "new" ||
  quickRoomNorm.length === ROOM_CODE_LEN;
if (params.get("play") === "1" && quickName && quickModeDef && roomOkForAutoplay) {
  queueMicrotask(() => startFromLobby());
}

function renderScores(snap) {
  if (!snap.players?.length) {
    scoresEl.textContent = "";
    return;
  }
  scoresEl.innerHTML = snap.players
    .map((p) => {
      const tag = p.id === myId ? " (you)" : "";
      return `<span>${escapeHtml(p.name)}: ${p.score}${tag}</span>`;
    })
    .join("");
}

const COLORS = ["#58a6ff", "#f85149", "#d2a8ff", "#79c0ff", "#ffa657", "#7ee787"];

function colorForId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

function draw() {
  if (!state) return;
  const { arena, walls, players, bullets } = state;
  const w = arena.w;
  const h = arena.h;

  ctx.fillStyle = "#0d1117";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "#21262d";
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#30363d";
  for (const wall of walls) {
    ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
  }
  ctx.strokeStyle = "#484f58";
  ctx.lineWidth = 2;
  for (const wall of walls) {
    ctx.strokeRect(wall.x + 0.5, wall.y + 0.5, wall.w - 1, wall.h - 1);
  }

  for (const b of bullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#ff7b72";
    ctx.fill();
    ctx.strokeStyle = "#ffb1ab";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  for (const p of players) {
    const col = colorForId(p.id);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = col;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = p.id === myId ? 3 : 2;
    ctx.beginPath();
    const tw = 32;
    const th = 24;
    const rr = 4;
    const lx = -tw / 2;
    const ly = -th / 2;
    ctx.moveTo(lx + rr, ly);
    ctx.lineTo(lx + tw - rr, ly);
    ctx.quadraticCurveTo(lx + tw, ly, lx + tw, ly + rr);
    ctx.lineTo(lx + tw, ly + th - rr);
    ctx.quadraticCurveTo(lx + tw, ly + th, lx + tw - rr, ly + th);
    ctx.lineTo(lx + rr, ly + th);
    ctx.quadraticCurveTo(lx, ly + th, lx, ly + th - rr);
    ctx.lineTo(lx, ly + rr);
    ctx.quadraticCurveTo(lx, ly, lx + rr, ly);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(10, -4, 10, 8);
    ctx.restore();

    ctx.font = "11px Segoe UI, sans-serif";
    ctx.fillStyle = "#c9d1d9";
    ctx.textAlign = "center";
    ctx.fillText(p.name, p.x, p.y - 22);
  }
}
