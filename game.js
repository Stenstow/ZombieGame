const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const stats = document.getElementById("stats");

const world = {
  width: 5200,
  height: 3200,
};

const keys = {
  ArrowLeft: false,
  ArrowRight: false,
  ArrowUp: false,
  ArrowDown: false,
  Shift: false,
  Space: false,
  R: false,
};

const player = {
  x: world.width * 0.5,
  y: world.height * 0.55,
  r: 18,
  baseSpeed: 230,
  sprintBoost: 1.65,
  stamina: 100,
  maxStamina: 100,
  health: 100,
  score: 0,
  dirX: 1,
  dirY: 0,
  hitCooldown: 0,
  fireCooldown: 0,
  reloadTime: 0,
  barrelSpin: 0,
  currentWeapon: 0,
  weapons: [
    { name: "Minigun", ammo: 180, magSize: 180, reserveAmmo: 1800, maxReserve: 3600, reloadTime: 2.2, fireCooldown: 0.035, speed: 860, spread: 0.22, pellets: 1, damage: 1, r: 4, type: "bullet", color: "#ffef9d" },
    { name: "Schrotflinte", ammo: 8, magSize: 8, reserveAmmo: 64, maxReserve: 128, reloadTime: 1.5, fireCooldown: 0.8, speed: 700, spread: 0.35, pellets: 10, damage: 1, r: 3, type: "bullet", color: "#f3c153" },
    { name: "Flammenwerfer", ammo: 150, magSize: 150, reserveAmmo: 600, maxReserve: 1200, reloadTime: 2.8, fireCooldown: 0.04, speed: 450, spread: 0.3, pellets: 1, damage: 0.4, r: 10, type: "flame", color: "#ff5000" }
  ]
};

const camera = { x: 0, y: 0 };

let gameOver = false;
let muzzleFlash = 0;
let wave = 1;
let waveDelay = 1.2;
let timeNow = 0;
const ZOMBIE_MULTIPLIER = 100;
const MAX_ACTIVE_ZOMBIES = 260;
const SPAWN_RATE = 55;
let waveTarget = 0;
let waveSpawned = 0;
let spawnBudget = 0;
let bossPending = false;
let totalKills = 0;

const bullets = [];
const zombies = [];
const medipacks = [];
const buildings = [];
const cityObstacles = [];
const props = [];
const particles = [];

function addBuilding(x, y, w, h, tone = 0) {
  const b = { x, y, w, h, tone };
  buildings.push(b);

  // Perimeter-only colliders: solid walls with better performance.
  const step = 44;
  for (let xx = x + 20; xx < x + w; xx += step) {
    cityObstacles.push({ x: xx, y: y + 20, r: 16 });
    cityObstacles.push({ x: xx, y: y + h - 20, r: 16 });
  }
  for (let yy = y + 20; yy < y + h; yy += step) {
    cityObstacles.push({ x: x + 20, y: yy, r: 16 });
    cityObstacles.push({ x: x + w - 20, y: yy, r: 16 });
  }
}

function generateCity() {
  const cols = 5;
  const rows = 3;
  const blockW = 780;
  const blockH = 820;
  const startX = 190;
  const startY = 180;
  const gapX = 940;
  const gapY = 960;

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const bx = startX + gx * gapX;
      const by = startY + gy * gapY;

      addBuilding(bx + 36, by + 36, blockW - 72, 122, (gx + gy) % 3);
      addBuilding(bx + 36, by + blockH - 160, blockW - 72, 124, (gx + gy + 1) % 3);
      addBuilding(bx + 36, by + 200, 145, blockH - 400, (gx + gy + 2) % 3);
      addBuilding(bx + blockW - 181, by + 200, 145, blockH - 400, (gx + gy) % 3);

      props.push({ x: bx + blockW * 0.5, y: by + blockH * 0.5, r: 18 + ((gx + gy) % 2) * 4 });
      props.push({ x: bx + blockW * 0.5 - 54, y: by + blockH * 0.5 + 34, r: 12 });
      props.push({ x: bx + blockW * 0.5 + 66, y: by + blockH * 0.5 - 26, r: 13 });
    }
  }
}

