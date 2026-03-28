class AIController {
    constructor(tank, difficulty, cellSize, offsetX, offsetY) {
        this.tank = tank;
        this.difficulty = difficulty || 1; // 1-5 scale
        this.cellSize = cellSize;
        this.offsetX = offsetX;
        this.offsetY = offsetY;

        this.thinkTimer = 0;
        this.thinkInterval = 0.4 - (difficulty * 0.04); // rethink frequency
        this.pathRecalcTimer = 0;
        this.pathRecalcInterval = 0.6; // recalculate path less often than think

        this.targetTank = null;
        this.path = []; // list of cell centers to follow
        this.currentWaypoint = 0;
        this.hasLineOfSight = false;

        this.stuckTimer = 0;
        this.lastX = 0;
        this.lastY = 0;
        this.reverseTimer = 0;
        this.shootDelay = 0;

        // Dodge state
        this.dodgeTimer = 0;
        this.dodgeAngle = 0;
    }

    // Convert pixel position to maze cell coordinates
    pixelToCell(px, py) {
        return {
            x: Math.floor((px - this.offsetX) / this.cellSize),
            y: Math.floor((py - this.offsetY) / this.cellSize)
        };
    }

    // Convert maze cell to pixel center
    cellToPixel(cx, cy) {
        return {
            x: this.offsetX + cx * this.cellSize + this.cellSize / 2,
            y: this.offsetY + cy * this.cellSize + this.cellSize / 2
        };
    }

    // BFS pathfinding through the maze
    findPath(maze, fromX, fromY, toX, toY) {
        // Clamp to valid cells
        fromX = Math.max(0, Math.min(maze.cols - 1, fromX));
        fromY = Math.max(0, Math.min(maze.rows - 1, fromY));
        toX = Math.max(0, Math.min(maze.cols - 1, toX));
        toY = Math.max(0, Math.min(maze.rows - 1, toY));

        if (fromX === toX && fromY === toY) return [];

        const visited = [];
        for (let y = 0; y < maze.rows; y++) {
            visited[y] = new Array(maze.cols).fill(false);
        }

        const queue = [{ x: fromX, y: fromY, path: [] }];
        visited[fromY][fromX] = true;

        while (queue.length > 0) {
            const current = queue.shift();

            // Check all 4 directions, only if no wall blocks
            const cell = maze.cells[current.y][current.x];
            const neighbors = [];

            if (!cell.top && current.y > 0)
                neighbors.push({ x: current.x, y: current.y - 1 });
            if (!cell.bottom && current.y < maze.rows - 1)
                neighbors.push({ x: current.x, y: current.y + 1 });
            if (!cell.left && current.x > 0)
                neighbors.push({ x: current.x - 1, y: current.y });
            if (!cell.right && current.x < maze.cols - 1)
                neighbors.push({ x: current.x + 1, y: current.y });

            for (const n of neighbors) {
                if (visited[n.y][n.x]) continue;
                visited[n.y][n.x] = true;

                const newPath = [...current.path, { x: n.x, y: n.y }];
                if (n.x === toX && n.y === toY) {
                    return newPath;
                }
                queue.push({ x: n.x, y: n.y, path: newPath });
            }
        }

        return []; // no path found (shouldn't happen in a perfect maze)
    }

    // Raycast line-of-sight check against wall segments
    hasLOS(fromX, fromY, toX, toY, walls) {
        for (const wall of walls) {
            if (segmentsIntersect(fromX, fromY, toX, toY, wall.x1, wall.y1, wall.x2, wall.y2)) {
                return false;
            }
        }
        return true;
    }

    update(dt, allTanks, walls, maze) {
        if (!this.tank.alive) return;

        this.thinkTimer += dt;
        this.pathRecalcTimer += dt;

        // Detect if stuck
        const movedDist = Math.sqrt(
            (this.tank.x - this.lastX) ** 2 +
            (this.tank.y - this.lastY) ** 2
        );
        if (movedDist < 1) {
            this.stuckTimer += dt;
        } else {
            this.stuckTimer = 0;
        }
        this.lastX = this.tank.x;
        this.lastY = this.tank.y;

        // Handle reverse when stuck
        if (this.reverseTimer > 0) {
            this.reverseTimer -= dt;
            this.tank.input.forward = false;
            this.tank.input.backward = true;
            this.tank.input.left = this.reverseDir;
            this.tank.input.right = !this.reverseDir;
            this.tank.input.shoot = false;
            return;
        }

        if (this.stuckTimer > 0.4) {
            this.reverseTimer = 0.4 + Math.random() * 0.3;
            this.stuckTimer = 0;
            this.reverseDir = Math.random() > 0.5;
            return;
        }

        // Handle dodge
        if (this.dodgeTimer > 0) {
            this.dodgeTimer -= dt;
            this.steerToward(this.dodgeAngle, dt);
            this.tank.input.forward = true;
            this.tank.input.shoot = false;
            return;
        }

        // Think: pick target and check LOS
        if (this.thinkTimer >= this.thinkInterval) {
            this.thinkTimer = 0;
            this.pickTarget(allTanks);
            this.checkDodge(allTanks);
        }

        // Recalculate path less frequently
        if (this.pathRecalcTimer >= this.pathRecalcInterval && this.targetTank && this.targetTank.alive) {
            this.pathRecalcTimer = 0;
            this.recalcPath(maze);
        }

        // Check line of sight to target
        this.hasLineOfSight = false;
        if (this.targetTank && this.targetTank.alive) {
            this.hasLineOfSight = this.hasLOS(
                this.tank.x, this.tank.y,
                this.targetTank.x, this.targetTank.y,
                walls
            );
        }

        // Reset inputs
        this.tank.input.left = false;
        this.tank.input.right = false;
        this.tank.input.forward = false;
        this.tank.input.backward = false;
        this.tank.input.shoot = false;

        if (this.hasLineOfSight && this.targetTank) {
            // We can see the player: aim and shoot
            const dx = this.targetTank.x - this.tank.x;
            const dy = this.targetTank.y - this.tank.y;
            const aimAngle = Math.atan2(dy, dx);
            const dist = Math.sqrt(dx * dx + dy * dy);

            this.steerToward(aimAngle, dt);

            // Move toward if far, stop if close enough to aim
            if (dist > this.cellSize * 1.5) {
                this.tank.input.forward = true;
            }

            // Shoot if aimed well enough
            if (this.shootDelay > 0) {
                this.shootDelay -= dt;
            }
            const aimDiff = Math.abs(normalizeAngle(aimAngle - this.tank.angle));
            const aimThreshold = 0.3 - (this.difficulty * 0.03);
            if (aimDiff < aimThreshold && this.shootDelay <= 0) {
                this.tank.input.shoot = true;
                this.shootDelay = 0.4 - (this.difficulty * 0.04);
            }
        } else {
            // No line of sight: follow path to player
            this.followPath(dt);
        }
    }

    pickTarget(allTanks) {
        let nearestDist = Infinity;
        let nearestTank = null;

        for (const t of allTanks) {
            if (t === this.tank || !t.alive) continue;
            if (t.isAI) continue; // AI only targets players
            const dx = t.x - this.tank.x;
            const dy = t.y - this.tank.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearestTank = t;
            }
        }

        if (nearestTank !== this.targetTank) {
            this.targetTank = nearestTank;
            this.path = [];
            this.currentWaypoint = 0;
        }
    }

    recalcPath(maze) {
        if (!this.targetTank || !this.targetTank.alive) {
            this.path = [];
            return;
        }

        const from = this.pixelToCell(this.tank.x, this.tank.y);
        const to = this.pixelToCell(this.targetTank.x, this.targetTank.y);
        this.path = this.findPath(maze, from.x, from.y, to.x, to.y);
        this.currentWaypoint = 0;
    }

    followPath(dt) {
        if (this.path.length === 0 || this.currentWaypoint >= this.path.length) {
            // No path, move forward and hope for the best
            this.tank.input.forward = true;
            return;
        }

        const wp = this.path[this.currentWaypoint];
        const target = this.cellToPixel(wp.x, wp.y);
        const dx = target.x - this.tank.x;
        const dy = target.y - this.tank.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // If close enough to waypoint, advance
        if (dist < this.cellSize * 0.35) {
            this.currentWaypoint++;
            if (this.currentWaypoint >= this.path.length) {
                // Reached end of path
                this.tank.input.forward = false;
                return;
            }
            // Recurse to steer toward next waypoint immediately
            this.followPath(dt);
            return;
        }

        const targetAngle = Math.atan2(dy, dx);
        this.steerToward(targetAngle, dt);
        this.tank.input.forward = true;
    }

    steerToward(targetAngle, dt) {
        const angleDiff = normalizeAngle(targetAngle - this.tank.angle);

        this.tank.input.left = false;
        this.tank.input.right = false;

        if (Math.abs(angleDiff) > 0.1) {
            if (angleDiff > 0) this.tank.input.right = true;
            else this.tank.input.left = true;
        }
    }

    checkDodge(allTanks) {
        // Check for incoming bullets and dodge
        for (const t of allTanks) {
            for (const b of t.bullets) {
                if (!b.alive || b.ownerId === this.tank.id) continue;
                const dx = this.tank.x - b.x;
                const dy = this.tank.y - b.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 80 + this.difficulty * 15) {
                    // Check if bullet is heading toward us
                    const bulletAngle = Math.atan2(b.vy, b.vx);
                    const angleToTank = Math.atan2(dy, dx);
                    const angleDiff = Math.abs(normalizeAngle(bulletAngle - angleToTank));

                    // Bullet is heading roughly toward us (within ~60 degrees)
                    if (angleDiff > Math.PI * 0.65) {
                        this.dodgeAngle = bulletAngle + (Math.PI / 2) * (Math.random() > 0.5 ? 1 : -1);
                        this.dodgeTimer = 0.3 + Math.random() * 0.2;
                        return;
                    }
                }
            }
        }
    }
}

function normalizeAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
}
