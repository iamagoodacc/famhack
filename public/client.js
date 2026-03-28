/** Keep in sync with server `ALLOWED_MODES` when you add modes. */
const GAME_MODES = [
  {
    id: "arena",
    label: "Family Feud",
    description:
      "FFA with respawn delay, HP, and random guns. Your own shots cannot hurt you. Kills add to your score; the maze stays the same.",
    available: true,
  },
  {
    id: "pve",
    label: "Intruders (PvE)",
    description:
      "Wave co-op vs bots (A*). Your shots do not hurt family; only intruders do. Clear waves for breaks.",
    available: true,
  },
  {
    id: "deathmatch",
    label: "Deathmatch",
    description:
      "One life per round. ELIM = spectate until one player is left; they win the round and everyone respawns on a new maze.",
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
const STORAGE_LOCAL = "famhack_local_players";
const STORAGE_KEYBINDS = "famhack_keybinds_v1";
const BIND_ACTIONS = ["forward", "back", "left", "right", "fire", "reload"];

const ROOM_CODE_LEN = 6;

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const canvasWrap = document.getElementById("canvas-wrap");
const leaderboardBody = document.getElementById("leaderboard-body");
const leaderboardMeta = document.getElementById("leaderboard-meta");
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
const localPlayersSelect = document.getElementById("local-players-select");
const gameHintEl = document.getElementById("game-hint");
const keybindPanel = document.getElementById("keybind-panel");
const btnResetKeybinds = document.getElementById("btn-reset-keybinds");

/** 1–4 couch seats; each seat gets its own socket.id on the server. */
let localPlayerCount = 1;
/** @type {{ socket: any; slot: number }[]} */
let connectionSlots = [];
const localIds = new Set();

let socket = null;
let state = null;
/** Wall time when `state` was last applied (for aligning with `serverNow`). */
let lastStateReceiveMs = 0;
/** `serverNow` from the last snapshot. */
let lastServerNow = 0;
let gameActive = false;
let selectedModeId = "arena";
let currentRoomCode = null;
let couchSlavesSpawned = false;

const COUCH_BINDINGS = [
  { forward: ["KeyW"], back: ["KeyS"], left: ["KeyA"], right: ["KeyD"], fire: ["Space"], reload: ["KeyR"] },
  { forward: ["ArrowUp"], back: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"], fire: ["Enter"], reload: ["ShiftRight"] },
  { forward: ["KeyI"], back: ["KeyK"], left: ["KeyJ"], right: ["KeyL"], fire: ["Slash"], reload: ["Semicolon"] },
  {
    forward: ["Numpad8"],
    back: ["Numpad5"],
    left: ["Numpad4"],
    right: ["Numpad6"],
    fire: ["Numpad0", "NumpadEnter"],
    reload: ["NumpadDecimal"],
  },
];

const SOLO_BINDING = {
  forward: ["KeyW", "ArrowUp"],
  back: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  fire: ["Space"],
  reload: ["KeyR"],
};

const keybindCache = new Map();
/** @type {{ seat: number; action: string; buttonEl: HTMLButtonElement } | null} */
let keybindCapture = null;

function cloneBinding(b) {
  return {
    forward: [...b.forward],
    back: [...b.back],
    left: [...b.left],
    right: [...b.right],
    fire: [...b.fire],
    reload: [...b.reload],
  };
}

function computeDefaultBindingForSeatWithCount(seat, seatCount) {
  if (seatCount === 1 && seat === 0) return cloneBinding(SOLO_BINDING);
  return cloneBinding(COUCH_BINDINGS[seat] || COUCH_BINDINGS[0]);
}

function computeMergedBindingUncachedFor(slot, seatCount) {
  const base = computeDefaultBindingForSeatWithCount(slot, seatCount);
  const out = cloneBinding(base);
  try {
    const t = localStorage.getItem(STORAGE_KEYBINDS);
    if (!t) return out;
    const o = JSON.parse(t);
    const raw = o[String(slot)];
    if (!raw || typeof raw !== "object") return out;
    for (const a of BIND_ACTIONS) {
      if (Array.isArray(raw[a]) && raw[a].length) {
        const c = raw[a].filter((x) => typeof x === "string");
        if (c.length) out[a] = [...new Set(c)];
      }
    }
  } catch {
    return cloneBinding(base);
  }
  return out;
}

function invalidateKeybindCache() {
  keybindCache.clear();
}

function bindingForSlotWithCount(slot, seatCount) {
  const cacheKey = `${seatCount}|${slot}`;
  if (keybindCache.has(cacheKey)) return keybindCache.get(cacheKey);
  const m = computeMergedBindingUncachedFor(slot, seatCount);
  keybindCache.set(cacheKey, m);
  return m;
}

function bindingForSlot(slot) {
  return bindingForSlotWithCount(slot, localPlayerCount);
}

function setBindingKey(seat, action, code, altAppend) {
  invalidateKeybindCache();
  const lc = readLocalPlayersFromUi();
  const bindings = [];
  for (let s = 0; s < 4; s++) {
    bindings.push(computeMergedBindingUncachedFor(s, lc));
  }
  for (let s = 0; s < 4; s++) {
    for (const a of BIND_ACTIONS) {
      bindings[s][a] = bindings[s][a].filter((c) => c !== code);
    }
  }
  if (altAppend && bindings[seat][action].length < 2) {
    if (!bindings[seat][action].includes(code)) bindings[seat][action].push(code);
  } else {
    bindings[seat][action] = [code];
  }
  const store = {};
  for (let s = 0; s < 4; s++) store[String(s)] = bindings[s];
  localStorage.setItem(STORAGE_KEYBINDS, JSON.stringify(store));
  invalidateKeybindCache();
}

function formatKeyCode(code) {
  const map = {
    Space: "Space",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Slash: "/",
    Enter: "Enter",
    Backquote: "`",
  };
  if (map[code]) return map[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return code.replace("Numpad", "Num");
  return code;
}

function renderKeybindPanel() {
  if (!keybindPanel) return;
  const n = readLocalPlayersFromUi();
  keybindPanel.replaceChildren();
  for (let seat = 0; seat < n; seat++) {
    const wrap = document.createElement("div");
    wrap.className = "keybind-seat";
    const h = document.createElement("h4");
    h.className = "keybind-seat-title";
    h.textContent = n === 1 ? "Controls" : `Player ${seat + 1}`;
    wrap.appendChild(h);
    const b = bindingForSlotWithCount(seat, n);
    for (const act of BIND_ACTIONS) {
      const row = document.createElement("div");
      row.className = "keybind-row";
      const lab = document.createElement("label");
      lab.textContent = act;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "keybind-bind";
      for (const c of b[act]) {
        const sp = document.createElement("span");
        sp.className = "keybind-chip";
        sp.textContent = formatKeyCode(c);
        btn.appendChild(sp);
      }
      btn.addEventListener("click", () => {
        if (keybindCapture?.buttonEl) keybindCapture.buttonEl.classList.remove("is-capturing");
        keybindCapture = { seat, action: act, buttonEl: btn };
        btn.classList.add("is-capturing");
      });
      row.appendChild(lab);
      row.appendChild(btn);
      wrap.appendChild(row);
    }
    keybindPanel.appendChild(wrap);
  }
}

window.addEventListener(
  "keydown",
  (e) => {
    if (!keybindCapture) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const { seat, action, buttonEl } = keybindCapture;
    if (e.code === "Escape") {
      buttonEl.classList.remove("is-capturing");
      keybindCapture = null;
      renderKeybindPanel();
      return;
    }
    setBindingKey(seat, action, e.code, e.altKey);
    buttonEl.classList.remove("is-capturing");
    keybindCapture = null;
    renderKeybindPanel();
  },
  true,
);

/** @type {{ forward: boolean; back: boolean; left: boolean; right: boolean; fire: boolean; reload: boolean }[]} */
let keysBySlot = [];

function freshKeyState() {
  return { forward: false, back: false, left: false, right: false, fire: false, reload: false };
}

function initKeysSlots() {
  keysBySlot = Array.from({ length: localPlayerCount }, () => freshKeyState());
}

function localPlayerNameForSlot(base, slotIndex) {
  const max = 24;
  if (slotIndex === 0) return base.slice(0, max);
  const suf = ` (${slotIndex + 1})`;
  return base.slice(0, Math.max(1, max - suf.length)) + suf;
}

function readLocalPlayersFromUi() {
  const raw = Number(localPlayersSelect?.value ?? 1);
  return Math.min(4, Math.max(1, Number.isFinite(raw) ? raw : 1));
}

function disconnectAll() {
  for (const { socket: s } of connectionSlots) {
    try {
      s.removeAllListeners();
      s.disconnect();
    } catch (_) {
      /* ignore */
    }
  }
  connectionSlots = [];
  socket = null;
  localIds.clear();
  couchSlavesSpawned = false;
}

function updateGameHint() {
  if (!gameHintEl) return;
  const n = localPlayerCount;
  if (n <= 1) {
    const b = bindingForSlot(0);
    const mv = `Move ${b.forward.map(formatKeyCode).join("/")}, ${b.left.map(formatKeyCode).join("/")}/${b.right.map(formatKeyCode).join("/")}, ${b.back.map(formatKeyCode).join("/")}`;
    const fi = b.fire.map(formatKeyCode).join("/");
    gameHintEl.textContent = `${mv} · Fire: ${fi}`;
    return;
  }
  const bits = [];
  for (let s = 0; s < n; s++) {
    const b = bindingForSlot(s);
    bits.push(`P${s + 1} fire: ${b.fire.map(formatKeyCode).join("/")}`);
  }
  gameHintEl.textContent = bits.join(" · ") + " · open lobby to remap movement";
}

const SHOOT_SOUND_SRC = "assets/audio/shoot.mp3";
const DEATH_SOUND_SRC = "assets/audio/death.mp3";
const MUSIC_SRC = "assets/audio/music.mp3";

const SHOOT_SOUND_POOL_SIZE = 6;
const DEATH_SOUND_POOL_SIZE = 4;

const shootSoundPool = Array.from({ length: SHOOT_SOUND_POOL_SIZE }, () => {
  const audio = new Audio(SHOOT_SOUND_SRC);
  audio.preload = "auto";
  audio.volume = 0.5;
  return audio;
});

const deathSoundPool = Array.from({ length: DEATH_SOUND_POOL_SIZE }, () => {
  const audio = new Audio(DEATH_SOUND_SRC);
  audio.preload = "auto";
  audio.volume = 0.55;
  return audio;
});

const bgMusic = new Audio(MUSIC_SRC);
bgMusic.preload = "auto";
bgMusic.loop = true;
bgMusic.volume = 0.22;

let shootSoundIndex = 0;
let deathSoundIndex = 0;
let prevMyBulletIds = new Set();
let prevDeathEventCount = 0;
let audioUnlocked = false;
let prevBulletsById = new Map();
let prevEnemiesById = new Map();
const fxParticles = [];

function pointRectDistance(px, py, r) {
  const nx = Math.max(r.x, Math.min(px, r.x + r.w));
  const ny = Math.max(r.y, Math.min(py, r.y + r.h));
  return Math.hypot(px - nx, py - ny);
}

function nearWall(x, y, walls, pad = 10) {
  if (!Array.isArray(walls)) return false;
  for (const w of walls) {
    if (pointRectDistance(x, y, w) <= pad) return true;
  }
  return false;
}

function pushParticle(p) {
  fxParticles.push(p);
  if (fxParticles.length > 360) fxParticles.splice(0, fxParticles.length - 360);
}

function spawnImpactParticles(x, y, vx, vy, weaponType) {
  const wt = weaponType || "minigun";
  const n = wt === "rocket" ? 12 : wt === "shotgun" ? 8 : wt === "sniper" ? 7 : 6;
  const base = Math.hypot(vx || 0, vy || 0) || 1;
  const ux = (vx || 0) / base;
  const uy = (vy || 0) / base;
  for (let i = 0; i < n; i++) {
    const spread = (Math.random() * 2 - 1) * Math.PI * 0.55;
    const dir = Math.atan2(uy, ux) + Math.PI + spread;
    const speed = 0.9 + Math.random() * 2.2;
    const col =
      wt === "rocket"
        ? "rgba(255,180,110,0.95)"
        : wt === "sniper"
          ? "rgba(180,225,255,0.9)"
          : "rgba(230,220,205,0.88)";
    pushParticle({
      x,
      y,
      vx: Math.cos(dir) * speed,
      vy: Math.sin(dir) * speed,
      life: 12 + Math.floor(Math.random() * 8),
      maxLife: 20,
      size: 1.2 + Math.random() * 2.2,
      color: col,
      drag: 0.9,
      gravity: 0.015,
    });
  }
}

function spawnEnemyDeathParticles(x, y) {
  const n = 22;
  for (let i = 0; i < n; i++) {
    const dir = Math.random() * Math.PI * 2;
    const speed = 0.8 + Math.random() * 2.8;
    pushParticle({
      x: x + (Math.random() * 2 - 1) * 4,
      y: y + (Math.random() * 2 - 1) * 4,
      vx: Math.cos(dir) * speed,
      vy: Math.sin(dir) * speed,
      life: 18 + Math.floor(Math.random() * 12),
      maxLife: 30,
      size: 1.4 + Math.random() * 2.6,
      color: Math.random() < 0.7 ? "rgba(255,130,120,0.9)" : "rgba(255,220,170,0.86)",
      drag: 0.92,
      gravity: 0.02,
    });
  }
}

function tickAndDrawParticles(ctx) {
  for (let i = fxParticles.length - 1; i >= 0; i--) {
    const p = fxParticles[i];
    p.life -= 1;
    if (p.life <= 0) {
      fxParticles.splice(i, 1);
      continue;
    }
    p.vx *= p.drag || 0.92;
    p.vy = p.vy * (p.drag || 0.92) + (p.gravity || 0);
    p.x += p.vx;
    p.y += p.vy;
    const a = Math.max(0, Math.min(1, p.life / (p.maxLife || 1)));
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color || "rgba(255,255,255,0.8)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size || 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawExplosionFx(ctx, ex) {
  const life = Math.max(0, Number(ex.life) || 0);
  const maxLife = Math.max(1, Number(ex.maxLife) || 1);
  const t = life / maxLife;
  const r = Number(ex.r) || 24;
  const coreR = r * (0.18 + (1 - t) * 0.65);
  const ringR = r * (0.5 + (1 - t) * 0.65);

  const g = ctx.createRadialGradient(ex.x, ex.y, 0, ex.x, ex.y, ringR);
  g.addColorStop(0, `rgba(255,235,170,${0.38 * t + 0.15})`);
  g.addColorStop(0.45, `rgba(255,132,72,${0.48 * t + 0.18})`);
  g.addColorStop(1, "rgba(120,30,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(ex.x, ex.y, ringR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(255,244,218,${0.52 * t + 0.16})`;
  ctx.beginPath();
  ctx.arc(ex.x, ex.y, coreR, 0, Math.PI * 2);
  ctx.fill();
}

function playFromPool(pool, index) {
  const audio = pool[index];
  audio.currentTime = 0;
  void audio.play().catch(() => {});
}

function playShootSound() {
  playFromPool(shootSoundPool, shootSoundIndex);
  shootSoundIndex = (shootSoundIndex + 1) % shootSoundPool.length;
}

function playDeathSound() {
  playFromPool(deathSoundPool, deathSoundIndex);
  deathSoundIndex = (deathSoundIndex + 1) % deathSoundPool.length;
}

function tryStartMusic() {
  if (!audioUnlocked || !gameActive) return;
  if (!bgMusic.paused) return;
  void bgMusic.play().catch(() => {});
}

function stopMusic() {
  bgMusic.pause();
  bgMusic.currentTime = 0;
}

function unlockAudio() {
  if (audioUnlocked) {
    tryStartMusic();
    return;
  }
  audioUnlocked = true;

  const probe = shootSoundPool[0];
  const p = probe.play();
  if (!p) {
    probe.pause();
    probe.currentTime = 0;
    tryStartMusic();
    return;
  }

  p.then(() => {
    probe.pause();
    probe.currentTime = 0;
    tryStartMusic();
  }).catch(() => {
    audioUnlocked = false;
  });
}

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

if (localPlayersSelect) {
  const savedLoc = localStorage.getItem(STORAGE_LOCAL);
  if (savedLoc) {
    const n = Number(savedLoc);
    if (n >= 1 && n <= 4) localPlayersSelect.value = String(n);
  }
  localPlayersSelect.addEventListener("change", () => {
    invalidateKeybindCache();
    renderKeybindPanel();
  });
}

btnResetKeybinds?.addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEYBINDS);
  invalidateKeybindCache();
  renderKeybindPanel();
});

renderKeybindPanel();

roomInput.addEventListener("input", () => {
  roomInput.value = normalizeRoomCode(roomInput.value);
});

function setRoomHud(code) {
  currentRoomCode = code;
  roomCodeDisplay.textContent = code;
  roomHud.classList.remove("hidden");
}

function buildSocketQuery(nameStr, mode, roomStr) {
  return { name: nameStr, mode, room: roomStr };
}

function buildInviteUrl() {
  const u = new URL(window.location.href);
  u.searchParams.set("room", currentRoomCode);
  const n = nameInput.value.trim();
  if (n) u.searchParams.set("name", n);
  u.searchParams.set("mode", selectedModeId);
  const loc = readLocalPlayersFromUi();
  if (loc > 1) u.searchParams.set("locals", String(loc));
  else u.searchParams.delete("locals");
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

function setKeyOnSlots(code, down) {
  const n = localPlayerCount;
  for (let slot = 0; slot < n; slot++) {
    const b = bindingForSlot(slot);
    if (b.forward.includes(code)) keysBySlot[slot].forward = down;
    if (b.back.includes(code)) keysBySlot[slot].back = down;
    if (b.left.includes(code)) keysBySlot[slot].left = down;
    if (b.right.includes(code)) keysBySlot[slot].right = down;
    if (b.fire.includes(code)) keysBySlot[slot].fire = down;
    if (b.reload.includes(code)) keysBySlot[slot].reload = down;
  }
}

function shouldPreventDefaultGameKey(code) {
  const codes = new Set();
  const n = localPlayerCount;
  for (let s = 0; s < n; s++) {
    const b = bindingForSlot(s);
    for (const a of BIND_ACTIONS) {
      for (const c of b[a]) codes.add(c);
    }
  }
  return codes.has(code);
}

window.addEventListener("keydown", (e) => {
  unlockAudio();
  if (!gameActive) return;
  if (shouldPreventDefaultGameKey(e.code)) e.preventDefault();
  setKeyOnSlots(e.code, true);
});

window.addEventListener("keyup", (e) => {
  if (!gameActive) return;
  if (shouldPreventDefaultGameKey(e.code)) e.preventDefault();
  setKeyOnSlots(e.code, false);
});

window.addEventListener("pointerdown", unlockAudio, { passive: true });

function emitInput() {
  if (!gameActive) return;
  for (let i = 0; i < connectionSlots.length; i++) {
    const { socket: s, slot } = connectionSlots[i];
    const ks = keysBySlot[slot];
    if (!ks || !s?.connected) continue;
    s.emit("input", { ...ks });
  }
}

setInterval(emitInput, 1000 / 30);

let gameRafId = 0;
let leaderboardTickerId = 0;

function gameFrameLoop() {
  gameRafId = 0;
  if (!gameActive) return;
  if (state) draw();
  gameRafId = requestAnimationFrame(gameFrameLoop);
}

function startGameFrameLoop() {
  if (gameRafId) return;
  gameRafId = requestAnimationFrame(gameFrameLoop);
}

function stopGameFrameLoop() {
  if (gameRafId) {
    cancelAnimationFrame(gameRafId);
    gameRafId = 0;
  }
}

function enterGame() {
  keybindCapture = null;
  screenLobby.classList.add("hidden");
  screenLobby.setAttribute("hidden", "");
  const houseBg = document.getElementById("house-bg");
  if (houseBg) houseBg.style.display = "none";
  screenGame.classList.remove("hidden");
  screenGame.removeAttribute("hidden");
  document.body.classList.add("game-active");
  gameActive = true;
  updateGameHint();
  tryStartMusic();
  startGameFrameLoop();
  if (!leaderboardTickerId) {
    leaderboardTickerId = window.setInterval(() => {
      if (gameActive && state) renderLeaderboard(state);
    }, 250);
  }
  queueMicrotask(() => state && draw());
}

function leaveGameUi() {
  keybindCapture = null;
  gameActive = false;
  stopGameFrameLoop();
  if (leaderboardTickerId) {
    clearInterval(leaderboardTickerId);
    leaderboardTickerId = 0;
  }
  stopMusic();
  document.body.classList.remove("game-active");
  roomHud.classList.add("hidden");
  currentRoomCode = null;
  disconnectAll();
  prevMyBulletIds = new Set();
  prevDeathEventCount = 0;
  prevBulletsById = new Map();
  prevEnemiesById = new Map();
  fxParticles.length = 0;
  screenGame.classList.add("hidden");
  screenGame.setAttribute("hidden", "");
  screenLobby.classList.remove("hidden");
  screenLobby.removeAttribute("hidden");
  const houseBg = document.getElementById("house-bg");
  if (houseBg) houseBg.style.display = "";
}

const resizeObserver = new ResizeObserver(() => {
  if (gameActive && state) draw();
});
resizeObserver.observe(canvasWrap);

function estimatedServerClock() {
  if (!state || !lastServerNow) return Date.now();
  return lastServerNow + (Date.now() - lastStateReceiveMs);
}

function onStateMessage(snap) {
  if (prevBulletsById.size > 0) {
    const current = new Map();
    if (Array.isArray(snap?.bullets)) {
      for (const b of snap.bullets) current.set(b.id, b);
    }
    for (const [id, oldB] of prevBulletsById.entries()) {
      if (current.has(id)) continue;
      if (nearWall(oldB.x, oldB.y, snap?.walls, (oldB.radius || 3.5) + 9)) {
        spawnImpactParticles(oldB.x, oldB.y, oldB.vx || 0, oldB.vy || 0, oldB.weaponType);
      }
    }
  }

  if (prevEnemiesById.size > 0) {
    const currentEnemies = new Map();
    for (const e of snap?.enemies || []) currentEnemies.set(e.id, e);
    for (const [id, prevE] of prevEnemiesById.entries()) {
      const cur = currentEnemies.get(id);
      if (cur) {
        if (prevE.alive && cur.alive === false) {
          spawnEnemyDeathParticles(cur.x, cur.y);
        }
      } else if (prevE.alive) {
        spawnEnemyDeathParticles(prevE.x, prevE.y);
      }
    }
  }

  const deathEvents = Number(snap?.deathEvents || 0);
  if (deathEvents > prevDeathEventCount) {
    for (let i = prevDeathEventCount; i < deathEvents; i++) {
      playDeathSound();
    }
  }
  prevDeathEventCount = deathEvents;

  if (localIds.size > 0 && Array.isArray(snap?.bullets)) {
    const myBulletIds = new Set();
    for (const bullet of snap.bullets) {
      if (localIds.has(bullet.ownerId)) myBulletIds.add(bullet.id);
    }
    for (const id of myBulletIds) {
      if (!prevMyBulletIds.has(id)) playShootSound();
    }
    prevMyBulletIds = myBulletIds;
  } else {
    prevMyBulletIds = new Set();
  }

  lastStateReceiveMs = Date.now();
  lastServerNow = Number(snap.serverNow) || lastStateReceiveMs;

  prevBulletsById = new Map();
  for (const b of snap?.bullets || []) prevBulletsById.set(b.id, b);
  prevEnemiesById = new Map();
  for (const e of snap?.enemies || []) prevEnemiesById.set(e.id, e);

  state = snap;
  renderLeaderboard(snap);
  draw();
}

function onRoomJoinedFirstTime(code, name, mode) {
  setRoomHud(code);
  localStorage.setItem(STORAGE_ROOM, code);
  const params = new URLSearchParams({ name, mode, room: code });
  if (localPlayerCount > 1) params.set("locals", String(localPlayerCount));
  history.replaceState(null, "", `${window.location.pathname}?${params}`);
  enterGame();
}

function handleRoomError(data) {
  showLobbyError(data?.message || "Could not join that room.");
  disconnectAll();
  btnPlay.disabled = false;
}

function handleConnectError(err) {
  showLobbyError(err.message || "Could not connect.");
  disconnectAll();
  if (gameActive) leaveGameUi();
  btnPlay.disabled = false;
}

function connectSingle(name, mode, roomQuery) {
  disconnectAll();
  localPlayerCount = 1;
  initKeysSlots();
  const s = io({ query: buildSocketQuery(localPlayerNameForSlot(name, 0), mode, roomQuery) });
  socket = s;
  connectionSlots = [{ socket: s, slot: 0 }];

  s.on("connect", () => {
    localIds.add(s.id);
  });
  s.on("room", ({ code }) => {
    onRoomJoinedFirstTime(code, name, mode);
  });
  s.on("room_error", handleRoomError);
  s.on("state", onStateMessage);
  s.on("connect_error", handleConnectError);
}

function connectLocalHost(name, mode) {
  disconnectAll();
  initKeysSlots();
  couchSlavesSpawned = false;

  const primary = io({ query: buildSocketQuery(localPlayerNameForSlot(name, 0), mode, "new") });
  socket = primary;
  connectionSlots = [{ socket: primary, slot: 0 }];

  primary.on("connect", () => {
    localIds.add(primary.id);
  });
  primary.on("room", ({ code }) => {
    if (couchSlavesSpawned) return;
    couchSlavesSpawned = true;
    onRoomJoinedFirstTime(code, name, mode);
    for (let i = 1; i < localPlayerCount; i++) {
      const slave = io({ query: buildSocketQuery(localPlayerNameForSlot(name, i), mode, code) });
      connectionSlots.push({ socket: slave, slot: i });
      slave.on("connect", () => localIds.add(slave.id));
      slave.on("room_error", handleRoomError);
      slave.on("connect_error", handleConnectError);
    }
  });
  primary.on("room_error", handleRoomError);
  primary.on("state", onStateMessage);
  primary.on("connect_error", handleConnectError);
}

function connectLocalJoin(name, mode, roomCode) {
  disconnectAll();
  initKeysSlots();
  let seenRoom = false;

  for (let i = 0; i < localPlayerCount; i++) {
    const s = io({ query: buildSocketQuery(localPlayerNameForSlot(name, i), mode, roomCode) });
    connectionSlots.push({ socket: s, slot: i });
    if (i === 0) socket = s;

    s.on("connect", () => {
      localIds.add(s.id);
    });
    s.on("room", ({ code }) => {
      if (!seenRoom) {
        seenRoom = true;
        onRoomJoinedFirstTime(code, name, mode);
      }
    });
    s.on("room_error", handleRoomError);
    s.on("connect_error", handleConnectError);
    if (i === 0) {
      s.on("state", onStateMessage);
    }
  }
}

function connect(name, mode, roomQuery) {
  localPlayerCount = readLocalPlayersFromUi();
  localStorage.setItem(STORAGE_LOCAL, String(localPlayerCount));

  if (localPlayerCount === 1) {
    connectSingle(name, mode, roomQuery);
    return;
  }

  if (roomQuery !== "new" && String(roomQuery).length === ROOM_CODE_LEN) {
    connectLocalJoin(name, mode, roomQuery);
  } else {
    connectLocalHost(name, mode);
  }
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
const quickLocals = params.get("locals");
if (quickLocals && localPlayersSelect) {
  const nl = Number(quickLocals);
  if (nl >= 1 && nl <= 4) localPlayersSelect.value = String(nl);
}
if (quickRoomRaw && quickRoomRaw.toLowerCase() !== "new") {
  const qr = normalizeRoomCode(quickRoomRaw);
  if (qr.length === ROOM_CODE_LEN) roomInput.value = qr;
}
const quickRoomNorm = quickRoomRaw ? normalizeRoomCode(quickRoomRaw) : "";
const roomOkForAutoplay =
  !quickRoomRaw ||
  quickRoomRaw.toLowerCase() === "new" ||
  quickRoomNorm.length === ROOM_CODE_LEN;
if (params.get("play") === "1" && quickName && quickModeDef && roomOkForAutoplay) {
  queueMicrotask(() => startFromLobby());
}

function statusForLeaderboard(snap, p, clock) {
  if (snap.mode === "arena" && !p.alive && (p.respawnAt || 0) > clock) {
    const sec = Math.max(1, Math.ceil((p.respawnAt - clock) / 1000));
    return `Respawn ${sec}s`;
  }
  if (snap.mode === "deathmatch" && !p.alive) {
    return "Eliminated";
  }
  return "";
}

function hpBarClass(ratio) {
  if (ratio > 0.45) return "hb-ok";
  if (ratio > 0.2) return "hb-mid";
  return "hb-low";
}

function weaponLabelColor(weaponType) {
  switch (weaponType) {
    case "shotgun":
      return "#f4b25f";
    case "rocket":
      return "#ff6b5f";
    case "sniper":
      return "#74c9ff";
    case "minigun":
      return "#8ee66b";
    default:
      return "#d0d7de";
  }
}

function renderLeaderboard(snap) {
  if (!leaderboardBody || !leaderboardMeta) return;

  const clock = estimatedServerClock();
  const rows = snap.players?.length ? [...snap.players] : [];
  rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || String(a.name).localeCompare(String(b.name)));

  const metaParts = [];
  if (snap.mode === "pve") {
    const w = snap.pveWave ?? 1;
    let line = `Wave ${w}`;
    const end = Number(snap.pveIntermissionEnd || 0);
    if (end > clock) {
      const sec = Math.max(1, Math.ceil((end - clock) / 1000));
      line += ` — next in ${sec}s`;
    }
    metaParts.push(escapeHtml(line));
  }
  if (snap.mode === "deathmatch" && snap.dmRound != null) {
    metaParts.push(`Round ${snap.dmRound}`);
  }
  leaderboardMeta.innerHTML = metaParts.join(" · ");

  if (!rows.length) {
    leaderboardBody.innerHTML = "";
    return;
  }

  const bodyHtml = rows
    .map((p, i) => {
      const rank = i + 1;
      const youCls = localIds.has(p.id) ? "lb-you" : "";
      const maxHp = Math.max(1, Number(p.maxHp) || 100);
      const hp = Math.max(0, Math.min(maxHp, Number(p.hp) ?? maxHp));
      const ratio = hp / maxHp;
      const pct = Math.round(ratio * 100);
      const st = statusForLeaderboard(snap, p, clock);
      const stCell = st ? `<span class="lb-st">${escapeHtml(st)}</span>` : "—";
      const weapon = p.weaponName
        ? `<span class="lb-weapon" style="color:${weaponLabelColor(p.weaponType)}">${escapeHtml(p.weaponName)}</span>`
        : "";
      return `<tr class="${youCls}">
  <td class="lb-rank">${rank}</td>
  <td class="lb-name"><span>${escapeHtml(p.name)}</span>${localIds.has(p.id) ? ' <span class="lb-you-tag">you</span>' : ""}${weapon}</td>
  <td class="lb-score">${p.score ?? 0}</td>
  <td class="lb-hp"><div class="lb-hp-bar ${hpBarClass(ratio)}" style="width:${pct}%"></div></td>
  <td class="lb-status">${stCell}</td>
</tr>`;
    })
    .join("");

  leaderboardBody.innerHTML = `<table class="lb-table">
<thead><tr><th>#</th><th>Player</th><th>Kills</th><th>HP</th><th>Status</th></tr></thead>
<tbody>${bodyHtml}</tbody></table>`;
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

/** World-space UI above player name. */
function drawPlayerHealthBar(ctx, cx, topY, hp, maxHp) {
  const maxH = Math.max(1, Number(maxHp) || 100);
  const h = Math.max(0, Math.min(maxH, Number(hp)));
  const ratio = h / maxH;
  const w = 50;
  const hBar = 5;
  const x = cx - w / 2;
  ctx.fillStyle = "rgba(0,0,0,0.52)";
  ctx.fillRect(x - 1, topY - 1, w + 2, hBar + 2);
  ctx.fillStyle = "#2a1810";
  ctx.fillRect(x, topY, w, hBar);
  const fillW = Math.max(0, w * ratio);
  if (fillW > 0.5) {
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    if (ratio > 0.45) {
      g.addColorStop(0, "#7ee787");
      g.addColorStop(1, "#2f9e4f");
    } else if (ratio > 0.2) {
      g.addColorStop(0, "#ffa657");
      g.addColorStop(1, "#c24e00");
    } else {
      g.addColorStop(0, "#ff7b72");
      g.addColorStop(1, "#a40e26");
    }
    ctx.fillStyle = g;
    ctx.fillRect(x, topY, fillW, hBar);
  }
  ctx.strokeStyle = "rgba(255,240,220,0.25)";
  ctx.lineWidth = 0.6;
  ctx.strokeRect(x + 0.25, topY + 0.25, w - 0.5, hBar - 0.5);
}

function drawAmmoStatus(ctx, cx, topY, ammo, maxAmmo, reloadUntil, now) {
  const maxA = Math.max(1, Number(maxAmmo) || 1);
  const curA = Math.max(0, Math.min(maxA, Number(ammo) || 0));
  const ru = Number(reloadUntil) || 0;
  const reloading = ru > now;
  const msg = reloading ? "Reloading" : `${curA}/${maxA}`;
  ctx.font = "600 10px Segoe UI, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.strokeText(msg, cx + 29, topY + 4.5);
  ctx.fillStyle = reloading ? "#ffd26a" : "#d3e6ff";
  ctx.fillText(msg, cx + 29, topY + 4.5);
}

function weaponOutfitTone(weaponType, fallbackHex) {
  switch (weaponType) {
    case "shotgun":
      return "#9f6b3d";
    case "rocket":
      return "#8f4742";
    case "sniper":
      return "#3c6e9e";
    case "minigun":
      return "#5a616b";
    default:
      return fallbackHex;
  }
}

function drawWeaponModel(ctx, weaponType, S) {
  const wt = weaponType || "minigun";

  if (wt === "shotgun") {
    ctx.fillStyle = "#8f5b2e";
    ctx.fillRect(9 * S, -2.6 * S, 8 * S, 3.6 * S);
    ctx.fillStyle = "#2f2f2f";
    ctx.fillRect(16 * S, -1.9 * S, 10 * S, 2.2 * S);
    ctx.fillStyle = "#d7c39b";
    ctx.fillRect(24.5 * S, -1.45 * S, 2.2 * S, 1.3 * S);
    ctx.fillStyle = "#3d2a14";
    ctx.fillRect(10 * S, -3.4 * S, 2.2 * S, 1.2 * S);
    return;
  }

  if (wt === "rocket") {
    ctx.fillStyle = "#515a66";
    ctx.fillRect(8.5 * S, -3.2 * S, 12.5 * S, 5.2 * S);
    ctx.fillStyle = "#262c33";
    ctx.fillRect(20 * S, -2.2 * S, 8.2 * S, 3.2 * S);
    ctx.fillStyle = "#ff5a49";
    ctx.beginPath();
    ctx.moveTo(28.2 * S, -2.2 * S);
    ctx.lineTo(30.6 * S, -0.6 * S);
    ctx.lineTo(28.2 * S, 1 * S);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#9aa4b4";
    ctx.fillRect(9.5 * S, -0.5 * S, 2.2 * S, 1.2 * S);
    return;
  }

  if (wt === "sniper") {
    ctx.fillStyle = "#2d557d";
    ctx.fillRect(9 * S, -2.3 * S, 18 * S, 3 * S);
    ctx.fillStyle = "#17324d";
    ctx.fillRect(15 * S, -4 * S, 7.5 * S, 1.6 * S);
    ctx.fillStyle = "#b9dcff";
    ctx.fillRect(26.8 * S, -1.65 * S, 3.2 * S, 1.7 * S);
    ctx.fillStyle = "#7ec8ff";
    ctx.fillRect(17.4 * S, -3.6 * S, 1.8 * S, 0.8 * S);
    return;
  }

  // Minigun (default)
  ctx.fillStyle = "#3f434a";
  ctx.fillRect(9.5 * S, -3.2 * S, 10 * S, 5 * S);
  ctx.fillStyle = "#9aa1ab";
  for (let i = 0; i < 4; i++) {
    ctx.fillRect((18 + i * 2.1) * S, (-2.2 + i * 0.1) * S, 3.5 * S, 0.95 * S);
    ctx.fillRect((18 + i * 2.1) * S, (-0.6 + i * 0.1) * S, 3.5 * S, 0.95 * S);
  }
}

function drawBulletSprite(ctx, b) {
  const wt = b.weaponType || "minigun";
  const r = Math.max(2, Number(b.radius) || 3.5);
  const vx = Number(b.vx) || 0;
  const vy = Number(b.vy) || 0;
  const speed = Math.hypot(vx, vy) || 1;
  const ux = vx / speed;
  const uy = vy / speed;

  const drawTrail = (len, width, alpha) => {
    if (speed < 0.01) return;
    const tx = b.x - ux * len;
    const ty = b.y - uy * len;
    const g = ctx.createLinearGradient(b.x, b.y, tx, ty);
    g.addColorStop(0, `rgba(255,255,255,${alpha})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.strokeStyle = g;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  };

  if (wt === "shotgun") {
    drawTrail(Math.max(7, r * 3.2), Math.max(1.1, r * 0.85), 0.18);
    ctx.fillStyle = "#ffd387";
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, r * 1.2, r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(146,89,33,0.8)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    return;
  }

  if (wt === "rocket") {
    drawTrail(Math.max(10, r * 5), Math.max(1.5, r * 1), 0.2);
    const ang = Math.atan2(b.vy || 0, b.vx || 1);
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(ang);
    ctx.fillStyle = "rgba(255,92,64,0.26)";
    ctx.beginPath();
    ctx.ellipse(-r * 1.8, 0, r * 1.6, r * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#7b838d";
    ctx.fillRect(-r * 1.6, -r * 0.9, r * 2.6, r * 1.8);
    ctx.fillStyle = "#ff5a49";
    ctx.beginPath();
    ctx.moveTo(r * 1.1, 0);
    ctx.lineTo(r * 2, -r * 0.65);
    ctx.lineTo(r * 2, r * 0.65);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255, 212, 120, 0.58)";
    ctx.beginPath();
    ctx.arc(-r * 1.6, 0, Math.max(1.2, r * 0.75), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (wt === "sniper") {
    drawTrail(Math.max(12, r * 5), Math.max(1.25, r * 0.95), 0.2);
    const ang = Math.atan2(vy || 0, vx || 1);
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(ang);
    const lg = ctx.createLinearGradient(-r * 2.6, 0, r * 2.6, 0);
    lg.addColorStop(0, "#7ebeff");
    lg.addColorStop(1, "#f3fcff");
    ctx.fillStyle = lg;
    ctx.fillRect(-r * 2.4, -r * 0.55, r * 4.8, r * 1.1);
    ctx.fillStyle = "rgba(220,244,255,0.82)";
    ctx.fillRect(-r * 1.6, -r * 0.22, r * 3.2, r * 0.44);
    ctx.restore();

    ctx.fillStyle = "#effbff";
    ctx.beginPath();
    ctx.arc(b.x, b.y, Math.max(1, r * 0.65), 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // Minigun default: compact grey tracer with a slight trail.
  drawTrail(Math.max(8, r * 3.8), Math.max(1, r * 0.8), 0.16);
  ctx.fillStyle = "#9ea6af";
  ctx.beginPath();
  ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e7edf5";
  ctx.beginPath();
  ctx.arc(b.x - r * 0.25, b.y - r * 0.25, Math.max(1, r * 0.45), 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Top-down person with a gun (~1.4x bigger, more detail).
 * Facing right (angle=0).
 */
function drawTankSprite(ctx, hullColor, isLocal, weaponType = "minigun") {
  const S = 1.4; // scale factor
  const outfit = weaponOutfitTone(weaponType, hullColor);

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
  ctx.fillStyle = shadeColor(outfit, -40);
  ctx.beginPath();
  ctx.ellipse(-3 * S, -5.5 * S, 4 * S, 2.8 * S, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-3 * S, 5.5 * S, 4 * S, 2.8 * S, 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Body (torso)
  ctx.fillStyle = outfit;
  ctx.beginPath();
  ctx.ellipse(0, 0, 8 * S, 7.5 * S, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = isLocal ? "#fff" : "rgba(255,255,255,0.35)";
  ctx.lineWidth = isLocal ? 2 : 1;
  ctx.stroke();

  // Shirt pocket detail
  ctx.strokeStyle = shadeColor(outfit, -18);
  ctx.lineWidth = 0.7;
  ctx.strokeRect(-1 * S, -3 * S, 3.5 * S, 3 * S);

  // Collar V-line
  ctx.strokeStyle = shadeColor(outfit, -25);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(3 * S, -2.5 * S);
  ctx.lineTo(5 * S, 0);
  ctx.lineTo(3 * S, 2.5 * S);
  ctx.stroke();

  // Arm holding gun (right arm, skin-toned hand)
  ctx.fillStyle = shadeColor(outfit, -15);
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
  ctx.fillStyle = shadeColor(outfit, -15);
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

  // Weapon model differs per weapon type.
  drawWeaponModel(ctx, weaponType, S);

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
  ctx.fillStyle = shadeColor(outfit, -55);
  ctx.beginPath();
  ctx.arc(0.5 * S, 0, 5.2 * S, Math.PI * 0.5, Math.PI * 1.5);
  ctx.fill();

  // Weapon-class shoulder stripe so silhouettes differ even at distance.
  ctx.strokeStyle = weaponOutfitTone(weaponType, "#d0d7de");
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-4.8 * S, -3.5 * S);
  ctx.lineTo(-0.6 * S, -0.4 * S);
  ctx.stroke();

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

  for (const ex of state.explosions || []) {
    drawExplosionFx(ctx, ex);
  }

  for (const b of bullets) {
    drawBulletSprite(ctx, b);
  }

  tickAndDrawParticles(ctx);

  const enemies = state.enemies ?? [];
  const ENEMY_HULL = "#b33a3a";

  for (const e of enemies) {
    if (!e.alive) continue;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);
    drawTankSprite(ctx, ENEMY_HULL, false, e.weaponType || "minigun");
    ctx.restore();

    const nameY = e.y - 20;
    const eMaxHp = e.maxHp != null ? e.maxHp : 100;
    const eCurHp = e.hp != null ? e.hp : eMaxHp;
    drawPlayerHealthBar(ctx, e.x, nameY - 13, eCurHp, eMaxHp);
    ctx.font = "600 13px Segoe UI, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.strokeText(e.name, e.x, nameY);
    ctx.fillStyle = "#f0b4b4";
    ctx.fillText(e.name, e.x, nameY);
  }

  const mode = state.mode;
  const clock = estimatedServerClock();

  for (const p of players) {
    const col = colorForId(p.id);
    const dead = p.alive === false;

    if (dead && mode === "arena") {
      const respawnAt = Number(p.respawnAt) || 0;
      if (respawnAt > clientNow) {
        const sec = Math.max(1, Math.ceil((respawnAt - clientNow) / 1000));
        ctx.font = "600 12px Segoe UI, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.65)";
        const msg = `Respawn ${sec}s`;
        ctx.strokeText(msg, p.x, p.y);
        ctx.fillStyle = "rgba(230,220,200,0.92)";
        ctx.fillText(msg, p.x, p.y);
      }
      continue;
    }

    if (dead && mode === "deathmatch") {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.globalAlpha = 0.36;
      drawTankSprite(ctx, col, localIds.has(p.id), p.weaponType || "minigun");
      ctx.restore();
      ctx.globalAlpha = 1;
      const nameY = p.y - 26;
      ctx.font = "600 12px Segoe UI, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.strokeText("Eliminated", p.x, nameY);
      ctx.fillStyle = "rgba(230,200,200,0.88)";
      ctx.fillText("Eliminated", p.x, nameY);
      continue;
    }

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    drawTankSprite(ctx, col, localIds.has(p.id), p.weaponType || "minigun");
    ctx.restore();

    const nameY = p.y - 26;
    const maxHp = p.maxHp != null ? p.maxHp : 100;
    const curHp = p.hp != null ? p.hp : maxHp;
    drawPlayerHealthBar(ctx, p.x, nameY - 13, curHp, maxHp);
    drawAmmoStatus(ctx, p.x, nameY - 13, p.ammo, p.maxAmmo, p.reloadUntil, clock);

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