generateCity();

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function normalize(x, y) {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

function circleHit(ax, ay, ar, bx, by, br) {
  const dx = bx - ax;
  const dy = by - ay;
  const rr = ar + br;
  return dx * dx + dy * dy <= rr * rr;
}

function obstaclePush(entity, nx, ny, radius) {
  let x = nx;
  let y = ny;
  const obstacles = cityObstacles;

  for (const o of obstacles) {
    const dx = x - o.x;
    const dy = y - o.y;
    const minDist = radius + o.r + 2;
    const dist = Math.hypot(dx, dy);
    if (dist > 0 && dist < minDist) {
      const push = (minDist - dist) / dist;
      x += dx * push;
      y += dy * push;
    }
  }

  entity.x = clamp(x, radius, world.width - radius);
  entity.y = clamp(y, radius, world.height - radius);
}

function aliveZombieCount() {
  let alive = 0;
  for (const z of zombies) {
    if (z.alive) alive += 1;
  }
  return alive;
}

function isInsideObstacle(x, y, radius) {
  for (const o of cityObstacles) {
    if (Math.hypot(x - o.x, y - o.y) < o.r + radius + 8) return true;
  }
  return false;
}

function nearestAliveZombieDistance(x, y) {
  let best = Infinity;
  for (const z of zombies) {
    if (!z.alive) continue;
    const d = Math.hypot(x - z.x, y - z.y);
    if (d < best) best = d;
  }
  return best;
}

function spawnMedipack(x, y) {
  medipacks.push({
    x,
    y,
    r: 11,
    heal: 28,
    taken: false,
  });
}

function aliveByQuadrant() {
  const q = [0, 0, 0, 0];
  for (const z of zombies) {
    if (!z.alive) continue;
    const right = z.x >= world.width * 0.5 ? 1 : 0;
    const bottom = z.y >= world.height * 0.5 ? 1 : 0;
    q[bottom * 2 + right] += 1;
  }
  return q;
}

function spawnZombie(forcedType = null) {
  const quadCounts = aliveByQuadrant();
  let targetQuad = 0;
  for (let i = 1; i < 4; i++) {
    if (quadCounts[i] < quadCounts[targetQuad]) targetQuad = i;
  }

  const halfW = world.width * 0.5;
  const halfH = world.height * 0.5;
  const minX = targetQuad % 2 === 0 ? 40 : halfW + 20;
  const maxX = targetQuad % 2 === 0 ? halfW - 20 : world.width - 40;
  const minY = targetQuad < 2 ? 40 : halfH + 20;
  const maxY = targetQuad < 2 ? halfH - 20 : world.height - 40;

  const minPlayerDist = 520;
  let bestX = rand(minX, maxX);
  let bestY = rand(minY, maxY);
  let bestScore = -Infinity;

  for (let i = 0; i < 32; i++) {
    const x = rand(minX, maxX);
    const y = rand(minY, maxY);
    const dPlayer = Math.hypot(x - player.x, y - player.y);
    if (dPlayer < minPlayerDist) continue;
    if (isInsideObstacle(x, y, 18)) continue;

    const spread = nearestAliveZombieDistance(x, y);
    const edge = Math.min(x, y, world.width - x, world.height - y);
    const score = spread * 1.05 + edge * 0.15 + dPlayer * 0.18;
    if (score > bestScore) {
      bestScore = score;
      bestX = x;
      bestY = y;
    }
  }

  let type = forcedType;
  if (!type) {
    const heavyChance = clamp(0.08 + wave * 0.012, 0.08, 0.32);
    type = Math.random() < heavyChance ? "heavy" : "normal";
  }

  let hp = 2 + Math.floor(wave / 3);
  let speed = rand(70, 105) + wave * 2;
  let radius = 18;
  let attackDamage = 8;
  let scoreValue = 45;

  if (type === "heavy") {
    hp = 5 + Math.floor(wave / 2);
    speed = rand(56, 82) + wave * 1.25;
    radius = 23;
    attackDamage = 13;
    scoreValue = 110;
  } else if (type === "boss") {
    hp = 36 + wave * 3;
    speed = 44 + wave * 0.9;
    radius = 34;
    attackDamage = 22;
    scoreValue = 680;
  }

  zombies.push({
    x: bestX,
    y: bestY,
    r: radius,
    speed,
    hp,
    maxHp: hp,
    type,
    alive: true,
    attackCd: 0,
    attackDamage,
    scoreValue,
    wander: Math.random() * Math.PI * 2,
    dirX: 1,
    dirY: 0,
  });
}

function feedWave(dt) {
  if (waveSpawned >= waveTarget) return;
  spawnBudget += SPAWN_RATE * dt;

  let alive = aliveZombieCount();
  while (spawnBudget >= 1 && waveSpawned < waveTarget && alive < MAX_ACTIVE_ZOMBIES) {
    if (bossPending) {
      spawnZombie("boss");
      bossPending = false;
    } else {
      spawnZombie();
    }
    waveSpawned += 1;
    spawnBudget -= 1;
    alive += 1;
  }
}

function startWave(level) {
  waveTarget = (4 + level * 2) * ZOMBIE_MULTIPLIER;
  waveSpawned = 0;
  spawnBudget = MAX_ACTIVE_ZOMBIES;
  bossPending = level % 5 === 0;
  feedWave(0);
}

function maybeStartNextWave(dt) {
  feedWave(dt);
  if (waveSpawned < waveTarget || aliveZombieCount() > 0) return;
  waveDelay -= dt;
  if (waveDelay <= 0) {
    zombies.length = 0;
    wave += 1;
    waveDelay = 1.5;
    startWave(wave);
    player.score += 120;

    player.weapons[0].reserveAmmo = clamp(player.weapons[0].reserveAmmo + 220, 0, player.weapons[0].maxReserve);
    player.weapons[1].reserveAmmo = clamp(player.weapons[1].reserveAmmo + 16, 0, player.weapons[1].maxReserve);
    player.weapons[2].reserveAmmo = clamp(player.weapons[2].reserveAmmo + 150, 0, player.weapons[2].maxReserve);
  }
}

function switchWeapon(index) {
  if (index >= 0 && index < player.weapons.length && player.currentWeapon !== index) {
    player.currentWeapon = index;
    player.reloadTime = 0;
    player.fireCooldown = 0.25; // short delay after switching
  }
}

function reload() {
  const w = player.weapons[player.currentWeapon];
  if (player.reloadTime > 0 || w.ammo === w.magSize || w.reserveAmmo <= 0) return;
  player.reloadTime = w.reloadTime;
}

function fire() {
  if (gameOver) return;
  const w = player.weapons[player.currentWeapon];
  if (player.reloadTime > 0 || player.fireCooldown > 0) return;
  if (w.ammo <= 0) {
    reload();
    return;
  }

  player.fireCooldown = w.fireCooldown;
  w.ammo -= 1;
  muzzleFlash = w.type === "flame" ? 0.02 : 0.06;
  player.barrelSpin += w.name === "Minigun" ? 0.9 : 0.1;

  if (w.type !== "flame") {
    particles.push({
      x: player.x + player.dirX * 10,
      y: player.y + player.dirY * 10,
      vx: (player.dirY + (Math.random() - 0.5) * 0.5) * 120,
      vy: (-player.dirX + (Math.random() - 0.5) * 0.5) * 120,
      life: 1.5 + Math.random(),
      type: "shell"
    });
  }

  for (let i = 0; i < w.pellets; i++) {
    const spread = (Math.random() - 0.5) * w.spread;
    const c = Math.cos(spread);
    const s = Math.sin(spread);
    const sx = player.dirX * c - player.dirY * s;
    const sy = player.dirX * s + player.dirY * c;

    // add some random speed variation for flamethrower and shotgun
    const varSpeed = w.speed * (1 + (Math.random() - 0.5) * 0.15);

    bullets.push({
      x: player.x + sx * 26 + (Math.random() - 0.5) * 5,
      y: player.y + sy * 26 + (Math.random() - 0.5) * 5,
      vx: sx * varSpeed,
      vy: sy * varSpeed,
      life: w.type === "flame" ? (0.35 + Math.random() * 0.1) : 0.95,
      r: w.type === "flame" ? (8 + Math.random() * 6) : w.r,
      damage: w.damage,
      type: w.type,
      color: w.color
    });
  }
}

window.addEventListener("keydown", (e) => {
  if (e.key in keys) {
    keys[e.key] = true;
    e.preventDefault();
  }
  if (e.code === "Space") {
    keys.Space = true;
    e.preventDefault();
  }
  if (e.key === "r" || e.key === "R") {
    keys.R = true;
    e.preventDefault();
  }
  if (e.key === "1") switchWeapon(0);
  if (e.key === "2") switchWeapon(1);
  if (e.key === "3") switchWeapon(2);

  if ((e.key === "n" || e.key === "N") && gameOver) {
    window.location.reload();
  }
});

window.addEventListener("keyup", (e) => {
  if (e.key in keys) {
    keys[e.key] = false;
    e.preventDefault();
  }
  if (e.code === "Space") {
    keys.Space = false;
    e.preventDefault();
  }
  if (e.key === "r" || e.key === "R") {
    keys.R = false;
    e.preventDefault();
  }
});

// Mobile Controls handling
document.querySelectorAll(".mob-btn").forEach((btn) => {
  const tKey = btn.dataset.key;
  if (!tKey) return;

  const press = (e) => {
    e.preventDefault();
    if (tKey === 'N' && gameOver) {
      window.location.reload();
      return;
    }
    if (tKey === "Switch") {
      switchWeapon((player.currentWeapon + 1) % player.weapons.length);
      return;
    }
    keys[tKey] = true;
  };

  const release = (e) => {
    e.preventDefault();
    keys[tKey] = false;
  };

  btn.addEventListener("touchstart", press, { passive: false });
  btn.addEventListener("touchend", release, { passive: false });
  btn.addEventListener("mousedown", press);
  btn.addEventListener("mouseup", release);
  btn.addEventListener("mouseleave", release);
});

function updatePlayer(dt) {
  let mx = 0;
  let my = 0;
  if (keys.ArrowLeft) mx -= 1;
  if (keys.ArrowRight) mx += 1;
  if (keys.ArrowUp) my -= 1;
  if (keys.ArrowDown) my += 1;

  if (mx !== 0 || my !== 0) {
    const n = normalize(mx, my);
    mx = n.x;
    my = n.y;
    player.dirX = mx;
    player.dirY = my;
  }

  const moving = mx !== 0 || my !== 0;
  const sprinting = moving && keys.Shift && player.stamina > 1;
  const speed = player.baseSpeed * (sprinting ? player.sprintBoost : 1);

  if (sprinting) player.stamina = clamp(player.stamina - 35 * dt, 0, player.maxStamina);
  else player.stamina = clamp(player.stamina + 22 * dt, 0, player.maxStamina);

  if (moving) {
    const nx = player.x + mx * speed * dt;
    const ny = player.y + my * speed * dt;
    obstaclePush(player, nx, ny, player.r);
  }

  if (keys.Space) fire();
  if (keys.R) reload();

  if (player.fireCooldown > 0) player.fireCooldown -= dt;
  if (player.hitCooldown > 0) player.hitCooldown -= dt;
  if (muzzleFlash > 0) muzzleFlash -= dt;
  if (player.barrelSpin > 0) player.barrelSpin = Math.max(0, player.barrelSpin - dt * 5.5);

  if (player.reloadTime > 0) {
    player.reloadTime -= dt;
    if (player.reloadTime <= 0) {
      const w = player.weapons[player.currentWeapon];
      const needed = w.magSize - w.ammo;
      const amount = Math.min(needed, w.reserveAmmo);
      w.ammo += amount;
      w.reserveAmmo -= amount;
      player.reloadTime = 0;
    }
  }
}

function updateBullets(dt) {
  const obstacles = cityObstacles;

  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;

    if (b.life <= 0 || b.x < 0 || b.y < 0 || b.x > world.width || b.y > world.height) {
      bullets.splice(i, 1);
      continue;
    }

    let consumed = false;
    for (const o of obstacles) {
      if (circleHit(b.x, b.y, b.r, o.x, o.y, o.r)) {
        bullets.splice(i, 1);
        consumed = true;
        break;
      }
    }
    if (consumed) continue;

    for (const z of zombies) {
      if (!z.alive) continue;
      if (circleHit(b.x, b.y, b.r, z.x, z.y, z.r)) {
        z.hp -= b.damage;

        if (b.type !== "flame") {
          bullets.splice(i, 1);
        }

        for (let p = 0; p < (b.type === "flame" ? 1 : 3); p++) {
          particles.push({
            x: b.x,
            y: b.y,
            vx: (b.vx * 0.1) + (Math.random() - 0.5) * 100,
            vy: (b.vy * 0.1) + (Math.random() - 0.5) * 100,
            life: 0.3 + Math.random() * 0.3,
            type: "blood"
          });
        }

        if (z.hp <= 0) {
          z.alive = false;
          player.score += z.scoreValue;
          totalKills += 1;
          if (totalKills % 20 === 0) {
            spawnMedipack(z.x, z.y);
          }
        }
        break;
      }
    }
  }
}

