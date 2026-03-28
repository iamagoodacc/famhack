class Tank {
    constructor(x, y, angle, color, id) {
        this.x = x;
        this.y = y;
        this.angle = angle;
        this.color = color;
        this.id = id;

        this.width = 26;
        this.height = 20;
        this.speed = 120; // pixels per second
        this.turnSpeed = 3.0; // radians per second
        this.alive = true;
        this.score = 0;

        // Input state
        this.input = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            shoot: false
        };

        this.bullets = [];
        this.maxBullets = 5;
        this.shootCooldown = 0;
        this.shootCooldownTime = 0.3; // seconds between shots

        // Barrel properties
        this.barrelLength = 16;
        this.barrelWidth = 6;
    }

    update(dt, walls) {
        if (!this.alive) return;

        // Rotation
        if (this.input.left) this.angle -= this.turnSpeed * dt;
        if (this.input.right) this.angle += this.turnSpeed * dt;

        // Movement
        let dx = 0, dy = 0;
        if (this.input.forward) {
            dx = Math.cos(this.angle) * this.speed * dt;
            dy = Math.sin(this.angle) * this.speed * dt;
        }
        if (this.input.backward) {
            dx = -Math.cos(this.angle) * this.speed * dt * 0.6;
            dy = -Math.sin(this.angle) * this.speed * dt * 0.6;
        }

        // Try to move, check collisions
        if (dx !== 0 || dy !== 0) {
            const newX = this.x + dx;
            const newY = this.y + dy;

            // Check collision with walls using tank corners
            if (!this.collidesWithWalls(newX, newY, this.angle, walls)) {
                this.x = newX;
                this.y = newY;
            } else if (!this.collidesWithWalls(newX, this.y, this.angle, walls)) {
                this.x = newX;
            } else if (!this.collidesWithWalls(this.x, newY, this.angle, walls)) {
                this.y = newY;
            }
        }

        // Shoot cooldown
        if (this.shootCooldown > 0) this.shootCooldown -= dt;
    }

    tryShoot() {
        if (!this.alive) return null;
        if (this.shootCooldown > 0) return null;

        // Count active bullets
        const activeBullets = this.bullets.filter(b => b.alive).length;
        if (activeBullets >= this.maxBullets) return null;

        this.shootCooldown = this.shootCooldownTime;

        const barrelTipX = this.x + Math.cos(this.angle) * (this.width / 2 + this.barrelLength * 0.5);
        const barrelTipY = this.y + Math.sin(this.angle) * (this.width / 2 + this.barrelLength * 0.5);

        const bullet = new Bullet(
            barrelTipX,
            barrelTipY,
            this.angle,
            this.id
        );
        this.bullets.push(bullet);
        return bullet;
    }

    getCorners(x, y, angle) {
        x = x !== undefined ? x : this.x;
        y = y !== undefined ? y : this.y;
        angle = angle !== undefined ? angle : this.angle;

        const hw = this.width / 2;
        const hh = this.height / 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        return [
            { x: x + cos * hw - sin * hh, y: y + sin * hw + cos * hh },
            { x: x + cos * hw + sin * hh, y: y + sin * hw - cos * hh },
            { x: x - cos * hw + sin * hh, y: y - sin * hw - cos * hh },
            { x: x - cos * hw - sin * hh, y: y - sin * hw + cos * hh }
        ];
    }

    collidesWithWalls(x, y, angle, walls) {
        const corners = this.getCorners(x, y, angle);
        const edges = [
            [corners[0], corners[1]],
            [corners[1], corners[2]],
            [corners[2], corners[3]],
            [corners[3], corners[0]]
        ];

        for (const wall of walls) {
            for (const edge of edges) {
                if (segmentsIntersect(
                    edge[0].x, edge[0].y, edge[1].x, edge[1].y,
                    wall.x1, wall.y1, wall.x2, wall.y2
                )) {
                    return true;
                }
            }
        }
        return false;
    }

    // Check if a point is inside the tank
    containsPoint(px, py) {
        // Transform point to tank-local space
        const dx = px - this.x;
        const dy = py - this.y;
        const cos = Math.cos(-this.angle);
        const sin = Math.sin(-this.angle);
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;
        return Math.abs(lx) <= this.width / 2 && Math.abs(ly) <= this.height / 2;
    }

    die() {
        this.alive = false;
    }

    respawn(x, y, angle) {
        this.x = x;
        this.y = y;
        this.angle = angle;
        this.alive = true;
        this.shootCooldown = 0;
        this.bullets = [];
        this.input = { forward: false, backward: false, left: false, right: false, shoot: false };
    }
}

// Line segment intersection
function segmentsIntersect(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
    const d1 = direction(bx1, by1, bx2, by2, ax1, ay1);
    const d2 = direction(bx1, by1, bx2, by2, ax2, ay2);
    const d3 = direction(ax1, ay1, ax2, ay2, bx1, by1);
    const d4 = direction(ax1, ay1, ax2, ay2, bx2, by2);

    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        return true;
    }

    if (d1 === 0 && onSegment(bx1, by1, bx2, by2, ax1, ay1)) return true;
    if (d2 === 0 && onSegment(bx1, by1, bx2, by2, ax2, ay2)) return true;
    if (d3 === 0 && onSegment(ax1, ay1, ax2, ay2, bx1, by1)) return true;
    if (d4 === 0 && onSegment(ax1, ay1, ax2, ay2, bx2, by2)) return true;

    return false;
}

function direction(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function onSegment(ax, ay, bx, by, cx, cy) {
    return Math.min(ax, bx) <= cx && cx <= Math.max(ax, bx) &&
           Math.min(ay, by) <= cy && cy <= Math.max(ay, by);
}
