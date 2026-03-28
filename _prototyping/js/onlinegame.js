// Online game - extends Game for networked play
// Host runs the full simulation and broadcasts state.
// Clients render received state and send input.

class OnlineGame extends Game {
    constructor(canvas, controlsManager, network) {
        super(canvas, controlsManager);
        this.network = network;
        this.isHost = network.isHost;
        this.localSlot = network.playerSlot;
        this.remoteInputs = {}; // slot -> input state from remote players
        this.stateUpdateRate = 1 / 30; // 30 updates per second
        this.stateTimer = 0;

        // Client-only state
        this.remoteState = null;
    }

    start(mode, playerCount, mazeSize, seed) {
        // Use seeded maze
        this.mode = mode;
        this.playerCount = playerCount;
        this.mazeSize = mazeSize;
        this.running = true;
        this.paused = false;
        this.mazeSeed = seed;

        this.scores = [];
        for (let i = 0; i < playerCount; i++) {
            this.scores.push(0);
        }

        this.wave = 0;
        this.setupRound(seed);

        this.lastTime = performance.now();
        requestAnimationFrame(this.boundLoop);
    }

    setupRound(seed) {
        const size = MAZE_SIZES[this.mazeSize];

        // Seed the random for consistent maze across peers
        if (seed !== undefined) {
            const origRandom = Math.random;
            let s = seed;
            Math.random = function() {
                s = (s * 16807 + 0) % 2147483647;
                return (s - 1) / 2147483646;
            };
            this.maze = new Maze(size.cols, size.rows);
            Math.random = origRandom;
        } else {
            this.maze = new Maze(size.cols, size.rows);
        }

        this.renderer.resize();

        const maxW = this.canvas.width - 40;
        const maxH = this.canvas.height - 40;
        this.cellSize = Math.floor(Math.min(maxW / size.cols, maxH / size.rows));
        this.cellSize = Math.max(this.cellSize, 40);

        this.offsetX = Math.floor((this.canvas.width - size.cols * this.cellSize) / 2);
        this.offsetY = Math.floor((this.canvas.height - size.rows * this.cellSize) / 2);

        this.walls = this.maze.getWallSegments(this.cellSize, this.offsetX, this.offsetY);

        const spawns = this.maze.getSpawnPositions(this.playerCount, this.cellSize, this.offsetX, this.offsetY);
        this.tanks = [];
        this.playerTanks = [];
        this.aiTanks = [];
        this.aiControllers = [];
        this.explosions = [];

        // Use player names from network
        for (let i = 0; i < this.playerCount; i++) {
            const s = spawns[i];
            const tank = new Tank(s.x, s.y, s.angle, PLAYER_COLORS[i], `player${i}`);
            this.tanks.push(tank);
            this.playerTanks.push(tank);
        }
    }

    update(dt) {
        if (this.isHost) {
            this.updateAsHost(dt);
        } else {
            this.updateAsClient(dt);
        }
    }

    updateAsHost(dt) {
        // Apply local player input (host is player 0 by default, but use localSlot)
        this.controls.applyInputToTank(0, this.playerTanks[this.localSlot]);

        // Apply remote player inputs
        for (const [slotStr, input] of Object.entries(this.remoteInputs)) {
            const slot = parseInt(slotStr);
            if (slot >= 0 && slot < this.playerTanks.length && slot !== this.localSlot) {
                const tank = this.playerTanks[slot];
                tank.input.forward = input.forward || false;
                tank.input.backward = input.backward || false;
                tank.input.left = input.left || false;
                tank.input.right = input.right || false;
                if (input.shoot) tank.input.shoot = true;
            }
        }

        // Run normal game update
        for (const tank of this.tanks) {
            tank.update(dt, this.walls);
            if (tank.input.shoot) {
                tank.tryShoot();
                tank.input.shoot = false;
            }
        }

        for (const tank of this.tanks) {
            for (const bullet of tank.bullets) {
                bullet.update(dt, this.walls);
            }
        }

        // Bullet-tank collisions
        for (const shooter of this.tanks) {
            for (const bullet of shooter.bullets) {
                if (!bullet.alive) continue;
                for (const target of this.tanks) {
                    if (!target.alive) continue;
                    if (bullet.hitsTarget(target)) {
                        bullet.alive = false;
                        target.die();
                        this.explosions.push({ x: target.x, y: target.y, time: 0, duration: 0.5 });
                        if (target !== shooter) {
                            const shooterIdx = this.playerTanks.indexOf(shooter);
                            if (shooterIdx >= 0) this.scores[shooterIdx]++;
                        }
                    }
                }
            }
            shooter.bullets = shooter.bullets.filter(b => b.alive);
        }

        for (const exp of this.explosions) exp.time += dt;
        this.explosions = this.explosions.filter(e => e.time < e.duration);

        // Check end conditions
        const alive = this.playerTanks.filter(t => t.alive);
        if (alive.length <= 1) {
            this.running = false;
            const winner = alive.length === 1 ? alive[0] : null;
            const winnerIdx = winner ? this.playerTanks.indexOf(winner) : -1;
            if (winner) this.scores[winnerIdx]++;

            const names = this.network.players.map(p => p.name);
            const detail = winner ? `${names[winnerIdx]} wins!` : 'Draw!';

            setTimeout(() => {
                this.network.broadcastRoundOver(detail, this.scores, this.playerCount, names);
            }, 500);
        }

        // Broadcast state periodically
        this.stateTimer += dt;
        if (this.stateTimer >= this.stateUpdateRate) {
            this.stateTimer = 0;
            this.broadcastGameState();
        }

        this.updateHUD();
    }

