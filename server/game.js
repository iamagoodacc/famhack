/**
 * Server-authoritative Tank Trouble–style arena: walls, tanks, bouncing bullets.
 */

const ARENA_W = 900;
const ARENA_H = 640;
const TANK_R = 14;
const BULLET_R = 4;
const BULLET_SPEED = 9;
const MOVE_ACCEL = 0.35;
const MAX_SPEED = 4.2;
const FRICTION = 0.92;
const ROT_SPEED = 0.055;
const FIRE_COOLDOWN_MS = 450;
const MAX_BOUNCES = 12;
const BULLET_OWNER_GRACE_MS = 180;

/** Axis-aligned walls (world coords). */
export const WALLS = [
  { x: 0, y: 0, w: ARENA_W, h: 16 },
  { x: 0, y: ARENA_H - 16, w: ARENA_W, h: 16 },
  { x: 0, y: 0, w: 16, h: ARENA_H },
  { x: ARENA_W - 16, y: 0, w: 16, h: ARENA_H },
  { x: 180, y: 120, w: 16, h: 400 },
  { x: ARENA_W - 196, y: 120, w: 16, h: 400 },
  { x: 320, y: 80, w: 260, h: 16 },
  { x: 320, y: ARENA_H - 96, w: 260, h: 16 },
  { x: 420, y: 200, w: 16, h: 240 },
];

function circleRectOverlap(cx, cy, r, rect) {
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

/** Push circle out of rect; return collision normal (unit) or null. */
function resolveCircleRect(cx, cy, r, rect) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  let dx = cx - closestX;
  let dy = cy - closestY;
  const distSq = dx * dx + dy * dy;
  if (distSq >= r * r) return null;

  if (distSq < 1e-6) {
    const cxRect = rect.x + rect.w / 2;
    const cyRect = rect.y + rect.h / 2;
    dx = cx - cxRect;
    dy = cy - cyRect;
    const len = Math.hypot(dx, dy) || 1;
    return { nx: dx / len, ny: dy / len, cx, cy };
  }

  const dist = Math.sqrt(distSq);
  const nx = dx / dist;
  const ny = dy / dist;
  const push = r - dist;
  return {
    nx,
    ny,
    cx: cx + nx * push,
    cy: cy + ny * push,
  };
}

function randomSpawn(rng) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const x = 80 + rng() * (ARENA_W - 160);
    const y = 80 + rng() * (ARENA_H - 160);
    let ok = true;
    for (const w of WALLS) {
      if (circleRectOverlap(x, y, TANK_R + 4, w)) {
        ok = false;
        break;
      }
    }
    if (ok) return { x, y };
  }
  return { x: ARENA_W / 2, y: ARENA_H / 2 };
}

export class GameRoom {
  constructor() {
    this.players = new Map();
    this.bullets = [];
    this.nextBulletId = 1;
    this.tick = 0;
    this._rng = Math.random;
  }

  addPlayer(id, name) {
    const spawn = randomSpawn(this._rng);
    this.players.set(id, {
      id,
      name: name || `Tank ${this.players.size + 1}`,
      x: spawn.x,
      y: spawn.y,
      angle: this._rng() * Math.PI * 2,
      vx: 0,
      vy: 0,
      alive: true,
      score: 0,
      lastFire: 0,
      input: { forward: false, back: false, left: false, right: false, fire: false },
    });
  }

  removePlayer(id) {
    this.players.delete(id);
    this.bullets = this.bullets.filter((b) => b.ownerId !== id);
  }

  setInput(id, input) {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    p.input = {
      forward: !!input.forward,
      back: !!input.back,
      left: !!input.left,
      right: !!input.right,
      fire: !!input.fire,
    };
  }

  _tryFire(p, now) {
    if (!p.alive || now - p.lastFire < FIRE_COOLDOWN_MS) return;
    const bx = p.x + Math.cos(p.angle) * (TANK_R + BULLET_R + 2);
    const by = p.y + Math.sin(p.angle) * (TANK_R + BULLET_R + 2);
    let blocked = false;
    for (const w of WALLS) {
      if (circleRectOverlap(bx, by, BULLET_R, w)) {
        blocked = true;
        break;
      }
    }
    if (blocked) return;
    p.lastFire = now;
    this.bullets.push({
      id: this.nextBulletId++,
      ownerId: p.id,
      born: now,
      x: bx,
      y: by,
      vx: Math.cos(p.angle) * BULLET_SPEED,
      vy: Math.sin(p.angle) * BULLET_SPEED,
      bounces: 0,
    });
  }

