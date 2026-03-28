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

/** Grid replan interval for PVE enemies (ticks). */
const ENEMY_PATH_REPLAN = 12;
const ENEMY_BASE_COUNT = 2;
const ENEMY_PER_HUMAN = 1;
const ENEMY_CAP = 7;

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
  const wallRects = outerBorderWalls();
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

  wallRects.push(...cellsToWallRects(cells, cols, rows, innerX, innerY, cellW, cellH, MAZE_WALL_T));

  const cellData = [];
  for (let y = 0; y < rows; y++) {
    cellData[y] = [];
    for (let x = 0; x < cols; x++) {
      const c = cells[y][x];
      cellData[y][x] = { top: c.top, right: c.right, bottom: c.bottom, left: c.left };
    }
  }

  return {
    walls: wallRects,
    maze: {
      cols,
      rows,
      innerX,
      innerY,
      cellW,
      cellH,
      cells: cellData,
    },
  };
}

function worldToCell(maze, x, y) {
  let cx = Math.floor((x - maze.innerX) / maze.cellW);
  let cy = Math.floor((y - maze.innerY) / maze.cellH);
  cx = Math.max(0, Math.min(maze.cols - 1, cx));
  cy = Math.max(0, Math.min(maze.rows - 1, cy));
  return { cx, cy };
}

function cellKey(cx, cy) {
  return `${cx},${cy}`;
}

function astar(maze, startCx, startCy, goalCx, goalCy) {
  if (startCx === goalCx && startCy === goalCy) {
    return [{ cx: startCx, cy: startCy }];
  }
  const cells = maze.cells;
  const open = new Map();
  const closed = new Set();
  const goalK = cellKey(goalCx, goalCy);
  const startK = cellKey(startCx, startCy);
  const h = (a, b) => Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);

  open.set(startK, { f: h({ cx: startCx, cy: startCy }, { cx: goalCx, cy: goalCy }), g: 0, cx: startCx, cy: startCy, parent: null });

  while (open.size > 0) {
    let bestK = null;
    let bestF = Infinity;
    for (const [k, node] of open) {
      if (node.f < bestF) {
        bestF = node.f;
        bestK = k;
      }
    }
    const cur = open.get(bestK);
    open.delete(bestK);
    if (bestK === goalK) {
      const path = [];
      let n = cur;
      while (n) {
        path.push({ cx: n.cx, cy: n.cy });
        n = n.parent;
      }
      path.reverse();
      return path;
    }
    closed.add(bestK);

    const c = cells[cur.cy][cur.cx];
    const neigh = [];
    if (!c.top && cur.cy > 0) neigh.push({ cx: cur.cx, cy: cur.cy - 1 });
    if (!c.right && cur.cx < maze.cols - 1) neigh.push({ cx: cur.cx + 1, cy: cur.cy });
    if (!c.bottom && cur.cy < maze.rows - 1) neigh.push({ cx: cur.cx, cy: cur.cy + 1 });
    if (!c.left && cur.cx > 0) neigh.push({ cx: cur.cx - 1, cy: cur.cy });

    for (const nb of neigh) {
      const nk = cellKey(nb.cx, nb.cy);
      if (closed.has(nk)) continue;
      const g = cur.g + 1;
      const f = g + h(nb, { cx: goalCx, cy: goalCy });
      const ex = open.get(nk);
      if (!ex || g < ex.g) {
        open.set(nk, { f, g, cx: nb.cx, cy: nb.cy, parent: cur });
      }
    }
  }
  return null;
}

