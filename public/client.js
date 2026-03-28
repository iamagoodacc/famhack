/** Keep in sync with server `ALLOWED_MODES` when you add modes. */
const GAME_MODES = [
  {
    id: "arena",
    label: "Family Feud",
    description: "Random house layout, free-for-all. Bullets bounce off walls.",
    available: true,
  },
  {
    id: "pve",
    label: "Intruders (PvE)",
    description: "Work together or solo: bots pathfind through the maze (A*) to flank you and shoot.",
    available: true,
  },
  {
    id: "teams",
    label: "Family Teams",
    description: "Pick sides in the family dispute. Friendly fire off.",
    available: false,
  },
  {
    id: "survival",
    label: "Home Invasion",
    description: "Survive waves of intruders in your family home.",
    available: false,
  },
];

const STORAGE_NAME = "famhack_name";
const STORAGE_MODE = "famhack_mode";
const STORAGE_ROOM = "famhack_room";

const ROOM_CODE_LEN = 6;

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const canvasWrap = document.getElementById("canvas-wrap");
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
  document.body.classList.add("game-active");
  gameActive = true;
  queueMicrotask(() => state && draw());
}

function leaveGameUi() {
  gameActive = false;
  document.body.classList.remove("game-active");
  roomHud.classList.add("hidden");
  currentRoomCode = null;
  screenGame.classList.add("hidden");
  screenGame.setAttribute("hidden", "");
  screenLobby.classList.remove("hidden");
  screenLobby.removeAttribute("hidden");
}

const resizeObserver = new ResizeObserver(() => {
  if (gameActive && state) draw();
});
resizeObserver.observe(canvasWrap);

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

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
}

/**
 * Top-down person with a gun (~1.4x bigger, more detail).
 * Facing right (angle=0).
 */
