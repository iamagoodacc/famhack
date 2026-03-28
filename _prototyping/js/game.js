const MAZE_SIZES = {
    small:  { cols: 6,  rows: 5 },
    medium: { cols: 9,  rows: 7 },
    large:  { cols: 13, rows: 10 }
};

class Game {
    constructor(canvas, controlsManager) {
        this.canvas = canvas;
        this.renderer = new Renderer(canvas);
        this.controls = controlsManager;

        this.mode = 'pvp'; // pvp or pve
        this.playerCount = 2;
        this.mazeSize = 'medium';
        this.running = false;
        this.paused = false;

        this.maze = null;
        this.walls = [];
        this.cellSize = 60;
        this.offsetX = 0;
        this.offsetY = 0;

        this.tanks = [];
        this.playerTanks = [];
        this.aiTanks = [];
        this.aiControllers = [];

        this.explosions = [];

        // PvP state
        this.scores = [];

        // PvE state
        this.wave = 0;
        this.waveEnemies = 0;
        this.enemiesAlive = 0;
        this.waveDelay = 0;
        this.waveStarting = false;

        this.lastTime = 0;
        this.boundLoop = this.loop.bind(this);
    }

    start(mode, playerCount, mazeSize) {
        this.mode = mode;
        this.playerCount = playerCount;
        this.mazeSize = mazeSize;
        this.running = true;
        this.paused = false;

        this.scores = [];
        for (let i = 0; i < playerCount; i++) {
            this.scores.push(0);
        }

        this.wave = 0;
        this.setupRound();

        this.lastTime = performance.now();
        requestAnimationFrame(this.boundLoop);
    }

    setupRound() {
        const size = MAZE_SIZES[this.mazeSize];
        this.maze = new Maze(size.cols, size.rows);
        this.renderer.resize();

        // Calculate cell size to fit canvas
        const maxW = this.canvas.width - 40;
        const maxH = this.canvas.height - 40;
        this.cellSize = Math.floor(Math.min(maxW / size.cols, maxH / size.rows));
        this.cellSize = Math.max(this.cellSize, 40); // minimum cell size

        this.offsetX = Math.floor((this.canvas.width - size.cols * this.cellSize) / 2);
        this.offsetY = Math.floor((this.canvas.height - size.rows * this.cellSize) / 2);

        this.walls = this.maze.getWallSegments(this.cellSize, this.offsetX, this.offsetY);

        // Create player tanks
        const spawns = this.maze.getSpawnPositions(this.playerCount, this.cellSize, this.offsetX, this.offsetY);
        this.tanks = [];
        this.playerTanks = [];
        this.aiTanks = [];
        this.aiControllers = [];
        this.explosions = [];

        for (let i = 0; i < this.playerCount; i++) {
            const s = spawns[i];
            const tank = new Tank(s.x, s.y, s.angle, PLAYER_COLORS[i], `player${i}`);
            this.tanks.push(tank);
            this.playerTanks.push(tank);
        }

        if (this.mode === 'pve') {
            this.wave++;
            this.spawnWave();
        }
    }

    spawnWave() {
        this.waveEnemies = Math.min(this.wave + 1, 8);
        const difficulty = Math.min(Math.floor(this.wave / 2) + 1, 5);

        // Clear old AI
        this.aiTanks = [];
        this.aiControllers = [];

        const existingPositions = this.playerTanks.map(t => ({ x: t.x, y: t.y }));

        for (let i = 0; i < this.waveEnemies; i++) {
            const spawn = this.maze.getRandomSpawnPosition(
                this.cellSize, this.offsetX, this.offsetY,
                existingPositions, this.cellSize * 2
            );
            const tank = new Tank(spawn.x, spawn.y, spawn.angle, AI_COLOR, `ai${i}`);
            tank.isAI = true;
            this.aiTanks.push(tank);
            this.tanks.push(tank);
            existingPositions.push({ x: spawn.x, y: spawn.y });

            const ai = new AIController(tank, difficulty, this.cellSize, this.offsetX, this.offsetY);
            this.aiControllers.push(ai);
        }

        this.enemiesAlive = this.waveEnemies;
        this.updateHUD();
    }

    stop() {
        this.running = false;
    }

    pause() {
        this.paused = true;
    }

    resume() {
        if (this.paused) {
            this.paused = false;
            this.lastTime = performance.now();
            requestAnimationFrame(this.boundLoop);
        }
    }

    loop(now) {
        if (!this.running || this.paused) return;

        const dt = Math.min((now - this.lastTime) / 1000, 0.05); // cap at 50ms
        this.lastTime = now;

        this.update(dt);
        this.render();

        requestAnimationFrame(this.boundLoop);
    }