function wrapAngle(d) {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function isEnemyOwnerId(id) {
  return typeof id === "string" && id.startsWith("enemy-");
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
  constructor(mode = "arena") {
    this.mode = mode;
    this.players = new Map();
    this.bullets = [];
    this.nextBulletId = 1;
    this.tick = 0;
    this._rng = Math.random;
    this._nextEnemySlot = 0;
    const generated = generateMaze(this._rng);
    this.walls = generated.walls;
    this.maze = generated.maze;
    this.enemies = [];
  }

  _desiredEnemyCount() {
    return Math.min(ENEMY_CAP, ENEMY_BASE_COUNT + ENEMY_PER_HUMAN * Math.max(1, this.players.size));
  }

  _spawnEnemyUnit() {
    const slot = this._nextEnemySlot++;
    const sp = randomSpawn(this._rng, this.walls);
    this.enemies.push({
      id: `enemy-${slot}`,
      name: `Intruder ${this.enemies.length + 1}`,
      x: sp.x,
      y: sp.y,
      angle: this._rng() * Math.PI * 2,
      vx: 0,
      vy: 0,
      alive: true,
      lastFire: 0,
      _pathAge: ENEMY_PATH_REPLAN,
      _lastPath: null,
      input: { forward: false, back: false, left: false, right: false, fire: false },
    });
  }

  _syncEnemyCount() {
    if (this.mode !== "pve") return;
    const want = this._desiredEnemyCount();
    while (this.enemies.length < want) this._spawnEnemyUnit();
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
    this._syncEnemyCount();
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

  _closestLivingPlayer(ex, ey) {
    let best = null;
    let bestD = Infinity;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - ex, p.y - ey);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  _enemyBrain(e, now) {
    const input = { forward: false, back: false, left: false, right: false, fire: false };
    const target = this._closestLivingPlayer(e.x, e.y);
    if (!target) return input;

    const m = this.maze;
    const { cx, cy } = worldToCell(m, e.x, e.y);
    const { cx: tcx, cy: tcy } = worldToCell(m, target.x, target.y);

    e._pathAge++;
    if (e._pathAge >= ENEMY_PATH_REPLAN || !e._lastPath) {
      e._lastPath = astar(m, cx, cy, tcx, tcy);
      e._pathAge = 0;
    }
    const path = e._lastPath;

    let wx;
    let wy;
    if (path && path.length >= 2) {
      const next = path[1];
      wx = m.innerX + (next.cx + 0.5) * m.cellW;
      wy = m.innerY + (next.cy + 0.5) * m.cellH;
    } else {
      wx = target.x;
      wy = target.y;
    }

    const chase = Math.atan2(wy - e.y, wx - e.x);
    const turn = wrapAngle(chase - e.angle);
    const deadband = 0.085;
    if (turn < -deadband) input.left = true;
    else if (turn > deadband) input.right = true;
    else input.forward = true;

    const aim = Math.atan2(target.y - e.y, target.x - e.x);
    const aimErr = wrapAngle(aim - e.angle);
    const dist = Math.hypot(target.x - e.x, target.y - e.y);
    if (Math.abs(aimErr) < 0.24 && dist < 540) input.fire = true;

    return input;
  }

  _applyTankPhysics(ent, input) {
    if (!ent.alive) return;

    if (input.left) ent.angle -= ROT_SPEED;
    if (input.right) ent.angle += ROT_SPEED;

    let ax = 0;
    let ay = 0;
    if (input.forward) {
      ax += Math.cos(ent.angle) * MOVE_ACCEL;
      ay += Math.sin(ent.angle) * MOVE_ACCEL;
    }
    if (input.back) {
      ax -= Math.cos(ent.angle) * MOVE_ACCEL * 0.65;
      ay -= Math.sin(ent.angle) * MOVE_ACCEL * 0.65;
    }

    ent.vx = (ent.vx + ax) * FRICTION;
    ent.vy = (ent.vy + ay) * FRICTION;
    const sp = Math.hypot(ent.vx, ent.vy);
    if (sp > MAX_SPEED) {
      const s = MAX_SPEED / sp;
      ent.vx *= s;
      ent.vy *= s;
    }

    let nx = ent.x + ent.vx;
    let ny = ent.y + ent.vy;

    for (const w of this.walls) {
      const res = resolveCircleRect(nx, ny, TANK_R, w);
      if (res) {
        nx = res.cx;
        ny = res.cy;
        const dot = ent.vx * res.nx + ent.vy * res.ny;
        if (dot < 0) {
          ent.vx -= 2 * dot * res.nx;
          ent.vy -= 2 * dot * res.ny;
        }
      }
    }
    ent.x = nx;
    ent.y = ny;
  }

  _tryFire(ent, now) {
    if (!ent.alive || now - ent.lastFire < FIRE_COOLDOWN_MS) return;
    const bx = ent.x + Math.cos(ent.angle) * (TANK_R + BULLET_R + 2);
    const by = ent.y + Math.sin(ent.angle) * (TANK_R + BULLET_R + 2);
    let blocked = false;
    for (const w of this.walls) {
      if (circleRectOverlap(bx, by, BULLET_R, w)) {
        blocked = true;
        break;
      }
    }
    if (blocked) return;
    ent.lastFire = now;
    this.bullets.push({
      id: this.nextBulletId++,
      ownerId: ent.id,
      born: now,
      x: bx,
      y: by,
      vx: Math.cos(ent.angle) * BULLET_SPEED,
      vy: Math.sin(ent.angle) * BULLET_SPEED,
      bounces: 0,
    });
  }

  _respawnTankAtRandom(ent) {
    const sp = randomSpawn(this._rng, this.walls);
    ent.x = sp.x;
    ent.y = sp.y;
    ent.angle = this._rng() * Math.PI * 2;
    ent.vx = 0;
    ent.vy = 0;
    ent.alive = true;
    if ("_lastPath" in ent) {
      ent._lastPath = null;
      ent._pathAge = ENEMY_PATH_REPLAN;
    }
  }

  step(now) {
    this.tick++;

    for (const p of this.players.values()) {
      if (!p.alive) continue;
      this._applyTankPhysics(p, p.input);
      if (p.input.fire) this._tryFire(p, now);
    }

    if (this.mode === "pve") {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const brain = this._enemyBrain(e, now);
        e.input = brain;
        this._applyTankPhysics(e, brain);
        if (brain.fire) this._tryFire(e, now);
      }
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

      if (this.mode === "pve" && !isEnemyOwnerId(b.ownerId)) {
        for (const e of this.enemies) {
          if (!e.alive) continue;
          const d = Math.hypot(e.x - b.x, e.y - b.y);
          if (d < TANK_R + BULLET_R - 0.5) {
            const killer = this.players.get(b.ownerId);
            if (killer) killer.score += 1;
            dead = true;
            this._respawnTankAtRandom(e);
            break;
          }
        }
      }

      if (!dead) {
        for (const p of this.players.values()) {
          if (!p.alive) continue;
          if (p.id === b.ownerId && now - b.born < BULLET_OWNER_GRACE_MS) continue;
          const d = Math.hypot(p.x - b.x, p.y - b.y);
          if (d < TANK_R + BULLET_R - 0.5) {
            const killer = this.players.get(b.ownerId);
            if (killer && killer.id !== p.id) killer.score += 1;
            dead = true;
            this._respawnTankAtRandom(p);
            break;
          }
        }
      }

      if (!dead) nextBullets.push(b);
    }
    this.bullets = nextBullets;
  }

  getSnapshot() {
    const snap = {
      mode: this.mode,
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
    if (this.mode === "pve") {
      snap.enemies = this.enemies.map((e) => ({
        id: e.id,
        name: e.name,
        x: e.x,
        y: e.y,
        angle: e.angle,
        alive: e.alive,
      }));
    }
    return snap;
  }
}