function updateMedipacks() {
  for (const m of medipacks) {
    if (m.taken) continue;
    if (circleHit(player.x, player.y, player.r, m.x, m.y, m.r + 2)) {
      m.taken = true;
      player.health = clamp(player.health + m.heal, 0, 100);
      player.score += 35;
    }
  }
}

function updateZombies(dt) {
  for (const z of zombies) {
    if (!z.alive) continue;

    const dx = player.x - z.x;
    const dy = player.y - z.y;
    const dist = Math.hypot(dx, dy);
    let vx = 0;
    let vy = 0;

    if (dist < 920) {
      vx = (dx / Math.max(dist, 0.001)) * z.speed;
      vy = (dy / Math.max(dist, 0.001)) * z.speed;
    } else {
      z.wander += (Math.random() - 0.5) * dt;
      vx = Math.cos(z.wander) * z.speed * 0.28;
      vy = Math.sin(z.wander) * z.speed * 0.28;
    }

    const vlen = Math.hypot(vx, vy);
    if (vlen > 1) {
      z.dirX = vx / vlen;
      z.dirY = vy / vlen;
    }

    const nx = z.x + vx * dt;
    const ny = z.y + vy * dt;
    obstaclePush(z, nx, ny, z.r);

    if (z.attackCd > 0) z.attackCd -= dt;
    if (circleHit(player.x, player.y, player.r, z.x, z.y, z.r) && z.attackCd <= 0 && player.hitCooldown <= 0) {
      player.health = clamp(player.health - z.attackDamage, 0, 100);
      z.attackCd = z.type === "boss" ? 0.68 : 0.55;
      player.hitCooldown = 0.25;
    }
  }
}