function drawTankSprite(ctx, hullColor, isLocal) {
  const S = 1.4; // scale factor

  // Shadow on ground
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.ellipse(0, 2 * S, 12 * S, 8 * S, 0, 0, Math.PI * 2);
  ctx.fill();

  // Feet / shoes (behind legs)
  ctx.fillStyle = "#3a2a1a";
  ctx.beginPath();
  ctx.ellipse(-5 * S, -6 * S, 2.5 * S, 1.8 * S, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-5 * S, 6 * S, 2.5 * S, 1.8 * S, 0.3, 0, Math.PI * 2);
  ctx.fill();

  // Legs (trouser color)
  ctx.fillStyle = shadeColor(hullColor, -45);
  ctx.beginPath();
  ctx.ellipse(-3 * S, -5.5 * S, 4 * S, 2.8 * S, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-3 * S, 5.5 * S, 4 * S, 2.8 * S, 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Body (torso)
  ctx.fillStyle = hullColor;
  ctx.beginPath();
  ctx.ellipse(0, 0, 8 * S, 7.5 * S, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = isLocal ? "#fff" : "rgba(255,255,255,0.35)";
  ctx.lineWidth = isLocal ? 2 : 1;
  ctx.stroke();

  // Shirt pocket detail
  ctx.strokeStyle = shadeColor(hullColor, -18);
  ctx.lineWidth = 0.7;
  ctx.strokeRect(-1 * S, -3 * S, 3.5 * S, 3 * S);

  // Collar V-line
  ctx.strokeStyle = shadeColor(hullColor, -25);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(3 * S, -2.5 * S);
  ctx.lineTo(5 * S, 0);
  ctx.lineTo(3 * S, 2.5 * S);
  ctx.stroke();

  // Arm holding gun (right arm, skin-toned hand)
  ctx.fillStyle = shadeColor(hullColor, -15);
  ctx.beginPath();
  ctx.moveTo(4 * S, -3 * S);
  ctx.lineTo(12 * S, -3.2 * S);
  ctx.lineTo(12 * S, 0.5 * S);
  ctx.lineTo(4 * S, 1 * S);
  ctx.closePath();
  ctx.fill();
  // Hand
  ctx.fillStyle = "#e0b896";
  ctx.beginPath();
  ctx.ellipse(12 * S, -1.2 * S, 2 * S, 2.2 * S, 0, 0, Math.PI * 2);
  ctx.fill();

  // Other arm (left, tucked, supporting)
  ctx.fillStyle = shadeColor(hullColor, -15);
  ctx.beginPath();
  ctx.moveTo(2 * S, 4 * S);
  ctx.lineTo(8 * S, 3 * S);
  ctx.lineTo(8 * S, 5.5 * S);
  ctx.lineTo(2 * S, 6.5 * S);
  ctx.closePath();
  ctx.fill();
  // Hand
  ctx.fillStyle = "#e0b896";
  ctx.beginPath();
  ctx.ellipse(8.5 * S, 4.2 * S, 1.8 * S, 2 * S, 0, 0, Math.PI * 2);
  ctx.fill();

  // Gun body
  ctx.fillStyle = "#3a3a3a";
  ctx.fillRect(10 * S, -3 * S, 13 * S, 4.2 * S);
  // Barrel
  ctx.fillStyle = "#2a2a2a";
  ctx.fillRect(21 * S, -2.4 * S, 4.5 * S, 3 * S);
  // Grip
  ctx.fillStyle = "#4a3a2a";
  ctx.fillRect(10 * S, -3 * S, 2.5 * S, 4.2 * S);
  // Trigger guard
  ctx.strokeStyle = "#555";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.arc(13 * S, 0.8 * S, 1.2 * S, 0, Math.PI);
  ctx.stroke();
  // Muzzle
  ctx.fillStyle = "#666";
  ctx.fillRect(25 * S, -1.6 * S, 1.5 * S, 1.5 * S);

  // Head
  const skinTone = "#e0b896";
  ctx.fillStyle = skinTone;
  ctx.beginPath();
  ctx.arc(1.5 * S, 0, 5 * S, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Ear
  ctx.fillStyle = "#d4a880";
  ctx.beginPath();
  ctx.ellipse(-2.5 * S, 0, 1.5 * S, 2 * S, 0, 0, Math.PI * 2);
  ctx.fill();

  // Hair (crescent on back of head)
  ctx.fillStyle = shadeColor(hullColor, -55);
  ctx.beginPath();
  ctx.arc(0.5 * S, 0, 5.2 * S, Math.PI * 0.5, Math.PI * 1.5);
  ctx.fill();

  // Eye dot
  ctx.fillStyle = "#2a2015";
  ctx.beginPath();
  ctx.arc(4.5 * S, -1.2 * S, 0.8 * S, 0, Math.PI * 2);
  ctx.fill();
}

function draw() {
  if (!state || !canvasWrap) return;

  const rect = canvasWrap.getBoundingClientRect();
  const cw = Math.max(1, Math.floor(rect.width));
  const ch = Math.max(1, Math.floor(rect.height));
  const dpr = window.devicePixelRatio || 1;

  canvas.width = cw * dpr;
  canvas.height = ch * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#1a120b";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const { arena, walls, players, bullets } = state;
  const aw = arena.w;
  const ah = arena.h;
  /** Slightly under “fit” so more of the arena is visible (maze appears smaller). */
  const VIEW_ZOOM = 0.98;
  const base = Math.min(cw / aw, ch / ah);
  const scale = base * VIEW_ZOOM;
  const ox = (cw - aw * scale) / 2;
  const oy = (ch - ah * scale) / 2;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#1a120b";
  ctx.fillRect(0, 0, cw, ch);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, cw, ch);
  ctx.clip();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);

  // Wooden floor background
  ctx.fillStyle = "#5c4033";
  ctx.fillRect(0, 0, aw, ah);
  // Floor planks
  ctx.strokeStyle = "rgba(40,25,15,0.3)";
  ctx.lineWidth = 1;
  const plankW = 35;
  for (let x = 0; x <= aw; x += plankW) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ah);
    ctx.stroke();
  }
  // Horizontal plank joints (staggered)
  ctx.strokeStyle = "rgba(40,25,15,0.2)";
  ctx.lineWidth = 0.5;
  const plankH = 80;
  for (let y = 0; y <= ah; y += plankH) {
    for (let x = 0; x <= aw; x += plankW) {
      const offset = ((x / plankW) % 2) * (plankH / 2);
      ctx.beginPath();
      ctx.moveTo(x, y + offset);
      ctx.lineTo(x + plankW, y + offset);
      ctx.stroke();
    }
  }
  // Warm light gradient overlay
  const floorLight = ctx.createRadialGradient(aw * 0.5, ah * 0.4, 0, aw * 0.5, ah * 0.5, Math.max(aw, ah) * 0.7);
  floorLight.addColorStop(0, "rgba(120,90,50,0.15)");
  floorLight.addColorStop(1, "rgba(0,0,0,0.2)");
  ctx.fillStyle = floorLight;
  ctx.fillRect(0, 0, aw, ah);

  for (const wall of walls) {
    // Render walls slightly thinner than their collision geometry
    let wx = wall.x;
    let wy = wall.y;
    let ww = wall.w;
    let wh = wall.h;
    if (wall.w >= wall.h) {
      const thinH = wall.h * 0.78;
      wy += (wall.h - thinH) / 2;
      wh = thinH;
    } else {
      const thinW = wall.w * 0.78;
      wx += (wall.w - thinW) / 2;
      ww = thinW;
    }

    // House wall base
    ctx.fillStyle = "#c4a882";
    ctx.fillRect(wx, wy, ww, wh);
    // Wall texture - subtle plaster lines
    ctx.strokeStyle = "rgba(180,155,120,0.4)";
    ctx.lineWidth = 0.5;
    if (ww > wh) {
      for (let ly = wy + 3; ly < wy + wh; ly += 4) {
        ctx.beginPath();
        ctx.moveTo(wx, ly);
        ctx.lineTo(wx + ww, ly);
        ctx.stroke();
      }
    } else {
      for (let lx = wx + 3; lx < wx + ww; lx += 4) {
        ctx.beginPath();
        ctx.moveTo(lx, wy);
        ctx.lineTo(lx, wy + wh);
        ctx.stroke();
      }
    }
    // Baseboard trim
    ctx.fillStyle = "#8b6f4e";
    if (ww > wh) {
      ctx.fillRect(wx, wy + wh - 2, ww, 2);
      ctx.fillRect(wx, wy, ww, 1.5);
    } else {
      ctx.fillRect(wx + ww - 2, wy, 2, wh);
      ctx.fillRect(wx, wy, 1.5, wh);
    }
    // Wall edge shadow
    ctx.strokeStyle = "rgba(60,40,20,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(wx + 0.5, wy + 0.5, ww - 1, wh - 1);
  }

  const vignette = ctx.createRadialGradient(aw * 0.5, ah * 0.5, Math.min(aw, ah) * 0.25, aw * 0.5, ah * 0.5, Math.max(aw, ah) * 0.65);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(30,15,0,0.3)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, aw, ah);

  for (const b of bullets) {
    // Small solid bullet
    ctx.fillStyle = "#c8a050";
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffe8b0";
    ctx.beginPath();
    ctx.arc(b.x - 0.8, b.y - 0.8, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(100,70,30,0.5)";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  const enemies = state.enemies ?? [];
  const ENEMY_HULL = "#b33a3a";

  for (const e of enemies) {
    if (!e.alive) continue;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);
    drawTankSprite(ctx, ENEMY_HULL, false);
    ctx.restore();

    const nameY = e.y - 20;
    ctx.font = "600 13px Segoe UI, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.strokeText(e.name, e.x, nameY);
    ctx.fillStyle = "#f0b4b4";
    ctx.fillText(e.name, e.x, nameY);
  }

  for (const p of players) {
    const col = colorForId(p.id);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    drawTankSprite(ctx, col, p.id === myId);
    ctx.restore();

    const nameY = p.y - 26;
    ctx.font = "600 13px Segoe UI, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.strokeText(p.name, p.x, nameY);
    ctx.fillStyle = "#e6edf3";
    ctx.fillText(p.name, p.x, nameY);
  }

  ctx.restore();
}

/** Darken/lighten hex color for simple shading. */
function shadeColor(hex, percent) {
  const n = hex.replace("#", "");
  const num = parseInt(n, 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + percent));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + percent));
  const b = Math.max(0, Math.min(255, (num & 0xff) + percent));
  return `rgb(${r},${g},${b})`;
}
