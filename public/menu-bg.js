(function () {
  const cv = document.getElementById("house-bg");
  if (!cv) return;
  const c = cv.getContext("2d");

  // Low-res pixel art resolution — scaled up by CSS with image-rendering: pixelated
  const W = 384;
  const H = 216;
  cv.width = W;
  cv.height = H;

  // Palette
  const SKY_TOP = "#5b9bd5";
  const SKY_MID = "#88c8f0";
  const SKY_BOT = "#f0d890";
  const SUN = "#fff8c0";
  const SUN_GLOW = "#ffe870";
  const CLOUD = "#f0f0f0";
  const CLOUD_SHADOW = "#d0d8e0";
  const HILL_FAR = "#5a9848";
  const HILL_MID = "#4a8838";
  const HILL_NEAR = "#3d7828";
  const GRASS_1 = "#4a8a30";
  const GRASS_2 = "#3e7a28";
  const GRASS_3 = "#356a20";
  const GRASS_HI = "#60a840";
  const PATH_1 = "#c8a860";
  const PATH_2 = "#b89850";
  const PATH_EDGE = "#a08040";
  const DIRT = "#8a7040";

  const WALL_1 = "#e0c878";
  const WALL_2 = "#d4b868";
  const WALL_3 = "#c8a858";
  const WALL_SHADOW = "#a08838";
  const WALL_HI = "#f0d888";
  const BRICK = "#c49848";

  const ROOF_1 = "#b83830";
  const ROOF_2 = "#a03028";
  const ROOF_3 = "#8a2820";
  const ROOF_HI = "#d04838";
  const ROOF_EDGE = "#6a1810";

  const TRIM = "#8a6530";
  const TRIM_HI = "#a88040";

  const DOOR = "#6a3818";
  const DOOR_HI = "#7a4828";
  const DOOR_DK = "#4a2810";

  const WIN_FRAME = "#7a5a30";
  const WIN_GLASS = "#1a3a60";
  const WIN_GLOW = "#f0d870";
  const WIN_GLOW2 = "#e8c850";

  const CHIMNEY_1 = "#984038";
  const CHIMNEY_2 = "#883030";

  const TRUNK = "#6a4020";
  const TRUNK_HI = "#7a5030";
  const LEAF_1 = "#3a8822";
  const LEAF_2 = "#2e7818";
  const LEAF_3 = "#48a030";
  const LEAF_4 = "#2a6818";

  const FENCE = "#c8a858";
  const FENCE_DK = "#a88838";

  const FLOWER_COLORS = ["#e84060", "#e8d040", "#d050e0", "#e86040", "#50a0e8", "#f0a040"];
  const STEM = "#3a8020";

  function px(x, y, col) {
    c.fillStyle = col;
    c.fillRect(x, y, 1, 1);
  }

  function rect(x, y, w, h, col) {
    c.fillStyle = col;
    c.fillRect(x, y, w, h);
  }

  // Seeded random for consistent scene
  let seed = 42;
  function rng() {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed - 1) / 2147483646;
  }

  function drawSky() {
    for (let y = 0; y < H; y++) {
      const t = y / H;
      let r, g, b;
      if (t < 0.5) {
        const s = t / 0.5;
        r = lerp(91, 136, s);
        g = lerp(155, 200, s);
        b = lerp(213, 240, s);
      } else {
        const s = (t - 0.5) / 0.5;
        r = lerp(136, 240, s);
        g = lerp(200, 216, s);
        b = lerp(240, 144, s);
      }
      c.fillStyle = `rgb(${r|0},${g|0},${b|0})`;
      c.fillRect(0, y, W, 1);
    }
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function drawSun(tick) {
    const sx = W - 60;
    const sy = 28;
    // Rays
    const rayLen = 14 + Math.sin(tick * 0.03) * 3;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + tick * 0.01;
      for (let r = 8; r < rayLen; r++) {
        const rx = sx + Math.cos(a) * r | 0;
        const ry = sy + Math.sin(a) * r | 0;
        if (r % 2 === 0) px(rx, ry, SUN_GLOW);
      }
    }
    // Sun body
    fillCircle(sx, sy, 7, SUN);
    fillCircle(sx, sy, 5, "#fffae0");
    // Highlight
    px(sx - 2, sy - 2, "#fff");
    px(sx - 1, sy - 2, "#fff");
  }

  function fillCircle(cx, cy, r, col) {
    c.fillStyle = col;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) {
          c.fillRect(cx + dx, cy + dy, 1, 1);
        }
      }
    }
  }

  function drawCloud(cx, cy, w) {
    // Shadow
    fillOval(cx + 1, cy + 2, w, 5, CLOUD_SHADOW);
    // Main body
    fillOval(cx, cy, w, 5, CLOUD);
    fillOval(cx - w * 0.3, cy - 3, w * 0.5, 5, CLOUD);
    fillOval(cx + w * 0.2, cy - 4, w * 0.4, 4, CLOUD);
    // Highlight
    fillOval(cx - 2, cy - 3, w * 0.3, 2, "#ffffff");
  }

  function fillOval(cx, cy, rx, ry, col) {
    c.fillStyle = col;
    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) {
          c.fillRect((cx + dx) | 0, (cy + dy) | 0, 1, 1);
        }
      }
    }
  }

  function drawHills() {
    // Far hills
    drawHillWave(130, HILL_FAR, 30, 0.015, 0);
    drawHillWave(138, HILL_MID, 22, 0.02, 50);
    drawHillWave(145, HILL_NEAR, 16, 0.025, 120);
  }

  function drawHillWave(baseY, col, amp, freq, offset) {
    c.fillStyle = col;
    for (let x = 0; x < W; x++) {
      const y = baseY - Math.sin((x + offset) * freq) * amp - Math.sin((x + offset * 2) * freq * 2.3) * (amp * 0.3);
      c.fillRect(x, y | 0, 1, H - (y | 0));
    }
  }

  function drawGround() {
    const groundY = 150;
    rect(0, groundY, W, H - groundY, GRASS_1);

    // Grass variation
    seed = 100;
    for (let x = 0; x < W; x++) {
      for (let y = groundY; y < H; y++) {
        const v = rng();
        if (v < 0.15) px(x, y, GRASS_2);
        else if (v < 0.22) px(x, y, GRASS_3);
        else if (v < 0.28) px(x, y, GRASS_HI);
      }
    }

    // Grass tufts at top edge
    seed = 200;
    for (let x = 0; x < W; x += 2) {
      const h = (rng() * 4) | 0;
      for (let dy = 0; dy < h; dy++) {
        px(x, groundY - dy, rng() > 0.5 ? GRASS_HI : GRASS_1);
      }
    }
  }

  function drawPath() {
    const groundY = 150;
    const cx = W / 2;
    const pathW = 18;
    // Path getting wider towards bottom
    for (let y = groundY; y < H; y++) {
      const t = (y - groundY) / (H - groundY);
      const w = pathW + t * 12;
      const x0 = (cx - w / 2) | 0;
      const x1 = (cx + w / 2) | 0;
      for (let x = x0; x <= x1; x++) {
        const edge = (x === x0 || x === x1);
        if (edge) {
          px(x, y, PATH_EDGE);
        } else {
          seed = x * 317 + y * 131;
          px(x, y, rng() > 0.7 ? PATH_2 : PATH_1);
        }
      }
    }
    // Stepping stones
    for (let i = 0; i < 4; i++) {
      const sy = groundY + 4 + i * 12;
      const sx = (cx - 2 + (i % 2) * 2) | 0;
      rect(sx, sy, 4, 2, DIRT);
      rect(sx + 1, sy, 2, 1, PATH_EDGE);
    }
  }

  function drawHouse() {
    const hx = (W / 2 - 60) | 0; // house left
    const hy = 80; // house top (wall top)
    const hw = 120; // house width
    const hh = 70; // wall height
    const groundY = 150;

    // ---- Foundation ----
    rect(hx - 2, hy + hh, hw + 4, 4, "#5a4a38");
    rect(hx - 1, hy + hh + 1, hw + 2, 2, "#4a3a28");

    // ---- Walls ----
    // Main wall fill with brick pattern
    for (let y = hy; y < hy + hh; y++) {
      for (let x = hx; x < hx + hw; x++) {
        const row = ((y - hy) / 4) | 0;
        const off = (row % 2) * 3;
        const col = ((x - hx + off) / 6) | 0;
        const bx = (x - hx + off) % 6;
        const by = (y - hy) % 4;

        if (by === 0 || bx === 0) {
          // Mortar
          px(x, y, WALL_3);
        } else {
          // Brick face with slight variation
          seed = col * 71 + row * 37;
          const v = rng();
          if (v < 0.3) px(x, y, WALL_1);
          else if (v < 0.7) px(x, y, WALL_2);
          else px(x, y, BRICK);
        }
      }
    }

    // Wall highlight (left edge)
    for (let y = hy; y < hy + hh; y++) {
      px(hx, y, WALL_HI);
    }
    // Wall shadow (right edge)
    for (let y = hy; y < hy + hh; y++) {
      px(hx + hw - 1, y, WALL_SHADOW);
    }

    // ---- Roof ----
    const roofPeak = hy - 38;
    const roofOverhang = 10;
    for (let y = roofPeak; y <= hy + 2; y++) {
      const t = (y - roofPeak) / (hy + 2 - roofPeak);
      const halfW = ((hw / 2 + roofOverhang) * t) | 0;
      const cx = hx + hw / 2;
      const x0 = (cx - halfW) | 0;
      const x1 = (cx + halfW) | 0;

      for (let x = x0; x <= x1; x++) {
        // Shingle pattern
        const row = ((y - roofPeak) / 3) | 0;
        const off = (row % 2) * 3;
        const sx = (x - x0 + off) % 6;

        if (sx === 0 && row > 0) {
          px(x, y, ROOF_3);
        } else if (x === x0 || x === x1) {
          px(x, y, ROOF_EDGE);
        } else {
          seed = x * 53 + y * 97;
          const v = rng();
          if (v < 0.35) px(x, y, ROOF_1);
          else if (v < 0.7) px(x, y, ROOF_2);
          else if (v < 0.85) px(x, y, ROOF_HI);
          else px(x, y, ROOF_3);
        }
      }
    }

    // Roof ridge line
    const cx = (hx + hw / 2) | 0;
    rect(cx - 1, roofPeak, 3, 2, ROOF_EDGE);

    // Roof trim / eave
    const eaveY = hy + 1;
    const eaveHalf = (hw / 2 + roofOverhang) | 0;
    rect(cx - eaveHalf - 1, eaveY, eaveHalf * 2 + 3, 3, TRIM);
    rect(cx - eaveHalf, eaveY, eaveHalf * 2 + 1, 1, TRIM_HI);

    // ---- Chimney ----
    const chimX = hx + hw - 25;
    const chimY = roofPeak - 5;
    const chimW = 12;
    const chimH = 25;
    rect(chimX, chimY, chimW, chimH, CHIMNEY_1);
    rect(chimX, chimY, 2, chimH, CHIMNEY_2);
    rect(chimX + chimW - 2, chimY, 2, chimH, CHIMNEY_2);
    // Chimney cap
    rect(chimX - 1, chimY - 2, chimW + 2, 3, "#783028");
    rect(chimX, chimY - 1, chimW, 1, "#984840");
    // Bricks on chimney
    for (let y = chimY + 3; y < chimY + chimH; y += 4) {
      for (let x = chimX + 2; x < chimX + chimW - 2; x += 5) {
        px(x, y, "#883828");
      }
    }

    // ---- Door ----
    const doorW = 16;
    const doorH = 30;
    const doorX = (cx - doorW / 2) | 0;
    const doorY = hy + hh - doorH;

    // Door frame
    rect(doorX - 2, doorY - 2, doorW + 4, doorH + 2, TRIM);
    rect(doorX - 1, doorY - 1, doorW + 2, doorH + 1, TRIM_HI);

    // Door body
    rect(doorX, doorY, doorW, doorH, DOOR);
    // Door panels
    rect(doorX + 2, doorY + 3, doorW - 4, 10, DOOR_HI);
    rect(doorX + 3, doorY + 4, doorW - 6, 8, DOOR);
    rect(doorX + 2, doorY + 16, doorW - 4, 11, DOOR_HI);
    rect(doorX + 3, doorY + 17, doorW - 6, 9, DOOR);

    // Door arch window
    const archCx = doorX + doorW / 2;
    const archCy = doorY + 6;
    for (let dy = -3; dy <= 0; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        if (dx * dx + dy * dy * 2 <= 12) {
          px((archCx + dx) | 0, archCy + dy, WIN_GLOW2);
        }
      }
    }

    // Doorknob
    px(doorX + doorW - 4, doorY + doorH / 2, "#d4a030");
    px(doorX + doorW - 3, doorY + doorH / 2, "#e8b840");
    px(doorX + doorW - 4, doorY + doorH / 2 + 1, "#b89028");

    // Door step
    rect(doorX - 4, hy + hh, doorW + 8, 3, "#8a7a68");
    rect(doorX - 3, hy + hh, doorW + 6, 1, "#9a8a78");

    // ---- Windows ----
    drawWindow(hx + 10, hy + 14, 20, 18);
    drawWindow(hx + hw - 30, hy + 14, 20, 18);

    // Second floor windows (in roof area)
    const sf_y = roofPeak + 12;
    drawSmallWindow(cx - 20, sf_y, 12, 10);
    drawSmallWindow(cx + 8, sf_y, 12, 10);

    // ---- Porch pillars ----
    rect(doorX - 6, hy + hh - 35, 3, 35, "#c8b898");
    rect(doorX + doorW + 3, hy + hh - 35, 3, 35, "#c8b898");
    px(doorX - 6, hy + hh - 35, TRIM_HI);
    px(doorX + doorW + 3, hy + hh - 35, TRIM_HI);

    // Porch roof
    rect(doorX - 10, hy + hh - 37, doorW + 20, 3, TRIM);
    rect(doorX - 9, hy + hh - 37, doorW + 18, 1, TRIM_HI);

    // ---- Gutters ----
    rect(hx - 1, hy - 1, 2, hh + 2, TRIM);
    rect(hx + hw - 1, hy - 1, 2, hh + 2, TRIM);

    // ---- House number ----
    px(hx + hw - 14, hy + 8, "#f0e8d0");
    px(hx + hw - 13, hy + 8, "#f0e8d0");
    px(hx + hw - 13, hy + 9, "#f0e8d0");
    px(hx + hw - 14, hy + 10, "#f0e8d0");
    px(hx + hw - 13, hy + 10, "#f0e8d0");

    // ---- Mailbox ----
    const mbx = hx - 18;
    const mby = groundY - 14;
    rect(mbx + 3, mby + 5, 2, 14, "#6a5a48");
    rect(mbx, mby, 8, 6, "#4a78b0");
    rect(mbx, mby, 8, 1, "#3a6898");
    px(mbx + 7, mby + 2, "#e84040"); // flag
    px(mbx + 7, mby + 1, "#e84040");
    rect(mbx + 7, mby + 1, 2, 1, "#e84040");
  }

  function drawWindow(wx, wy, ww, wh) {
    // Frame
    rect(wx - 1, wy - 1, ww + 2, wh + 2, WIN_FRAME);

    // Glass panes (2x2 grid)
    const pw = ((ww - 2) / 2) | 0;
    const ph = ((wh - 2) / 2) | 0;

    for (let py = 0; py < 2; py++) {
      for (let ppx = 0; ppx < 2; ppx++) {
        const gx = wx + 1 + ppx * (pw + 1);
        const gy = wy + 1 + py * (ph + 1);
        rect(gx, gy, pw, ph, WIN_GLASS);
        // Warm glow from inside
        rect(gx + 1, gy + 1, pw - 2, ph - 2, rng() > 0.3 ? WIN_GLOW : WIN_GLOW2);
        // Bright center
        px(gx + pw / 2 | 0, gy + ph / 2 | 0, "#fff8d0");
      }
    }
    // Cross bars
    rect(wx + pw, wy, 2, wh, WIN_FRAME);
    rect(wx, wy + ph, ww, 2, WIN_FRAME);

    // Sill
    rect(wx - 2, wy + wh, ww + 4, 2, TRIM);
    rect(wx - 1, wy + wh, ww + 2, 1, TRIM_HI);

    // Shutters
    rect(wx - 4, wy - 1, 3, wh + 2, "#4a7828");
    rect(wx + ww + 1, wy - 1, 3, wh + 2, "#4a7828");
    // Shutter detail
    for (let y = wy + 2; y < wy + wh - 1; y += 3) {
      px(wx - 3, y, "#3a6820");
      px(wx + ww + 2, y, "#3a6820");
    }
  }

  function drawSmallWindow(wx, wy, ww, wh) {
    rect(wx - 1, wy - 1, ww + 2, wh + 2, WIN_FRAME);
    rect(wx, wy, ww, wh, WIN_GLASS);
    rect(wx + 1, wy + 1, ww - 2, wh - 2, WIN_GLOW);
    px(wx + ww / 2 | 0, wy + wh / 2 | 0, "#fff8d0");
    rect(wx + (ww / 2 | 0), wy, 1, wh, WIN_FRAME);
    rect(wx, wy + (wh / 2 | 0), ww, 1, WIN_FRAME);
  }

  function drawTrees() {
    drawTree(40, 148, 22, 28);
    drawTree(18, 152, 16, 20);
    drawTree(W - 45, 148, 24, 30);
    drawTree(W - 20, 150, 14, 18);
    // Small bushes/saplings
    drawBush(70, 150, 10, 8);
    drawBush(W - 70, 151, 12, 9);
  }

  function drawTree(tx, groundY, crownR, trunkH) {
    // Trunk
    const tw = (crownR * 0.3) | 0 || 2;
    rect(tx - tw / 2, groundY - trunkH, tw, trunkH, TRUNK);
    rect(tx - tw / 2, groundY - trunkH, 1, trunkH, TRUNK_HI);

    // Crown layers
    const cy = groundY - trunkH - crownR * 0.5;
    fillCircle(tx, cy | 0, crownR, LEAF_2);
    fillCircle(tx - crownR * 0.3 | 0, cy - crownR * 0.3 | 0, crownR * 0.7 | 0, LEAF_1);
    fillCircle(tx + crownR * 0.2 | 0, cy - crownR * 0.4 | 0, crownR * 0.6 | 0, LEAF_3);

    // Leaf detail / texture
    seed = tx * 31 + groundY * 17;
    for (let i = 0; i < crownR * 3; i++) {
      const dx = ((rng() - 0.5) * crownR * 2) | 0;
      const dy = ((rng() - 0.5) * crownR * 1.5) | 0;
      if (dx * dx + dy * dy < crownR * crownR * 0.9) {
        px(tx + dx, (cy + dy) | 0, rng() > 0.5 ? LEAF_4 : LEAF_3);
      }
    }

    // Highlight spots
    for (let i = 0; i < 5; i++) {
      const hx = tx - crownR * 0.4 + rng() * crownR * 0.6;
      const hy = cy - crownR * 0.4 + rng() * crownR * 0.4;
      px(hx | 0, hy | 0, "#70c050");
    }
  }

  function drawBush(bx, by, bw, bh) {
    fillOval(bx, by - bh / 2, bw, bh, LEAF_1);
    fillOval(bx - bw * 0.3, by - bh * 0.6, bw * 0.6, bh * 0.7, LEAF_3);
    // Detail
    seed = bx * 23;
    for (let i = 0; i < 8; i++) {
      const dx = ((rng() - 0.5) * bw * 2) | 0;
      const dy = ((rng() - 0.5) * bh) | 0;
      px(bx + dx, by - bh / 2 + dy | 0, rng() > 0.5 ? LEAF_4 : "#60a838");
    }
  }

  function drawFence() {
    const groundY = 150;
    const fenceH = 14;
    const postW = 2;
    const gap = 6;

    // Left fence
    for (let x = 4; x < W / 2 - 75; x += gap + postW) {
      // Post
      rect(x, groundY - fenceH, postW, fenceH, FENCE);
      px(x, groundY - fenceH, FENCE_DK);
      // Pointed top
      px(x, groundY - fenceH - 1, FENCE);
      px(x + 1, groundY - fenceH - 1, FENCE_DK);
    }
    // Rails
    rect(4, groundY - fenceH + 3, W / 2 - 79, 1, FENCE_DK);
    rect(4, groundY - fenceH + 8, W / 2 - 79, 1, FENCE_DK);

    // Right fence
    for (let x = W / 2 + 75; x < W - 4; x += gap + postW) {
      rect(x, groundY - fenceH, postW, fenceH, FENCE);
      px(x, groundY - fenceH, FENCE_DK);
      px(x, groundY - fenceH - 1, FENCE);
      px(x + 1, groundY - fenceH - 1, FENCE_DK);
    }
    rect(W / 2 + 75, groundY - fenceH + 3, W - W / 2 - 79, 1, FENCE_DK);
    rect(W / 2 + 75, groundY - fenceH + 8, W - W / 2 - 79, 1, FENCE_DK);
  }

  function drawFlowers() {
    seed = 777;
    const groundY = 150;
    const spots = [
      [22, groundY - 4], [35, groundY - 3], [55, groundY - 5],
      [W - 25, groundY - 4], [W - 40, groundY - 3], [W - 55, groundY - 5],
      [90, groundY - 3], [W - 85, groundY - 4],
      [110, groundY - 2], [W - 110, groundY - 3],
    ];
    for (const [fx, fy] of spots) {
      // Stem
      rect(fx, fy, 1, 5, STEM);
      // Petals
      const col = FLOWER_COLORS[(rng() * FLOWER_COLORS.length) | 0];
      px(fx, fy - 1, col);
      px(fx - 1, fy, col);
      px(fx + 1, fy, col);
      px(fx, fy + 1, col);
      // Center
      px(fx, fy, "#fff8a0");
    }
  }

  function drawSmoke(tick) {
    const chimX = (W / 2 - 60) + 120 - 25 + 5;
    const chimY = 80 - 38 - 5 - 2;

    for (let i = 0; i < 4; i++) {
      const age = ((tick * 0.6 + i * 25) % 100) / 100;
      if (age > 1) continue;
      const sx = chimX + Math.sin(age * 5 + i) * (3 + age * 6) | 0;
      const sy = chimY - age * 30 | 0;
      const size = (1 + age * 3) | 0;
      const alpha = Math.max(0, 1 - age * 1.2);
      if (alpha < 0.1) continue;
      const grey = 200 + (rng() * 30) | 0;
      c.globalAlpha = alpha * 0.5;
      fillCircle(sx, sy, size, `rgb(${grey},${grey},${grey})`);
    }
    c.globalAlpha = 1;
  }

  // Animation
  let tick = 0;
  let cloudOffsets = [0, 80, 200];

  function drawClouds(tick) {
    for (let i = 0; i < 3; i++) {
      const speed = 0.15 + i * 0.05;
      const cx = ((cloudOffsets[i] + tick * speed) % (W + 60)) - 30;
      const cy = 20 + i * 14;
      const size = 12 + i * 3;
      drawCloud(cx, cy, size);
    }
  }

  function render() {
    tick++;

    c.clearRect(0, 0, W, H);
    c.globalAlpha = 1;

    drawSky();
    drawSun(tick);
    drawClouds(tick);
    drawHills();
    drawGround();
    drawPath();
    drawFence();
    drawTrees();
    drawFlowers();

    seed = 500; // reset for consistent house
    drawHouse();
    drawSmoke(tick);

    requestAnimationFrame(render);
  }

  render();
})();
