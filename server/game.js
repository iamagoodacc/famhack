/**
 * Server-authoritative Tank Trouble–style arena: walls, tanks, bouncing bullets.
 * Maze: recursive backtracker (same core as prototyping/js/maze.js) with
 * shuffled neighbors for even branching, then a small number of extra passages
 * for loops. Inner walls use MAZE_WALL_T (thinner than BORDER) so corridors
 * read clearly — the prototype draws ~3px strokes; thick 16px fills on small
 * cells looked like solid blocks.
 */

export const ARENA_W = 900;
export const ARENA_H = 640;

const BORDER = 16;
/** Inner maze wall thickness — matches large grid cells so passages stay wide. */
const MAZE_WALL_T = 12;
const WALL_T = 16;
const TANK_R = 20;
const BULLET_R = 4;
const BULLET_SPEED = 9;
const MOVE_ACCEL = 0.35;
const MAX_SPEED = 4.2;
const FRICTION = 0.92;
const ROT_SPEED = 0.055;
const FIRE_COOLDOWN_MS = 450;
const MAX_BOUNCES = 12;
const BULLET_OWNER_GRACE_MS = 180;

/** Outer bounds only (always present). */
function outerBorderWalls() {
  return [
    { x: 0, y: 0, w: ARENA_W, h: BORDER },
    { x: 0, y: ARENA_H - BORDER, w: ARENA_W, h: BORDER },
    { x: 0, y: 0, w: BORDER, h: ARENA_H },
    { x: ARENA_W - BORDER, y: 0, w: BORDER, h: ARENA_H },
  ];
}

function createCellGrid(cols, rows) {
  const cells = [];
  for (let y = 0; y < rows; y++) {
    cells[y] = [];
    for (let x = 0; x < cols; x++) {
      cells[y][x] = {
        top: true,
        right: true,
        bottom: true,
        left: true,
        visited: false,
      };
    }
  }
  return cells;
}

function getUnvisitedNeighbors(cells, cols, rows, x, y) {
  const neighbors = [];
  if (y > 0 && !cells[y - 1][x].visited) neighbors.push({ x, y: y - 1 });
  if (x < cols - 1 && !cells[y][x + 1].visited) neighbors.push({ x: x + 1, y });
  if (y < rows - 1 && !cells[y + 1][x].visited) neighbors.push({ x, y: y + 1 });
  if (x > 0 && !cells[y][x - 1].visited) neighbors.push({ x: x - 1, y });
  return neighbors;
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function removeWallBetweenCells(cells, x1, y1, x2, y2) {
  if (x2 === x1 + 1) {
    cells[y1][x1].right = false;
    cells[y2][x2].left = false;
  } else if (x2 === x1 - 1) {
    cells[y1][x1].left = false;
    cells[y2][x2].right = false;
  } else if (y2 === y1 + 1) {
    cells[y1][x1].bottom = false;
    cells[y2][x2].top = false;
  } else if (y2 === y1 - 1) {
    cells[y1][x1].top = false;
    cells[y2][x2].bottom = false;
  }
}

function countInternalWalls(cells, cols, rows) {
  let count = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (x < cols - 1 && cells[y][x].right) count++;
      if (y < rows - 1 && cells[y][x].bottom) count++;
    }
  }
  return count;
}

/** A few extra passages (loops) without tearing the maze apart. */
function carveSparseLoops(cells, cols, rows, rng) {
  const total = countInternalWalls(cells, cols, rows);
  const target = Math.min(18, Math.floor(total * (0.055 + rng() * 0.035)));
  let removed = 0;
  let attempts = 0;
  while (removed < target && attempts < target * 10) {
    attempts++;
    const x = Math.floor(rng() * cols);
    const y = Math.floor(rng() * rows);
    if (rng() > 0.5) {
      if (x < cols - 1 && cells[y][x].right) {
        removeWallBetweenCells(cells, x, y, x + 1, y);
        removed++;
      }
    } else if (y < rows - 1 && cells[y][x].bottom) {
      removeWallBetweenCells(cells, x, y, x, y + 1);
      removed++;
    }
  }
}

function mazeBacktracker(cells, cols, rows, rng) {
  const stack = [];
  const startX = Math.floor(rng() * cols);
  const startY = Math.floor(rng() * rows);
  cells[startY][startX].visited = true;
  stack.push({ x: startX, y: startY });

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const neighbors = getUnvisitedNeighbors(cells, cols, rows, current.x, current.y);
    if (neighbors.length === 0) {
      stack.pop();
    } else {
      shuffleInPlace(neighbors, rng);
      const next = neighbors[0];
      removeWallBetweenCells(cells, current.x, current.y, next.x, next.y);
      cells[next.y][next.x].visited = true;
      stack.push(next);
    }
  }
}

function cellsToWallRects(cells, cols, rows, innerX, innerY, cellW, cellH, wallT) {
  const walls = [];
  const half = wallT / 2;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (x < cols - 1 && cells[y][x].right) {
        walls.push({
          x: innerX + (x + 1) * cellW - half,
          y: innerY + y * cellH,
          w: wallT,
          h: cellH,
        });
      }
      if (y < rows - 1 && cells[y][x].bottom) {
        walls.push({
          x: innerX + x * cellW,
          y: innerY + (y + 1) * cellH - half,
          w: cellW,
          h: wallT,
        });
      }
    }
  }
  return walls;
}

function generateMaze(rng) {
  const walls = outerBorderWalls();
  const innerX = BORDER;
  const innerY = BORDER;
  const innerW = ARENA_W - 2 * BORDER;
  const innerH = ARENA_H - 2 * BORDER;

  /* Fewer, larger cells → wide corridors (inner ~868×608 → ~87×87px cells). */
  const cols = 10;
  const rows = 7;
  const cellW = innerW / cols;
  const cellH = innerH / rows;

  const cells = createCellGrid(cols, rows);
  mazeBacktracker(cells, cols, rows, rng);
  carveSparseLoops(cells, cols, rows, rng);

  walls.push(...cellsToWallRects(cells, cols, rows, innerX, innerY, cellW, cellH, MAZE_WALL_T));
  return walls;
}

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

function randomSpawn(rng, walls) {
  for (let attempt = 0; attempt < 55; attempt++) {
    const x = 80 + rng() * (ARENA_W - 160);
    const y = 80 + rng() * (ARENA_H - 160);
    let ok = true;
    for (const w of walls) {
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
    this.walls = generateMaze(this._rng);
  }

  addPlayer(id, name) {
    const spawn = randomSpawn(this._rng, this.walls);
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
    for (const w of this.walls) {
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

      for (const w of this.walls) {
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
        for (const w of this.walls) {
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
          const sp = randomSpawn(this._rng, this.walls);
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
      walls: this.walls,
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
