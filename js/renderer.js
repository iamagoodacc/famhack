class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    }

    resize() {
        const parent = this.canvas.parentElement;
        const hud = document.getElementById('game-hud');
        // Force layout reflow
        parent.offsetHeight;
        const w = parent.clientWidth;
        const h = parent.clientHeight - hud.offsetHeight;
        if (w > 0 && h > 0) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
    }

    clear() {
        this.ctx.fillStyle = '#0f0f23';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    drawMaze(maze, cellSize, offsetX, offsetY) {
        const ctx = this.ctx;
        ctx.strokeStyle = '#4a5568';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';

        const w = cellSize;
        const ox = offsetX;
        const oy = offsetY;

        // Draw outer border
        ctx.strokeStyle = '#718096';
        ctx.lineWidth = 4;
        ctx.strokeRect(ox, oy, maze.cols * w, maze.rows * w);

        // Draw internal walls
        ctx.strokeStyle = '#4a5568';
        ctx.lineWidth = 3;

        for (let y = 0; y < maze.rows; y++) {
            for (let x = 0; x < maze.cols; x++) {
                const cell = maze.cells[y][x];
                const cx = ox + x * w;
                const cy = oy + y * w;

                if (cell.right && x < maze.cols - 1) {
                    ctx.beginPath();
                    ctx.moveTo(cx + w, cy);
                    ctx.lineTo(cx + w, cy + w);
                    ctx.stroke();
                }
                if (cell.bottom && y < maze.rows - 1) {
                    ctx.beginPath();
                    ctx.moveTo(cx, cy + w);
                    ctx.lineTo(cx + w, cy + w);
                    ctx.stroke();
                }
            }
        }
    }

    drawTank(tank) {
        if (!tank.alive) return;

        const ctx = this.ctx;
        ctx.save();
        ctx.translate(tank.x, tank.y);
        ctx.rotate(tank.angle);

        // Tank body
        ctx.fillStyle = tank.color;
        ctx.fillRect(-tank.width / 2, -tank.height / 2, tank.width, tank.height);

        // Tank body outline
        ctx.strokeStyle = shadeColor(tank.color, -30);
        ctx.lineWidth = 2;
        ctx.strokeRect(-tank.width / 2, -tank.height / 2, tank.width, tank.height);

        // Barrel
        ctx.fillStyle = shadeColor(tank.color, -20);
        ctx.fillRect(tank.width / 2 - 4, -tank.barrelWidth / 2, tank.barrelLength, tank.barrelWidth);
        ctx.strokeStyle = shadeColor(tank.color, -40);
        ctx.lineWidth = 1;
        ctx.strokeRect(tank.width / 2 - 4, -tank.barrelWidth / 2, tank.barrelLength, tank.barrelWidth);

        // Turret circle
        ctx.fillStyle = shadeColor(tank.color, -10);
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fill();

        // Track marks
        ctx.fillStyle = shadeColor(tank.color, -40);
        ctx.fillRect(-tank.width / 2, -tank.height / 2, tank.width, 3);
        ctx.fillRect(-tank.width / 2, tank.height / 2 - 3, tank.width, 3);

        ctx.restore();
    }

    drawBullet(bullet) {
        if (!bullet.alive) return;

        const ctx = this.ctx;
        ctx.fillStyle = '#f5a623';
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
        ctx.fill();

        // Glow effect
        ctx.fillStyle = 'rgba(245, 166, 35, 0.3)';
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, bullet.radius * 2.5, 0, Math.PI * 2);
        ctx.fill();
    }

    drawExplosion(x, y, progress) {
        const ctx = this.ctx;
        const maxRadius = 30;
        const radius = maxRadius * progress;
        const alpha = 1 - progress;

        ctx.fillStyle = `rgba(233, 69, 96, ${alpha * 0.8})`;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(245, 166, 35, ${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, radius * 0.6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, radius * 0.3, 0, Math.PI * 2);
        ctx.fill();
    }
}

function shadeColor(color, percent) {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max(0, Math.min(255, (num >> 16) + amt));
    const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amt));
    const B = Math.max(0, Math.min(255, (num & 0x0000FF) + amt));
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}
