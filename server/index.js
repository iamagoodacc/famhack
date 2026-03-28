import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { GameRoom, normalizeMazeDims } from "./game.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

app.use(express.static(join(__dirname, "../public")));

/** Room code → GameRoom */
const rooms = new Map();

/** Avoid ambiguous characters in codes (0/O, 1/I/L). */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;

function normalizeRoomCode(raw) {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, "")
    .slice(0, CODE_LEN);
}

function generateRoomCode() {
  for (let g = 0; g < 200; g++) {
    let code = "";
    for (let i = 0; i < CODE_LEN; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error("Could not allocate a room code");
}

function ioRoomName(code) {
  return `game:${code}`;
}

const TICK_MS = 1000 / 60;
let lastTick = Date.now();

setInterval(() => {
  const now = Date.now();
  const dt = now - lastTick;
  lastTick = now;
  const steps = Math.min(3, Math.max(1, Math.round(dt / TICK_MS)));
  for (const [code, room] of rooms) {
    for (let i = 0; i < steps; i++) room.step(now);
    const snap = { ...room.getSnapshot(), roomCode: code };
    io.to(ioRoomName(code)).emit("state", snap);
  }
}, TICK_MS);

/** Supported handshake `mode` values — add entries when you ship new modes (match client GAME_MODES). */
const ALLOWED_MODES = new Set(["arena", "pve", "deathmatch"]);

io.on("connection", (socket) => {
  const name = socket.handshake.query?.name || "Player";
  const rawMode = String(socket.handshake.query?.mode || "arena").slice(0, 32);
  const mode = ALLOWED_MODES.has(rawMode) ? rawMode : "arena";

  const rawRoom = String(socket.handshake.query?.room ?? "new").trim().toLowerCase();
  let roomCode;

  const mazeDims = normalizeMazeDims(socket.handshake.query?.mazeCols, socket.handshake.query?.mazeRows);

  if (rawRoom === "" || rawRoom === "new" || rawRoom === "create") {
    roomCode = generateRoomCode();
    rooms.set(roomCode, new GameRoom(mode, mazeDims));
  } else {
    roomCode = normalizeRoomCode(rawRoom);
    if (!roomCode || roomCode.length !== CODE_LEN || !rooms.has(roomCode)) {
      socket.emit("room_error", { message: "No game found with that room code." });
      socket.disconnect(true);
      return;
    }
  }

  const gameRoom = rooms.get(roomCode);
  socket.join(ioRoomName(roomCode));
  gameRoom.addPlayer(socket.id, String(name).slice(0, 24));

  socket.emit("room", { code: roomCode });
  const snap = { ...gameRoom.getSnapshot(), roomCode };
  io.to(ioRoomName(roomCode)).emit("state", snap);

  socket.on("input", (payload) => {
    if (!payload || typeof payload !== "object") return;
    gameRoom.setInput(socket.id, {
      forward: !!payload.forward,
      back: !!payload.back,
      left: !!payload.left,
      right: !!payload.right,
      fire: !!payload.fire,
    });
  });

  socket.on("disconnect", () => {
    gameRoom.removePlayer(socket.id);
    if (gameRoom.players.size === 0) {
      rooms.delete(roomCode);
      return;
    }
    const next = { ...gameRoom.getSnapshot(), roomCode };
    io.to(ioRoomName(roomCode)).emit("state", next);
  });
});

const PORT = Number(process.env.PORT) || 3000;
httpServer.listen(PORT, () => {
  console.log(`Family Trouble at http://localhost:${PORT}`);
});

httpServer.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Stop the other process or set PORT to another value.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