  step(now) {
    this.tick++;

    for (const p of this.players.values()) {
      if (!p.alive) continue;

      if (p.input.left) p.angle -= ROT_SPEED;
      if (p.input.right) p.angle += ROT_SPEED;

      let ax = 0;
      let ay = 0;
      if (p.input.forward) {
        ax += Math.cos(p.angle) * MOVE_ACCEL;
        ay += Math.sin(p.angle) * MOVE_ACCEL;
      }
      if (p.input.back) {
        ax -= Math.cos(p.angle) * MOVE_ACCEL * 0.65;
        ay -= Math.sin(p.angle) * MOVE_ACCEL * 0.65;
      }

      p.vx = (p.vx + ax) * FRICTION;
      p.vy = (p.vy + ay) * FRICTION;
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > MAX_SPEED) {
        const s = MAX_SPEED / sp;
        p.vx *= s;
        p.vy *= s;
      }

      let nx = p.x + p.vx;
      let ny = p.y + p.vy;

      for (const w of WALLS) {
        const res = resolveCircleRect(nx, ny, TANK_R, w);
        if (res) {
          nx = res.cx;
          ny = res.cy;
          const dot = p.vx * res.nx + p.vy * res.ny;
          if (dot < 0) {
            p.vx -= 2 * dot * res.nx;
            p.vy -= 2 * dot * res.ny;
          }
        }
      }
      p.x = nx;
      p.y = ny;

      if (p.input.fire) this._tryFire(p, now);
    }

    const nextBullets = [];
    for (const b of this.bullets) {
      let x = b.x + b.vx;
      let y = b.y + b.vy;
      let vx = b.vx;
      let vy = b.vy;
      let dead = false;

      let wallGuard = 0;
      while (wallGuard++ < 8 && !dead) {
        let hitWall = false;
        for (const w of WALLS) {
          const res = resolveCircleRect(x, y, BULLET_R, w);
          if (!res) continue;
          x = res.cx;
          y = res.cy;
          const dot = vx * res.nx + vy * res.ny;
          vx = vx - 2 * dot * res.nx;
          vy = vy - 2 * dot * res.ny;
          b.bounces++;
          if (b.bounces > MAX_BOUNCES) {
            dead = true;
          }
          hitWall = true;
          break;
        }
        if (!hitWall) break;
      }

      if (dead) continue;

      b.x = x;
      b.y = y;
      b.vx = vx;
      b.vy = vy;

      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (p.id === b.ownerId && now - b.born < BULLET_OWNER_GRACE_MS) continue;
        const d = Math.hypot(p.x - b.x, p.y - b.y);
        if (d < TANK_R + BULLET_R - 0.5) {
          p.alive = false;
          const killer = this.players.get(b.ownerId);
          if (killer && killer.id !== p.id) killer.score += 1;
          dead = true;
          const sp = randomSpawn(this._rng);
          p.x = sp.x;
          p.y = sp.y;
          p.angle = this._rng() * Math.PI * 2;
          p.vx = 0;
          p.vy = 0;
          p.alive = true;
          break;
        }
      }

      if (!dead) nextBullets.push(b);
    }
    this.bullets = nextBullets;
  }

  getSnapshot() {
    return {
      arena: { w: ARENA_W, h: ARENA_H },
      walls: WALLS,
      players: Array.from(this.players.values()).map((p) => ({
        id: p.id,
        name: p.name,
        x: p.x,
        y: p.y,
        angle: p.angle,
        alive: p.alive,
        score: p.score,
      })),
      bullets: this.bullets.map((b) => ({
        id: b.id,
        x: b.x,
        y: b.y,
        ownerId: b.ownerId,
      })),
      tick: this.tick,
    };
  }
}