    updateAsClient(dt) {
        // Send local input to host
        const binding = this.controls.bindings[0]; // client always uses P1 controls
        const input = {
            forward: this.controls.keysDown.has(binding.forward),
            backward: this.controls.keysDown.has(binding.backward),
            left: this.controls.keysDown.has(binding.left),
            right: this.controls.keysDown.has(binding.right),
            shoot: this.controls.keysDown.has(binding.shoot)
        };
        this.network.sendInput(input);

        // Apply received state
        if (this.remoteState) {
            this.applyRemoteState(this.remoteState);
            this.remoteState = null;
        }

        // Update explosions locally for smoothness
        for (const exp of this.explosions) exp.time += dt;
        this.explosions = this.explosions.filter(e => e.time < e.duration);

        this.updateHUD();
    }

    broadcastGameState() {
        const state = {
            tanks: this.tanks.map(t => ({
                x: t.x, y: t.y, angle: t.angle, alive: t.alive, color: t.color, id: t.id
            })),
            bullets: [],
            explosions: this.explosions.map(e => ({ x: e.x, y: e.y, time: e.time, duration: e.duration })),
            scores: this.scores
        };
        for (const tank of this.tanks) {
            for (const b of tank.bullets) {
                if (b.alive) {
                    state.bullets.push({ x: b.x, y: b.y, alive: true, ownerId: b.ownerId });
                }
            }
        }
        this.network.broadcastState(state);
    }

    applyRemoteState(state) {
        // Update tank positions
        for (const td of state.tanks) {
            const tank = this.tanks.find(t => t.id === td.id);
            if (tank) {
                tank.x = td.x;
                tank.y = td.y;
                tank.angle = td.angle;
                if (!td.alive && tank.alive) {
                    tank.die();
                    this.explosions.push({ x: td.x, y: td.y, time: 0, duration: 0.5 });
                }
                tank.alive = td.alive;
            }
        }

        // Update bullets (simple: just replace visual positions)
        // Clear existing bullets for rendering
        for (const tank of this.tanks) {
            tank.bullets = [];
        }
        for (const bd of state.bullets) {
            const tank = this.tanks.find(t => t.id === bd.ownerId);
            if (tank) {
                const b = new Bullet(bd.x, bd.y, 0, bd.ownerId);
                b.alive = true;
                tank.bullets.push(b);
            }
        }

        // Sync scores
        this.scores = state.scores;
    }

    updateHUD() {
        const left = document.getElementById('hud-left');
        const center = document.getElementById('hud-center');

        const names = this.network.players.map(p => p.name);
        let hudHtml = '';
        for (let i = 0; i < this.playerCount; i++) {
            const alive = this.playerTanks[i] && this.playerTanks[i].alive;
            const opacity = alive ? '1' : '0.4';
            const name = names[i] || `P${i + 1}`;
            hudHtml += `<div class="hud-player" style="opacity:${opacity}">
                <div class="hud-player-color" style="background:${PLAYER_COLORS[i]}"></div>
                <span>${name}: ${this.scores[i]}</span>
            </div>`;
        }
        left.innerHTML = hudHtml;
        center.textContent = 'Online';
    }
}
