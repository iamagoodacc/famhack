// Maze generation using Recursive Backtracker + wall removal for open spaces
class Maze {
    constructor(cols, rows) {
        this.cols = cols;
        this.rows = rows;
        this.cells = [];
        this.generate();
    }

    generate() {
        // Initialize all cells with all walls
        this.cells = [];
        for (let y = 0; y < this.rows; y++) {
            this.cells[y] = [];
            for (let x = 0; x < this.cols; x++) {
                this.cells[y][x] = {
                    top: true,
                    right: true,
                    bottom: true,
                    left: true,
                    visited: false
                };
            }
        }

        // Recursive backtracker to create a perfect maze
        const stack = [];
        const startX = Math.floor(Math.random() * this.cols);
        const startY = Math.floor(Math.random() * this.rows);
        this.cells[startY][startX].visited = true;
        stack.push({ x: startX, y: startY });

        while (stack.length > 0) {
            const current = stack[stack.length - 1];
            const neighbors = this.getUnvisitedNeighbors(current.x, current.y);

            if (neighbors.length === 0) {
                stack.pop();
            } else {
                const next = neighbors[Math.floor(Math.random() * neighbors.length)];
                this.removeWall(current.x, current.y, next.x, next.y);
                this.cells[next.y][next.x].visited = true;
                stack.push(next);
            }
        }

        // Post-process: remove extra walls to reduce dead ends and add open spaces
        this.removeDeadEnds();
        this.createOpenAreas();
        this.removeRandomWalls();
    }

    // Remove dead ends by opening a random wall
    removeDeadEnds() {
        let changed = true;
        let passes = 0;
        // Multiple passes to catch cascading dead ends
        while (changed && passes < 3) {
            changed = false;
            passes++;
            for (let y = 0; y < this.rows; y++) {
                for (let x = 0; x < this.cols; x++) {
                    const openings = this.countOpenings(x, y);
                    if (openings <= 1) {
                        // Dead end - open a random closed wall
                        if (this.openRandomWall(x, y)) {
                            changed = true;
                        }
                    }
                }
            }
        }
    }

    // Create a few open areas by removing walls in small regions
    createOpenAreas() {
        const numAreas = Math.floor(Math.random() * 2) + 1 + Math.floor((this.cols * this.rows) / 30);

        for (let i = 0; i < numAreas; i++) {
            // Pick a random interior cell
            const cx = 1 + Math.floor(Math.random() * (this.cols - 2));
            const cy = 1 + Math.floor(Math.random() * (this.rows - 2));

            // Remove walls in a 2x2 area
            this.removeWallBetween(cx, cy, cx + 1, cy);
            this.removeWallBetween(cx, cy, cx, cy + 1);
            this.removeWallBetween(cx + 1, cy, cx + 1, cy + 1);
            this.removeWallBetween(cx, cy + 1, cx + 1, cy + 1);
        }
    }

    // Remove random walls to create more connectivity (loops)
    removeRandomWalls() {
        const totalInternalWalls = this.countInternalWalls();
        // Remove about 25-35% of remaining internal walls
        const toRemove = Math.floor(totalInternalWalls * (0.25 + Math.random() * 0.10));

        let removed = 0;
        let attempts = 0;

        while (removed < toRemove && attempts < toRemove * 5) {
            attempts++;
            const x = Math.floor(Math.random() * this.cols);
            const y = Math.floor(Math.random() * this.rows);

            // Try to remove right or bottom wall
            if (Math.random() > 0.5) {
                if (x < this.cols - 1 && this.cells[y][x].right) {
                    this.removeWall(x, y, x + 1, y);
                    removed++;
                }
            } else {
                if (y < this.rows - 1 && this.cells[y][x].bottom) {
                    this.removeWall(x, y, x, y + 1);
                    removed++;
                }
            }
        }
    }