function updateCamera(dt) {
  const tx = clamp(player.x - canvas.width * 0.5, 0, world.width - canvas.width);
  const ty = clamp(player.y - canvas.height * 0.5, 0, world.height - canvas.height);
  const smooth = clamp(10 * dt, 0, 1);
  camera.x += (tx - camera.x) * smooth;
  camera.y += (ty - camera.y) * smooth;
}

function drawSkyGround() {
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, "#87939f");
  g.addColorStop(1, "#616b75");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#4a525a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const roadX = 940;
  const roadY = 960;
  const ox = camera.x % roadX;
  const oy = camera.y % roadY;

  ctx.strokeStyle = "rgba(250, 232, 158, 0.3)";
  ctx.lineWidth = 2;
  for (let y = -oy; y < canvas.height + roadY; y += roadY) {
    for (let x = -ox; x < canvas.width + roadX; x += roadX) {
      for (let i = 0; i < 5; i++) {
        const dx = x + 370 + i * 36;
        ctx.beginPath();
        ctx.moveTo(dx, y + 430);
        ctx.lineTo(dx + 20, y + 430);
        ctx.stroke();
      }
    }
  }
}

function drawBuilding(b) {
  const x = b.x - camera.x;
  const y = b.y - camera.y;
  if (x > canvas.width + 80 || y > canvas.height + 80 || x + b.w < -80 || y + b.h < -80) return;

  const tones = [
    { roof: "#7d858f", wall: "#5f676f" },
    { roof: "#8a7f76", wall: "#6e655f" },
    { roof: "#6f7b86", wall: "#55616b" },
  ];
  const t = tones[b.tone % tones.length];

  ctx.fillStyle = "rgba(0,0,0,0.24)";
  ctx.fillRect(x + 10, y + 10, b.w, b.h);

  ctx.fillStyle = t.wall;
  ctx.fillRect(x, y, b.w, b.h);
  ctx.fillStyle = t.roof;
  ctx.fillRect(x + 4, y + 4, b.w - 8, b.h - 8);

  ctx.fillStyle = "rgba(230, 236, 242, 0.25)";
  const wyStep = 30;
  const wxStep = 42;
  for (let yy = y + 14; yy < y + b.h - 12; yy += wyStep) {
    for (let xx = x + 14; xx < x + b.w - 14; xx += wxStep) {
      ctx.fillRect(xx, yy, 12, 8);
    }
  }
}