    update(dt) {
        // Apply player inputs
        for (let i = 0; i < this.playerTanks.length; i++) {
            this.controls.applyInputToTank(i, this.playerTanks[i]);
        }

        // Update AI
        for (const ai of this.aiControllers) {
            ai.update(dt, this.tanks, this.walls, this.maze);
        }

        // Update all tanks
        for (const tank of this.tanks) {
            tank.update(dt, this.walls);

            // Handle shooting
            if (tank.input.shoot) {
                tank.tryShoot();
                tank.input.shoot = false;
            }
        }

        // Update bullets
        for (const tank of this.tanks) {
            for (const bullet of tank.bullets) {
                bullet.update(dt, this.walls);
            }
        }

        // Check bullet-tank collisions
        for (const shooter of this.tanks) {
            for (const bullet of shooter.bullets) {
                if (!bullet.alive) continue;
                for (const target of this.tanks) {
                    if (!target.alive) continue;
                    if (bullet.hitsTarget(target)) {
                        bullet.alive = false;
                        target.die();
                        this.explosions.push({ x: target.x, y: target.y, time: 0, duration: 0.5 });

                        // Score tracking
                        if (this.mode === 'pvp' && target !== shooter) {
                            const shooterIdx = this.playerTanks.indexOf(shooter);
                            if (shooterIdx >= 0) {
                                this.scores[shooterIdx]++;
                            }
                        }

                        if (this.mode === 'pve' && target.isAI) {
                            this.enemiesAlive--;
                        }
                    }
                }
            }
            // Clean up dead bullets
            shooter.bullets = shooter.bullets.filter(b => b.alive);
        }

        // Update explosions
        for (const exp of this.explosions) {
            exp.time += dt;
        }
        this.explosions = this.explosions.filter(e => e.time < e.duration);

        // Check round/game end conditions
        this.checkEndConditions();

        this.updateHUD();
    }

    checkEndConditions() {
        if (this.mode === 'pvp') {
            const alive = this.playerTanks.filter(t => t.alive);
            if (alive.length <= 1) {
                // Round over
                this.running = false;
                let winner = alive.length === 1 ? alive[0] : null;
                const winnerIdx = winner ? this.playerTanks.indexOf(winner) : -1;

                if (winner) {
                    this.scores[winnerIdx]++;
                }

                setTimeout(() => {
                    const detail = winner
                        ? `${getPlayerNames(this.controls)[winnerIdx]} wins!`
                        : 'Draw!';
                    showRoundOver(detail, this.scores, this.playerCount, getPlayerNames(this.controls));
                }, 500);
            }
        } else if (this.mode === 'pve') {
            const playersAlive = this.playerTanks.filter(t => t.alive);

            if (playersAlive.length === 0) {
                // Game over
                this.running = false;
                setTimeout(() => {
                    showGameOver(`Survived to wave ${this.wave}!`);
                }, 500);
                return;
            }

            if (this.enemiesAlive <= 0) {
                // Wave cleared - start next wave
                if (!this.waveStarting) {
                    this.waveStarting = true;
                    this.waveDelay = 2;
                }
            }

            if (this.waveStarting) {
                this.waveDelay -= 1 / 60;
                if (this.waveDelay <= 0) {
                    this.waveStarting = false;
                    // Remove dead AI tanks from array
                    this.tanks = this.tanks.filter(t => !t.isAI);
                    this.wave++;
                    this.spawnWave();
                }
            }
        }
    }

    nextRound() {
        this.running = true;
        this.setupRound();
        this.lastTime = performance.now();
        requestAnimationFrame(this.boundLoop);
    }

    retry() {
        this.wave = 0;
        this.scores = [];
        for (let i = 0; i < this.playerCount; i++) {
            this.scores.push(0);
        }
        this.running = true;
        this.setupRound();
        this.lastTime = performance.now();
        requestAnimationFrame(this.boundLoop);
    }

    updateHUD() {
        const left = document.getElementById('hud-left');
        const center = document.getElementById('hud-center');

        const names = getPlayerNames(this.controls);
        let hudHtml = '';
        for (let i = 0; i < this.playerCount; i++) {
            const alive = this.playerTanks[i] && this.playerTanks[i].alive;
            const opacity = alive ? '1' : '0.4';
            hudHtml += `<div class="hud-player" style="opacity:${opacity}">
                <div class="hud-player-color" style="background:${PLAYER_COLORS[i]}"></div>
                <span>${names[i]}: ${this.scores[i]}</span>
            </div>`;
        }
        left.innerHTML = hudHtml;

        if (this.mode === 'pve') {
            center.textContent = `Wave ${this.wave} - Enemies: ${this.enemiesAlive}`;
        } else {
            center.textContent = '';
        }
    }

    render() {
        this.renderer.clear();
        this.renderer.drawMaze(this.maze, this.cellSize, this.offsetX, this.offsetY);

        // Draw tanks
        for (const tank of this.tanks) {
            this.renderer.drawTank(tank);
        }

        // Draw bullets
        for (const tank of this.tanks) {
            for (const bullet of tank.bullets) {
                this.renderer.drawBullet(bullet);
            }
        }

        // Draw explosions
        for (const exp of this.explosions) {
            this.renderer.drawExplosion(exp.x, exp.y, exp.time / exp.duration);
        }
    }
}

// These functions are called from the game to show UI overlays
function showRoundOver(detail, scores, playerCount, names) {
    const overlay = document.getElementById('round-over-overlay');
    const detailEl = document.getElementById('round-over-detail');
    let scoreText = detail + '\n\nScores: ';
    for (let i = 0; i < playerCount; i++) {
        scoreText += `${names[i]}: ${scores[i]}  `;
    }
    detailEl.textContent = scoreText;
    overlay.classList.add('active');
}

function showGameOver(detail) {
    const overlay = document.getElementById('game-over-overlay');
    document.getElementById('game-over-detail').textContent = detail;
    overlay.classList.add('active');
}