    countInternalWalls() {
        let count = 0;
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                if (x < this.cols - 1 && this.cells[y][x].right) count++;
                if (y < this.rows - 1 && this.cells[y][x].bottom) count++;
            }
        }
        return count;
    }

    countOpenings(x, y) {
        let openings = 0;
        const cell = this.cells[y][x];
        if (!cell.top) openings++;
        if (!cell.right) openings++;
        if (!cell.bottom) openings++;
        if (!cell.left) openings++;
        return openings;
    }

    openRandomWall(x, y) {
        const options = [];
        const cell = this.cells[y][x];
        if (cell.top && y > 0) options.push({ nx: x, ny: y - 1 });
        if (cell.right && x < this.cols - 1) options.push({ nx: x + 1, ny: y });
        if (cell.bottom && y < this.rows - 1) options.push({ nx: x, ny: y + 1 });
        if (cell.left && x > 0) options.push({ nx: x - 1, ny: y });

        if (options.length === 0) return false;

        const chosen = options[Math.floor(Math.random() * options.length)];
        this.removeWall(x, y, chosen.nx, chosen.ny);
        return true;
    }

    removeWallBetween(x1, y1, x2, y2) {
        if (x1 < 0 || x1 >= this.cols || y1 < 0 || y1 >= this.rows) return;
        if (x2 < 0 || x2 >= this.cols || y2 < 0 || y2 >= this.rows) return;
        this.removeWall(x1, y1, x2, y2);
    }

    getUnvisitedNeighbors(x, y) {
        const neighbors = [];
        if (y > 0 && !this.cells[y - 1][x].visited) neighbors.push({ x, y: y - 1 });
        if (x < this.cols - 1 && !this.cells[y][x + 1].visited) neighbors.push({ x: x + 1, y });
        if (y < this.rows - 1 && !this.cells[y + 1][x].visited) neighbors.push({ x, y: y + 1 });
        if (x > 0 && !this.cells[y][x - 1].visited) neighbors.push({ x: x - 1, y });
        return neighbors;
    }

    removeWall(x1, y1, x2, y2) {
        if (x2 === x1 + 1) { // right
            this.cells[y1][x1].right = false;
            this.cells[y2][x2].left = false;
        } else if (x2 === x1 - 1) { // left
            this.cells[y1][x1].left = false;
            this.cells[y2][x2].right = false;
        } else if (y2 === y1 + 1) { // down
            this.cells[y1][x1].bottom = false;
            this.cells[y2][x2].top = false;
        } else if (y2 === y1 - 1) { // up
            this.cells[y1][x1].top = false;
            this.cells[y2][x2].bottom = false;
        }
    }

    // Get wall segments for collision detection
    getWallSegments(cellSize, offsetX, offsetY) {
        const segments = [];
        const w = cellSize;
        const ox = offsetX;
        const oy = offsetY;

        // Outer boundary
        segments.push({ x1: ox, y1: oy, x2: ox + this.cols * w, y2: oy });
        segments.push({ x1: ox + this.cols * w, y1: oy, x2: ox + this.cols * w, y2: oy + this.rows * w });
        segments.push({ x1: ox, y1: oy + this.rows * w, x2: ox + this.cols * w, y2: oy + this.rows * w });
        segments.push({ x1: ox, y1: oy, x2: ox, y2: oy + this.rows * w });

        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                const cell = this.cells[y][x];
                const cx = ox + x * w;
                const cy = oy + y * w;

                if (cell.right && x < this.cols - 1) {
                    segments.push({ x1: cx + w, y1: cy, x2: cx + w, y2: cy + w });
                }
                if (cell.bottom && y < this.rows - 1) {
                    segments.push({ x1: cx, y1: cy + w, x2: cx + w, y2: cy + w });
                }
            }
        }

        return segments;
    }

    // Get spawn positions (cell centers in corners)
    getSpawnPositions(count, cellSize, offsetX, offsetY) {
        const positions = [];
        const corners = [
            { cx: 0, cy: 0 },
            { cx: this.cols - 1, cy: 0 },
            { cx: 0, cy: this.rows - 1 },
            { cx: this.cols - 1, cy: this.rows - 1 }
        ];

        for (let i = 0; i < count && i < 4; i++) {
            const c = corners[i];
            positions.push({
                x: offsetX + c.cx * cellSize + cellSize / 2,
                y: offsetY + c.cy * cellSize + cellSize / 2,
                angle: Math.atan2(this.rows / 2 - c.cy, this.cols / 2 - c.cx)
            });
        }
        return positions;
    }

    // Get random open position for AI spawning
    getRandomSpawnPosition(cellSize, offsetX, offsetY, avoidPositions, minDist) {
        let attempts = 0;
        while (attempts < 100) {
            const cx = Math.floor(Math.random() * this.cols);
            const cy = Math.floor(Math.random() * this.rows);
            const px = offsetX + cx * cellSize + cellSize / 2;
            const py = offsetY + cy * cellSize + cellSize / 2;

            let tooClose = false;
            for (const pos of avoidPositions) {
                const dx = px - pos.x;
                const dy = py - pos.y;
                if (Math.sqrt(dx * dx + dy * dy) < minDist) {
                    tooClose = true;
                    break;
                }
            }
            if (!tooClose) {
                return { x: px, y: py, angle: Math.random() * Math.PI * 2 };
            }
            attempts++;
        }
        const cx = Math.floor(Math.random() * this.cols);
        const cy = Math.floor(Math.random() * this.rows);
        return {
            x: offsetX + cx * cellSize + cellSize / 2,
            y: offsetY + cy * cellSize + cellSize / 2,
            angle: Math.random() * Math.PI * 2
        };
    }
}