function drawCourtyardProp(p) {
  const x = p.x - camera.x;
  const y = p.y - camera.y;
  if (x < -70 || x > canvas.width + 70 || y < -70 || y > canvas.height + 70) return;

  ctx.fillStyle = "#70797f";
  ctx.beginPath();
  ctx.ellipse(x, y, p.r * 1.25, p.r, 0.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(40, 45, 52, 0.55)";
  ctx.fillRect(x - p.r * 0.7, y - 2, p.r * 1.4, 4);
}

function drawPlayer() {
  const x = player.x - camera.x;
  const y = player.y - camera.y;
  const moving = keys.ArrowLeft || keys.ArrowRight || keys.ArrowUp || keys.ArrowDown;
  const pace = moving ? (keys.Shift ? 0.03 : 0.021) : 0;
  const step = moving ? Math.sin(timeNow * pace) : 0;
  const armSwing = step * 3.2;
  const legSwing = step * 4.8;
  const bob = moving ? Math.sin(timeNow * pace * 2) * 1.6 : 0;
  const lookX = player.dirX * 7;
  const lookY = player.dirY * 7;
  const gunEndX = x + player.dirX * 42;
  const gunEndY = y + player.dirY * 42;
  const px = -player.dirY * 2.4;
  const py = player.dirX * 2.4;

  ctx.save();
  ctx.translate(0, bob);

  ctx.fillStyle = "#1f2732";
  ctx.beginPath();
  ctx.ellipse(x, y + 1, 12, 16, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#20303a";
  ctx.fillRect(x - 5, y - 2, 10, 20);

  ctx.fillStyle = "#d0ab84";
  ctx.beginPath();
  ctx.arc(x + lookX * 0.2, y - 13 + lookY * 0.2, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#8fa0b1";
  ctx.beginPath();
  ctx.arc(x + lookX * 0.2, y - 16 + lookY * 0.2, 2.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#d0ab84";
  ctx.fillRect(x - 10, y - 2 + armSwing * 0.35, 4, 11);
  ctx.fillRect(x + 6, y - 2 - armSwing * 0.35, 4, 11);

  ctx.fillStyle = "#20242a";
  ctx.fillRect(x - 8, y + 11 + legSwing * 0.35, 6, 10);
  ctx.fillRect(x + 2, y + 11 - legSwing * 0.35, 6, 10);

  ctx.fillStyle = "#404753";
  ctx.beginPath();
  ctx.moveTo(x + px, y - 2 + py);
  ctx.lineTo(x - px, y - 2 - py);
  ctx.lineTo(gunEndX - px, gunEndY - py);
  ctx.lineTo(gunEndX + px, gunEndY + py);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#8a939f";
  ctx.beginPath();
  ctx.arc(gunEndX, gunEndY, 3, 0, Math.PI * 2);
  ctx.fill();

  const spin = player.barrelSpin + timeNow * 0.04;
  for (let i = 0; i < 3; i++) {
    const a = spin + (i * Math.PI * 2) / 3;
    const bx = gunEndX - player.dirX * 6 + Math.cos(a) * 1.8 + px * 0.45;
    const by = gunEndY - player.dirY * 6 + Math.sin(a) * 1.8 + py * 0.45;
    ctx.fillStyle = "#1b1f25";
    ctx.beginPath();
    ctx.arc(bx, by, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }

  if (muzzleFlash > 0) {
    ctx.fillStyle = "#ffd35b";
    ctx.beginPath();
    ctx.moveTo(gunEndX + player.dirX * 3, gunEndY + player.dirY * 3);
    ctx.lineTo(gunEndX + player.dirX * 16 + px * 1.2, gunEndY + player.dirY * 16 + py * 1.2);
    ctx.lineTo(gunEndX + player.dirX * 16 - px * 1.2, gunEndY + player.dirY * 16 - py * 1.2);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function drawZombie(z) {
  if (!z.alive) return;
  const x = z.x - camera.x;
  const y = z.y - camera.y;
  if (x < -90 || x > canvas.width + 90 || y < -90 || y > canvas.height + 90) return;
  const ang = Math.atan2(z.dirY || 0, z.dirX || 1);
  const scale = z.r / 18;
  const stride = Math.sin(timeNow * 0.018 + z.x * 0.01) * (4.5 * scale);
  const hunch = Math.sin(timeNow * 0.01 + z.y * 0.008) * 1.4;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);

  let body = "#4f6f4f";
  let skin = "#95ae84";
  let cloth = "#3a5038";
  if (z.type === "heavy") {
    body = "#4e5d6f";
    skin = "#9cae9d";
    cloth = "#2c3a49";
  } else if (z.type === "boss") {
    body = "#513b5f";
    skin = "#b4a2c5";
    cloth = "#372443";
  }

  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(-2 * scale, 1 + hunch, 12 * scale, 15 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(2 * scale, -12 * scale + hunch * 0.5, 7.5 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = cloth;
  ctx.fillRect(-6 * scale, -2 * scale + stride * 0.24, 4 * scale, 9 * scale);
  ctx.fillRect(5 * scale, -2 * scale - stride * 0.24, 4 * scale, 9 * scale);

  ctx.fillStyle = "#5b3b37";
  ctx.fillRect(-7 * scale, 10 * scale + stride * 0.3, 5 * scale, 10 * scale);
  ctx.fillRect(2 * scale, 10 * scale - stride * 0.3, 5 * scale, 10 * scale);

  ctx.fillStyle = "#2b1e1e";
  ctx.fillRect(-1 * scale, -13 * scale, 2 * scale, 2 * scale);
  ctx.fillRect(4 * scale, -13 * scale, 2 * scale, 2 * scale);

  if (z.type === "boss") {
    const hpW = 34;
    const hpRatio = clamp(z.hp / z.maxHp, 0, 1);
    ctx.fillStyle = "rgba(10,10,10,0.65)";
    ctx.fillRect(-hpW * 0.5, -44, hpW, 4);
    ctx.fillStyle = "#b45aff";
    ctx.fillRect(-hpW * 0.5, -44, hpW * hpRatio, 4);
  }

  ctx.restore();
}

function drawMedipack(m) {
  if (m.taken) return;
  const x = m.x - camera.x;
  const y = m.y - camera.y + Math.sin(timeNow * 0.005 + m.x * 0.01) * 3;
  if (x < -40 || x > canvas.width + 40 || y < -40 || y > canvas.height + 40) return;

  ctx.fillStyle = "#f1f1f1";
  ctx.fillRect(x - 9, y - 7, 18, 14);
  ctx.fillStyle = "#d54949";
  ctx.fillRect(x - 2, y - 6, 4, 12);
  ctx.fillRect(x - 6, y - 2, 12, 4);
}

function drawBullet(b) {
  const x = b.x - camera.x;
  const y = b.y - camera.y;

  if (b.type === "flame") {
    // flame effect
    b.r *= 1.05; // Make flames grow
    const alpha = Math.max(0, b.life * 2);
    ctx.fillStyle = `rgba(255, ${60 + Math.random() * 80}, 0, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, b.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(255, 200, 0, ${alpha * 0.5})`;
    ctx.beginPath();
    ctx.arc(x, y, b.r * 0.6, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // normal bullet
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(x, y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.92;
    p.vy *= 0.92;
    p.life -= dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
    }
  }
}

function drawParticles() {
  for (const p of particles) {
    const x = p.x - camera.x;
    const y = p.y - camera.y;
    if (x < -20 || x > canvas.width + 20 || y < -20 || y > canvas.height + 20) continue;

    if (p.type === "shell") {
      ctx.fillStyle = `rgba(218, 165, 32, ${Math.min(p.life, 1)})`;
      ctx.fillRect(x, y, 3, 2);
    } else if (p.type === "blood") {
      ctx.fillStyle = `rgba(180, 20, 20, ${p.life * 2})`;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawWorld() {
  const layers = [];
  for (const b of buildings) layers.push({ y: b.y + b.h, fn: () => drawBuilding(b) });
  for (const p of props) layers.push({ y: p.y, fn: () => drawCourtyardProp(p) });
  for (const m of medipacks) if (!m.taken) layers.push({ y: m.y, fn: () => drawMedipack(m) });
  for (const z of zombies) if (z.alive) layers.push({ y: z.y, fn: () => drawZombie(z) });
  layers.push({ y: player.y + 1, fn: drawPlayer });

  layers.sort((a, b) => a.y - b.y);
  for (const l of layers) l.fn();

  drawParticles();

  for (const b of bullets) drawBullet(b);
}

function drawOverlay() {
  ctx.fillStyle = "rgba(12, 16, 10, 0.56)";
  ctx.fillRect(16, canvas.height - 84, 240, 14);
  ctx.fillRect(16, canvas.height - 60, 240, 14);

  ctx.fillStyle = "#ea6666";
  ctx.fillRect(16, canvas.height - 84, 240 * (player.health / 100), 14);
  ctx.fillStyle = "#79f7a8";
  ctx.fillRect(16, canvas.height - 60, 240 * (player.stamina / player.maxStamina), 14);

  ctx.fillStyle = "#ffffff";
  ctx.font = "13px Segoe UI";
  ctx.fillText("Leben", 16, canvas.height - 89);
  ctx.fillText("Ausdauer", 16, canvas.height - 65);

  const w = player.weapons[player.currentWeapon];
  const ammoText = player.reloadTime > 0
    ? `Nachladen... ${Math.ceil(player.reloadTime * 10) / 10}s`
    : `${w.name}: ${w.ammo}/${w.reserveAmmo}`;

  ctx.fillStyle = "rgba(12,16,10,0.62)";
  ctx.fillRect(canvas.width - 250, canvas.height - 52, 234, 36);
  ctx.fillStyle = "#f2f2f2";
  ctx.font = "700 18px Segoe UI";
  ctx.fillText(ammoText, canvas.width - 240, canvas.height - 28);

  if (player.hitCooldown > 0) {
    ctx.fillStyle = `rgba(255,50,50,${player.hitCooldown * 0.38})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function drawMinimap() {
  const w = 174;
  const h = 108;
  const x = canvas.width - w - 14;
  const y = 14;

  const sx = w / world.width;
  const sy = h / world.height;

  ctx.fillStyle = "rgba(12,16,10,0.74)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.strokeRect(x, y, w, h);

  ctx.fillStyle = "#4a525a";
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);

  ctx.fillStyle = "#495059";
  for (const b of buildings) {
    ctx.fillRect(x + b.x * sx, y + b.y * sy, Math.max(1, b.w * sx), Math.max(1, b.h * sy));
  }

  ctx.fillStyle = "#d84d4d";
  for (const z of zombies) {
    if (!z.alive) continue;
    if (z.type === "boss") {
      ctx.fillStyle = "#b45aff";
      ctx.fillRect(x + z.x * sx - 2, y + z.y * sy - 2, 5, 5);
      ctx.fillStyle = "#d84d4d";
    } else {
      ctx.fillRect(x + z.x * sx - 1, y + z.y * sy - 1, 3, 3);
    }
  }

  ctx.fillStyle = "#f3f3f3";
  for (const m of medipacks) if (!m.taken) ctx.fillRect(x + m.x * sx - 1, y + m.y * sy - 1, 2, 2);

  ctx.fillStyle = "#f5f7ff";
  ctx.fillRect(x + player.x * sx - 2, y + player.y * sy - 2, 4, 4);
}

function drawGameOver() {
  ctx.fillStyle = "rgba(0,0,0,0.52)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#ffffff";
  ctx.font = "700 54px Segoe UI";
  ctx.textAlign = "center";
  ctx.fillText("DU BIST GEFALLEN", canvas.width / 2, canvas.height / 2 - 18);
  ctx.font = "600 24px Segoe UI";
  ctx.fillText("Druecke N fuer Neustart", canvas.width / 2, canvas.height / 2 + 22);
  ctx.textAlign = "left";

  const restartBtn = document.getElementById("btnRestart");
  if (restartBtn && restartBtn.style.display === "none") {
    restartBtn.style.display = "flex";
  }
}

function updateStats() {
  const alive = zombies.filter((z) => z.alive).length;
  const remaining = Math.max(waveTarget - waveSpawned, 0) + alive;
  const bossAlive = zombies.some((z) => z.alive && z.type === "boss") ? " | Boss: Ja" : "";
  stats.textContent = `Leben: ${Math.round(player.health)} | Wave: ${wave} | Zombies: ${alive}/${remaining}${bossAlive} | Score: ${player.score}`;
}

startWave(wave);

let prev = performance.now();
function loop(ts) {
  const dt = Math.min((ts - prev) / 1000, 0.033);
  prev = ts;
  timeNow = ts;

  if (!gameOver) {
    updatePlayer(dt);
    updateBullets(dt);
    updateParticles(dt);
    updateMedipacks();
    updateZombies(dt);
    maybeStartNextWave(dt);
    updateCamera(dt);
    if (player.health <= 0) gameOver = true;
  } else {
    updateCamera(dt);
  }

  drawSkyGround();
  drawWorld();
  drawOverlay();
  drawMinimap();
  if (gameOver) drawGameOver();
  updateStats();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
