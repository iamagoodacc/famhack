class Bullet {
    constructor(x, y, angle, ownerId) {
        this.x = x;
        this.y = y;
        this.angle = angle;
        this.ownerId = ownerId;
        this.speed = 250;
        this.radius = 4;
        this.alive = true;
        this.lifetime = 5; // seconds before expiring
        this.age = 0;
        this.maxBounces = 20;
        this.bounceCount = 0;

        this.vx = Math.cos(angle) * this.speed;
        this.vy = Math.sin(angle) * this.speed;

        // Brief grace period so bullet doesn't immediately hit the shooter
        this.gracePeriod = 0.1;
    }

    update(dt, walls) {
        if (!this.alive) return;

        this.age += dt;
        if (this.gracePeriod > 0) this.gracePeriod -= dt;

        if (this.age >= this.lifetime || this.bounceCount >= this.maxBounces) {
            this.alive = false;
            return;
        }

        // Move in small steps for accurate collision
        let remaining = dt;
        const stepSize = 0.002;

        while (remaining > 0 && this.alive) {
            const step = Math.min(remaining, stepSize);
            const nx = this.x + this.vx * step;
            const ny = this.y + this.vy * step;

            let bounced = false;
            for (const wall of walls) {
                const collision = this.checkWallCollision(nx, ny, wall);
                if (collision) {
                    this.bounce(wall);
                    this.bounceCount++;
                    if (this.bounceCount >= this.maxBounces) {
                        this.alive = false;
                    }
                    bounced = true;
                    break;
                }
            }

            if (!bounced) {
                this.x = nx;
                this.y = ny;
            }

            remaining -= step;
        }
    }

    checkWallCollision(nx, ny, wall) {
        // Check if the bullet circle intersects the wall segment
        return pointToSegmentDist(nx, ny, wall.x1, wall.y1, wall.x2, wall.y2) < this.radius;
    }

    bounce(wall) {
        const wallDx = wall.x2 - wall.x1;
        const wallDy = wall.y2 - wall.y1;
        const len = Math.sqrt(wallDx * wallDx + wallDy * wallDy);
        if (len === 0) return;

        // Wall normal
        let nx = -wallDy / len;
        let ny = wallDx / len;

        // Make sure normal points toward bullet
        const dot = this.vx * nx + this.vy * ny;
        if (dot > 0) {
            nx = -nx;
            ny = -ny;
        }

        // Reflect velocity
        const dotProduct = this.vx * nx + this.vy * ny;
        this.vx -= 2 * dotProduct * nx;
        this.vy -= 2 * dotProduct * ny;

        // Push bullet out of wall
        const closest = closestPointOnSegment(this.x, this.y, wall.x1, wall.y1, wall.x2, wall.y2);
        const pushDx = this.x - closest.x;
        const pushDy = this.y - closest.y;
        const pushDist = Math.sqrt(pushDx * pushDx + pushDy * pushDy);
        if (pushDist > 0 && pushDist < this.radius) {
            this.x = closest.x + (pushDx / pushDist) * (this.radius + 1);
            this.y = closest.y + (pushDy / pushDist) * (this.radius + 1);
        }
    }

    hitsTarget(tank) {
        if (!this.alive || !tank.alive) return false;
        if (this.gracePeriod > 0 && this.ownerId === tank.id) return false;
        return tank.containsPoint(this.x, this.y);
    }
}

function pointToSegmentDist(px, py, x1, y1, x2, y2) {
    const cp = closestPointOnSegment(px, py, x1, y1, x2, y2);
    const dx = px - cp.x;
    const dy = py - cp.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function closestPointOnSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return { x: x1, y: y1 };

    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return { x: x1 + t * dx, y: y1 + t * dy };
}
