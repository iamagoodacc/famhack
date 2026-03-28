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
const PLAYER_MAX_HP = 100;
const PLAYER_BULLET_DAMAGE = 34;
const ENEMY_MAX_HP = 90;
/** Family Feud (arena): delay before respawn after elimination. */
const ARENA_RESPAWN_DELAY_MS = 2800;
/** Arena: first to this many kills regenerates the maze and clears scores. */
const ARENA_KILL_LIMIT = 30;
const DEFAULT_MAZE_COLS = 10;
const DEFAULT_MAZE_ROWS = 7;
const MIN_MAZE_COLS = 6;
const MAX_MAZE_COLS = 16;
const MIN_MAZE_ROWS = 5;
const MAX_MAZE_ROWS = 12;

const WEAPON_TYPES = ["shotgun", "rocket", "sniper", "minigun"];

const WEAPON_PROFILES = {
  shotgun: {
    name: "Shotgun",
    fireCooldownMs: 720,
    pelletCount: 6,
    spread: 0.28,
    bulletSpeed: 8.2,
    damage: 22,
    maxBounces: 2,
    bulletRadius: 3,
  },
  rocket: {
    name: "Rocket Launcher",
    fireCooldownMs: 930,
    pelletCount: 1,
    spread: 0,
    bulletSpeed: 5.9,
    damage: 62,
    maxBounces: 0,
    bulletRadius: 6,
    explodeOnWall: true,
    splashRadius: 52,
    splashDamage: 44,
  },
  sniper: {
    name: "Sniper Rifle",
    fireCooldownMs: 980,
    pelletCount: 1,
    spread: 0,
    bulletSpeed: 15,
    damage: 95,
    maxBounces: 1,
    bulletRadius: 2.4,
    pierce: 1,
  },
  minigun: {
    name: "Minigun",
    fireCooldownMs: 120,
    pelletCount: 1,
    spread: 0.09,
    bulletSpeed: 8.8,
    damage: 14,
    maxBounces: 5,
    bulletRadius: 3.2,
  },
};

function randomWeaponType(rng) {
  return WEAPON_TYPES[Math.floor(rng() * WEAPON_TYPES.length)];
}

/** Grid replan interval for PVE enemies (ticks). */
const ENEMY_PATH_REPLAN = 12;
const ENEMY_BASE_COUNT = 2;
const ENEMY_PER_HUMAN = 1;
const ENEMY_CAP = 10;
/** Pause (ms) after clearing a wave before the next spawn. */
const PVE_INTERMISSION_MS = 3200;

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

function resolveMazeDim(v, fallback, lo, hi) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

export function normalizeMazeDims(colsIn, rowsIn) {
  return {
    mazeCols: resolveMazeDim(colsIn, DEFAULT_MAZE_COLS, MIN_MAZE_COLS, MAX_MAZE_COLS),
    mazeRows: resolveMazeDim(rowsIn, DEFAULT_MAZE_ROWS, MIN_MAZE_ROWS, MAX_MAZE_ROWS),
  };
}

