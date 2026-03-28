const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const scoresEl = document.getElementById("scores");

const params = new URLSearchParams(window.location.search);
const name = params.get("name") || `Player${Math.floor(Math.random() * 900 + 100)}`;

const socket = io({ query: { name } });

let state = null;
let myId = null;

socket.on("connect", () => {
  myId = socket.id;
});

socket.on("state", (snap) => {
  state = snap;
  renderScores(snap);
  draw();
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
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
    e.preventDefault();
  }
  setKey(e.code, true);
});

window.addEventListener("keyup", (e) => {
  setKey(e.code, false);
});

function emitInput() {
  socket.emit("input", { ...keys });
}

setInterval(emitInput, 1000 / 30);

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

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
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
