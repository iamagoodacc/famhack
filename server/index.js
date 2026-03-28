import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { GameRoom } from "./game.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

app.use(express.static(join(__dirname, "../public")));

const room = new GameRoom();
const TICK_MS = 1000 / 60;
let lastTick = Date.now();

setInterval(() => {
  const now = Date.now();
  const dt = now - lastTick;
  lastTick = now;
  const steps = Math.min(3, Math.max(1, Math.round(dt / TICK_MS)));
  for (let i = 0; i < steps; i++) room.step(now);
  io.emit("state", room.getSnapshot());
}, TICK_MS);

io.on("connection", (socket) => {
  const name = socket.handshake.query?.name || "Player";
  room.addPlayer(socket.id, String(name).slice(0, 24));
  io.emit("state", room.getSnapshot());

  socket.on("input", (payload) => {
    if (!payload || typeof payload !== "object") return;
    room.setInput(socket.id, {
      forward: !!payload.forward,
      back: !!payload.back,
      left: !!payload.left,
      right: !!payload.right,
      fire: !!payload.fire,
    });
  });

  socket.on("disconnect", () => {
    room.removePlayer(socket.id);
    io.emit("state", room.getSnapshot());
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Tank arena at http://localhost:${PORT}`);
});