function generateMaze(rng, colsIn, rowsIn) {
  const wallRects = outerBorderWalls();
  const innerX = BORDER;
  const innerY = BORDER;
  const innerW = ARENA_W - 2 * BORDER;
  const innerH = ARENA_H - 2 * BORDER;

  const cols = resolveMazeDim(colsIn, DEFAULT_MAZE_COLS, MIN_MAZE_COLS, MAX_MAZE_COLS);
  const rows = resolveMazeDim(rowsIn, DEFAULT_MAZE_ROWS, MIN_MAZE_ROWS, MAX_MAZE_ROWS);
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
  constructor(mode = "arena", opts = {}) {
    this.mode = mode;
    this.mazeCols = opts.mazeCols ?? DEFAULT_MAZE_COLS;
    this.mazeRows = opts.mazeRows ?? DEFAULT_MAZE_ROWS;
    this.players = new Map();
    this.bullets = [];
    this.nextBulletId = 1;
    this.deathEvents = 0;
    this.tick = 0;
    this._rng = Math.random;
    this._nextEnemySlot = 0;
    this.explosions = [];
    this.arenaResetBanner = null;
    this.dmRound = 1;
    const generated = generateMaze(this._rng, this.mazeCols, this.mazeRows);
    this.walls = generated.walls;
    this.maze = generated.maze;
    this.enemies = [];
    /** PvE waves (PvE only). */
    this.pveWave = 1;
    /** When > 0, timestamp (ms) until next wave spawns. */
    this.pveIntermissionEnd = 0;
  }

  _applyMazeFromGenerated(generated) {
    this.walls = generated.walls;
    this.maze = generated.maze;
  }

  _regenerateMazeAndRepositionPlayers() {
    const gen = generateMaze(this._rng, this.mazeCols, this.mazeRows);
    this._applyMazeFromGenerated(gen);
    this.bullets = [];
    this.explosions = [];
    for (const p of this.players.values()) {
      this._respawnTankAtRandom(p);
      p.respawnAt = 0;
    }
  }

  /** Arena: someone reached kill limit — new maze, everyone score 0. */
  _arenaKillLimitReset(championId) {
    for (const p of this.players.values()) {
      p.score = 0;
    }
    this._regenerateMazeAndRepositionPlayers();
    this.arenaResetBanner = { winnerId: championId, until: Date.now() + 4500 };
  }

  /** Deathmatch: one survivor; new round, +1 round win already applied to survivor. */
  _deathmatchNextRound() {
    const gen = generateMaze(this._rng, this.mazeCols, this.mazeRows);
    this._applyMazeFromGenerated(gen);
    this.bullets = [];
    this.explosions = [];
    this.dmRound += 1;
    for (const p of this.players.values()) {
      this._respawnTankAtRandom(p);
      p.respawnAt = 0;
    }
  }

  _deathmatchTryEndRound() {
    if (this.mode !== "deathmatch") return;
    if (this.players.size < 2) return;
    const alive = [...this.players.values()].filter((p) => p.alive);
    if (alive.length !== 1) return;
    alive[0].score += 1;
    this._deathmatchNextRound();
  }

  _maybeArenaKillLimit(killer) {
    if (this.mode !== "arena" || !killer) return;
    if (killer.score >= ARENA_KILL_LIMIT) {
      this._arenaKillLimitReset(killer.id);
    }
  }

  _onPlayerHpDepleted(p, killer, now) {
    if (this.mode !== "deathmatch") {
      if (killer && killer.id !== p.id) {
        killer.score += 1;
        this._maybeArenaKillLimit(killer);
      }
    }
    this.deathEvents += 1;
    if (this.mode === "deathmatch") {
      p.alive = false;
      p.hp = 0;
      p.respawnAt = 0;
      return;
    }
    if (this.mode === "arena") {
      p.alive = false;
      p.hp = 0;
      p.respawnAt = now + ARENA_RESPAWN_DELAY_MS;
      return;
    }
    this._respawnTankAtRandom(p);
  }

  _pveEnemiesToSpawnThisWave() {
    return Math.min(
      ENEMY_CAP,
      ENEMY_BASE_COUNT + (this.pveWave - 1) + ENEMY_PER_HUMAN * this.players.size,
    );
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
      hp: ENEMY_MAX_HP,
      maxHp: ENEMY_MAX_HP,
      weaponType: "minigun",
      lastFire: 0,
      _pathAge: ENEMY_PATH_REPLAN,
      _lastPath: null,
      input: { forward: false, back: false, left: false, right: false, fire: false },
    });
  }

  /** Replace enemy list with a full wave (call when starting wave 1 or after intermission). */
  _pveSpawnWave() {
    if (this.mode !== "pve") return;
    this.enemies = [];
    const n = this._pveEnemiesToSpawnThisWave();
    for (let i = 0; i < n; i++) this._spawnEnemyUnit();
  }

  _pveMaybeSpawnInitialWave() {
    if (this.mode !== "pve") return;
    if (this.pveIntermissionEnd !== 0) return;
    if (this.enemies.length > 0) return;
    this._pveSpawnWave();
  }

  addPlayer(id, name) {
    const spawn = randomSpawn(this._rng, this.walls);
    const weaponType = randomWeaponType(this._rng);
    this.players.set(id, {
      id,
      name: name || `Tank ${this.players.size + 1}`,
      x: spawn.x,
      y: spawn.y,
      angle: this._rng() * Math.PI * 2,
      vx: 0,
      vy: 0,
      alive: true,
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      score: 0,
      weaponType,
      lastFire: 0,
      respawnAt: 0,
      input: { forward: false, back: false, left: false, right: false, fire: false },
    });
    this._pveMaybeSpawnInitialWave();
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
    if (!ent.alive) return;
    const profile = WEAPON_PROFILES[ent.weaponType] || {
      name: "Rifle",
      fireCooldownMs: FIRE_COOLDOWN_MS,
      pelletCount: 1,
      spread: 0,
      bulletSpeed: BULLET_SPEED,
      damage: PLAYER_BULLET_DAMAGE,
      maxBounces: MAX_BOUNCES,
      bulletRadius: BULLET_R,
    };
    if (now - ent.lastFire < profile.fireCooldownMs) return;
    ent.lastFire = now;

    const pelletCount = profile.pelletCount || 1;
    if (pelletCount === 1) {
      const spread = profile.spread || 0;
      const offset = spread > 0 ? (this._rng() * 2 - 1) * spread : 0;
      this._spawnBullet(ent, now, ent.angle + offset, profile);
      return;
    }

    const spread = profile.spread || 0;
    const start = -spread / 2;
    const step = pelletCount > 1 ? spread / (pelletCount - 1) : 0;
    for (let i = 0; i < pelletCount; i++) {
      const jitter = (this._rng() * 2 - 1) * step * 0.25;
      const offset = start + step * i + jitter;
      this._spawnBullet(ent, now, ent.angle + offset, profile);
    }
  }

  _spawnBullet(owner, now, angle, profile) {
    const radius = profile.bulletRadius ?? BULLET_R;
    const bx = owner.x + Math.cos(angle) * (TANK_R + radius + 2);
    const by = owner.y + Math.sin(angle) * (TANK_R + radius + 2);
    for (const w of this.walls) {
      if (circleRectOverlap(bx, by, radius, w)) {
        return;
      }
    }

    this.bullets.push({
      id: this.nextBulletId++,
      ownerId: owner.id,
      born: now,
      x: bx,
      y: by,
      vx: Math.cos(angle) * (profile.bulletSpeed ?? BULLET_SPEED),
      vy: Math.sin(angle) * (profile.bulletSpeed ?? BULLET_SPEED),
      bounces: 0,
      maxBounces: profile.maxBounces ?? MAX_BOUNCES,
      damage: profile.damage ?? PLAYER_BULLET_DAMAGE,
      radius,
      weaponType: owner.weaponType || "minigun",
      pierceLeft: profile.pierce || 0,
      explodeOnWall: !!profile.explodeOnWall,
      splashRadius: profile.splashRadius || 0,
      splashDamage: profile.splashDamage || 0,
    });
  }

  _applySplashDamage(ownerId, cx, cy, radius, damage, now) {
    if (!radius || !damage) return;
    const killer = this.players.get(ownerId);
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (this.mode === "pve" && this.players.has(ownerId)) continue;
      if (
        p.id === ownerId &&
        (this.mode === "arena" || this.mode === "pve" || this.mode === "deathmatch")
      ) {
        continue;
      }
      if (p.id === ownerId && now - (killer?.lastFire || now) < BULLET_OWNER_GRACE_MS) {
        continue;
      }
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d > radius) continue;
      p.hp -= damage;
      if (p.hp <= 0) {
        this._onPlayerHpDepleted(p, killer, now);
      }
    }
  }

  _spawnExplosion(x, y, weaponType) {
    const baseR = weaponType === "rocket" ? 56 : 30;
    this.explosions.push({
      id: `${this.tick}-${Math.floor(x)}-${Math.floor(y)}-${Math.random().toString(36).slice(2, 7)}`,
      x,
      y,
      r: baseR,
      life: 14,
      maxLife: 14,
      weaponType: weaponType || "rocket",
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
    if ("maxHp" in ent && "hp" in ent) {
      ent.hp = ent.maxHp;
    }
    if ("weaponType" in ent) {
      ent.weaponType = randomWeaponType(this._rng);
    }
    if ("_lastPath" in ent) {
      ent._lastPath = null;
      ent._pathAge = ENEMY_PATH_REPLAN;
    }
  }

  step(now) {
    this.tick++;

    if (this.arenaResetBanner && now > (this.arenaResetBanner.until || 0)) {
      this.arenaResetBanner = null;
    }

    for (const p of this.players.values()) {
      if (!p.alive && (p.respawnAt || 0) > 0 && now >= p.respawnAt) {
        this._respawnTankAtRandom(p);
        p.respawnAt = 0;
      }
    }

    if (this.explosions.length > 0) {
      this.explosions = this.explosions
        .map((e) => ({ ...e, life: e.life - 1 }))
        .filter((e) => e.life > 0);
    }

    if (this.mode === "pve" && this.pveIntermissionEnd > 0 && now >= this.pveIntermissionEnd) {
      this.pveIntermissionEnd = 0;
      this.pveWave += 1;
      this._pveSpawnWave();
    }

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
      const bulletR = b.radius ?? BULLET_R;
      let x = b.x + b.vx;
      let y = b.y + b.vy;
      let vx = b.vx;
      let vy = b.vy;
      let dead = false;

      let wallGuard = 0;
      while (wallGuard++ < 8 && !dead) {
        let hitWall = false;
        for (const w of this.walls) {
          const res = resolveCircleRect(x, y, bulletR, w);
          if (!res) continue;
          x = res.cx;
          y = res.cy;
          const dot = vx * res.nx + vy * res.ny;
          vx = vx - 2 * dot * res.nx;
          vy = vy - 2 * dot * res.ny;
          b.bounces++;
          if (b.explodeOnWall) {
            this._spawnExplosion(x, y, b.weaponType);
            this._applySplashDamage(b.ownerId, x, y, b.splashRadius, b.splashDamage, now);
            dead = true;
          } else if (b.bounces > (b.maxBounces ?? MAX_BOUNCES)) {
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

      const ownerIsHuman = this.players.has(b.ownerId);
      if (this.mode === "pve" && ownerIsHuman) {
        for (const e of this.enemies) {
          if (!e.alive) continue;
          const d = Math.hypot(e.x - b.x, e.y - b.y);
          if (d < TANK_R + bulletR - 0.5) {
            const killer = this.players.get(b.ownerId);
            e.hp -= b.damage ?? PLAYER_BULLET_DAMAGE;
            if (e.hp <= 0) {
              if (killer) killer.score += 1;
              e.alive = false;
            }
            if (b.explodeOnWall) {
              this._spawnExplosion(b.x, b.y, b.weaponType);
              this._applySplashDamage(b.ownerId, b.x, b.y, b.splashRadius, b.splashDamage, now);
              dead = true;
            } else if ((b.pierceLeft || 0) > 0) {
              b.pierceLeft -= 1;
            } else {
              dead = true;
            }
            break;
          }
        }
      }

      if (!dead) {
        if (this.mode === "pve" && ownerIsHuman) {
          /* Human-owned shots never damage players (no FF, no ricochet self-hit). */
        } else {
          for (const p of this.players.values()) {
            if (!p.alive) continue;
            if (p.id === b.ownerId) {
              if (this.mode === "pve" || this.mode === "arena" || this.mode === "deathmatch") continue;
              if (now - b.born < BULLET_OWNER_GRACE_MS) continue;
            }
            const d = Math.hypot(p.x - b.x, p.y - b.y);
            if (d < TANK_R + bulletR - 0.5) {
              const killer = this.players.get(b.ownerId);
              p.hp -= b.damage ?? PLAYER_BULLET_DAMAGE;
              if (b.explodeOnWall) {
                this._spawnExplosion(b.x, b.y, b.weaponType);
                this._applySplashDamage(b.ownerId, b.x, b.y, b.splashRadius, b.splashDamage, now);
              }
              if (p.hp <= 0) {
                this._onPlayerHpDepleted(p, killer, now);
              }
              if ((b.pierceLeft || 0) > 0) {
                b.pierceLeft -= 1;
              } else {
                dead = true;
              }
              break;
            }
          }
        }
      }

      if (!dead) nextBullets.push(b);
    }
    this.bullets = nextBullets;

    if (this.mode === "pve" && this.pveIntermissionEnd === 0 && this.enemies.length > 0) {
      if (!this.enemies.some((e) => e.alive)) {
        this.pveIntermissionEnd = now + PVE_INTERMISSION_MS;
        this.bullets = [];
      }
    }

    this._deathmatchTryEndRound();
  }

  getSnapshot() {
    const now = Date.now();
    const snap = {
      mode: this.mode,
      serverNow: now,
      mazeCols: this.mazeCols,
      mazeRows: this.mazeRows,
      arena: { w: ARENA_W, h: ARENA_H },
      walls: this.walls,
      players: Array.from(this.players.values()).map((p) => {
        const prof = WEAPON_PROFILES[p.weaponType] || WEAPON_PROFILES.minigun;
        return {
          id: p.id,
          name: p.name,
          x: p.x,
          y: p.y,
          angle: p.angle,
          alive: p.alive,
          hp: p.hp,
          maxHp: p.maxHp,
          score: p.score,
          weaponType: p.weaponType || "minigun",
          weaponName: prof.name,
          weaponCooldownMs: prof.fireCooldownMs,
          lastFiredAt: p.lastFire,
          respawnAt: p.respawnAt || 0,
        };
      }),
      bullets: this.bullets.map((b) => ({
        id: b.id,
        x: b.x,
        y: b.y,
        vx: b.vx,
        vy: b.vy,
        ownerId: b.ownerId,
        weaponType: b.weaponType || "minigun",
        radius: b.radius ?? BULLET_R,
      })),
      explosions: this.explosions.map((e) => ({
        id: e.id,
        x: e.x,
        y: e.y,
        r: e.r,
        life: e.life,
        maxLife: e.maxLife,
        weaponType: e.weaponType,
      })),
      deathEvents: this.deathEvents,
      tick: this.tick,
      arenaResetBanner: this.arenaResetBanner,
      arenaKillLimit: ARENA_KILL_LIMIT,
      arenaRespawnDelayMs: ARENA_RESPAWN_DELAY_MS,
    };
    if (this.mode === "deathmatch") {
      snap.dmRound = this.dmRound;
    }
    if (this.mode === "pve") {
      snap.pveWave = this.pveWave;
      snap.pveIntermissionEnd = this.pveIntermissionEnd;
      snap.enemies = this.enemies.map((e) => ({
        id: e.id,
        name: e.name,
        x: e.x,
        y: e.y,
        angle: e.angle,
        alive: e.alive,
        hp: e.hp,
        maxHp: e.maxHp,
      }));
    }
    return snap;
  }
}
