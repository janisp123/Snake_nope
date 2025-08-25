// MODULE INDEX (game.js)
// MODULE 1: Config          (sizes, speeds, target count, AI knobs)
// MODULE 2: Style           (colors, font)
// MODULE 3: State           (player, targets, score, keys)
// MODULE 4: Input           (WASD/Arrows → normalized direction)
// MODULE 5: Helpers         (math + overlap)
// MODULE 6: Spawn           (spawn N targets; respawn on catch)
// MODULE 7: AI              (evasion: keep distance, strafe, walls, dash)
// MODULE 8: Update          (move player/targets, collisions, score)
// MODULE 9: Render          (border, score, draw)
// MODULE 10: Loop/Boot      (RAF + fps HUD)

// ---------------------------wwa
// MODULE 1: Config
// ---------------------------
const CFG = {
  CANVAS_W: 640,
  CANVAS_H: 480,
  PLAYER_SIZE: 24,
  PLAYER_SPEED: 150,
  TARGET_SIZE: 24,
  TARGET_COUNT: 1,      // <— amount of targets on screen
  // AI tuning
  TARGET_BASE_SPEED: 110,
  TARGET_MAX_SPEED: 220,
  TARGET_MAX_ACCEL: 600,
  DESIRED_DIST: 140,
  THREAT_DIST: 120,
  WALL_PAD: 32,
  JUKE_STRENGTH: 0.8,
  JITTER: 0.4,
  DASH_TIME: 5,
  DASH_COOLDOWN: 9.0,
  SCORE_SPEED_BOOST: 0.06, // speed scales a bit with score
};

// ---------------------------
// MODULE 2: Style
// ---------------------------
const STYLE = {
  PLAYER: '#fbbf24',  // yellow
  TARGET: '#60a5fa',  // blue
  BORDER: '#e6eef7',
  TEXT:   '#e6eef7',
  SCORE_FONT: '16px system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial'
};

// ---------------------------
// MODULE 3: State
// ---------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');

canvas.width = CFG.CANVAS_W;
canvas.height = CFG.CANVAS_H;

const player = { x: 120, y: 120, w: CFG.PLAYER_SIZE, h: CFG.PLAYER_SIZE, speed: CFG.PLAYER_SPEED };
let targets = [];
let score = 0;
const keys = new Set();

// ---------------------------
// MODULE 4: Input
// ---------------------------
function mapKey(code){
  switch(code){
    case 'KeyW': case 'ArrowUp':    return 'up';
    case 'KeyS': case 'ArrowDown':  return 'down';
    case 'KeyA': case 'ArrowLeft':  return 'left';
    case 'KeyD': case 'ArrowRight': return 'right';
    default: return null;
  }
}
document.addEventListener('keydown', e => { const k = mapKey(e.code); if (k){ keys.add(k); e.preventDefault(); }});
document.addEventListener('keyup',   e => { const k = mapKey(e.code); if (k){ keys.delete(k); e.preventDefault(); }});

function readInput(){
  let dx=0, dy=0;
  if (keys.has('up')) dy -= 1;
  if (keys.has('down')) dy += 1;
  if (keys.has('left')) dx -= 1;
  if (keys.has('right')) dx += 1;
  if (dx || dy){
    const l = Math.hypot(dx,dy) || 1;
    dx /= l; dy /= l;
  }
  return {dx, dy};
}

// ---------------------------
// MODULE 5: Helpers
// ---------------------------
function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
function rectsOverlap(a, b){
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function len(x,y){ return Math.hypot(x,y) || 1; }
function norm(x,y){ const l = len(x,y); return {x:x/l, y:y/l}; }
function perpendicular(x,y){ return {x:-y, y:x}; }
function centerX(r){ return r.x + r.w/2; }
function centerY(r){ return r.y + r.h/2; }

// ---------------------------
// MODULE 6: Spawn
// ---------------------------
function spawnOneTarget(avoidRect){
  const w = CFG.TARGET_SIZE, h = CFG.TARGET_SIZE;
  // try to avoid spawning on player
  for (let i = 0; i < 20; i++){
    const x = Math.random() * (CFG.CANVAS_W - w);
    const y = Math.random() * (CFG.CANVAS_H - h);
    const t = {
      x, y, w, h,
      vx: 0, vy: 0,
      // per-target tuning (can be adjusted at runtime if you want)
      baseSpeed: CFG.TARGET_BASE_SPEED,
      maxSpeed:  CFG.TARGET_MAX_SPEED,
      maxAccel:  CFG.TARGET_MAX_ACCEL,
      desiredDist: CFG.DESIRED_DIST,
      threatDist:  CFG.THREAT_DIST,
      wallPad:     CFG.WALL_PAD,
      jukeStrength: CFG.JUKE_STRENGTH,
      jitter:       CFG.JITTER,
      dashCooldown: 0,
      dashTime:     0
    };
    if (!rectsOverlap(avoidRect, t)) return t;
  }
  // fallback
  return { x: CFG.CANVAS_W - w - 10, y: CFG.CANVAS_H - h - 10, w, h, vx:0, vy:0,
    baseSpeed: CFG.TARGET_BASE_SPEED, maxSpeed: CFG.TARGET_MAX_SPEED, maxAccel: CFG.TARGET_MAX_ACCEL,
    desiredDist: CFG.DESIRED_DIST, threatDist: CFG.THREAT_DIST, wallPad: CFG.WALL_PAD,
    jukeStrength: CFG.JUKE_STRENGTH, jitter: CFG.JITTER, dashCooldown: 0, dashTime: 0
  };
}

function ensureTargetCount(){
  while (targets.length < CFG.TARGET_COUNT){
    targets.push(spawnOneTarget(player));
  }
}

// ---------------------------
// MODULE 7: AI (evasion)
// ---------------------------
function updateTargetAI(t, dt){
  const difficultyBoost = Math.min(1, score * CFG.SCORE_SPEED_BOOST); // up to +100% * 0.06 = +60%
  const wantSpeed = t.baseSpeed * (1 + 0.6 * difficultyBoost);

  const cx = centerX(t), cy = centerY(t);
  const px = centerX(player), py = centerY(player);

  const toPlayer = { x: px - cx, y: py - cy };
  const away = norm(-toPlayer.x, -toPlayer.y);
  const dist = len(toPlayer.x, toPlayer.y);

  // Flee weight scales down when far
  let fleeWeight = 1.0;
  if (dist > t.desiredDist) fleeWeight = 0.4 * (t.desiredDist / dist);

  // Strafe (sideways oscillation)
  const side = perpendicular(away.x, away.y);
  const osc = Math.sin(performance.now() * 0.005 + score);
  const strafe = { x: side.x * osc, y: side.y * osc };

  // Wall avoidance
  let wall = {x:0, y:0};
  if (cx < t.wallPad) wall.x += 1;
  if (cy < t.wallPad) wall.y += 1;
  if (cx > CFG.CANVAS_W  - t.wallPad) wall.x -= 1;
  if (cy > CFG.CANVAS_H - t.wallPad) wall.y -= 1;
  if (wall.x || wall.y) wall = norm(wall.x, wall.y);

  // Panic dash
  t.dashCooldown = Math.max(0, t.dashCooldown - dt);
  t.dashTime     = Math.max(0, t.dashTime - dt);
  if (dist < t.threatDist && t.dashCooldown === 0) {
    t.dashTime = CFG.DASH_TIME;
    t.dashCooldown = CFG.DASH_COOLDOWN;
  }
  const dashMult = t.dashTime > 0 ? 1.8 : 1.0;

  // Random jitter
  const jitter = { x: (Math.random()-0.5) * t.jitter, y: (Math.random()-0.5) * t.jitter };

  // Combine steering
  let steerX = away.x*fleeWeight + strafe.x*t.jukeStrength + wall.x*1.2 + jitter.x*0.6;
  let steerY = away.y*fleeWeight + strafe.y*t.jukeStrength + wall.y*1.2 + jitter.y*0.6;

  // Acceleration
  const s = norm(steerX, steerY);
  const ax = s.x * t.maxAccel * dt;
  const ay = s.y * t.maxAccel * dt;

  // Integrate velocity
  t.vx += ax; t.vy += ay;

  // Cap speed near wantSpeed (scaled by dash)
  const vlen = len(t.vx, t.vy);
  const cap = Math.min(t.maxSpeed, wantSpeed * dashMult);
  if (vlen > cap){
    const u = { x: t.vx / vlen, y: t.vy / vlen };
    t.vx = u.x * cap; t.vy = u.y * cap;
  }

  // Move
  t.x += t.vx * dt; t.y += t.vy * dt;

  // Stay inside; soften bounce
  if (t.x < 0){ t.x = 0; t.vx = Math.abs(t.vx)*0.7; }
  if (t.y < 0){ t.y = 0; t.vy = Math.abs(t.vy)*0.7; }
  if (t.x > CFG.CANVAS_W - t.w){ t.x = CFG.CANVAS_W - t.w; t.vx = -Math.abs(t.vx)*0.7; }
  if (t.y > CFG.CANVAS_H - t.h){ t.y = CFG.CANVAS_H - t.h; t.vy = -Math.abs(t.vy)*0.7; }
}

// ---------------------------
// MODULE 8: Update
// ---------------------------
function update(dt){
  // player
  const dir = readInput();
  player.x += dir.dx * player.speed * dt;
  player.y += dir.dy * player.speed * dt;
  player.x = clamp(player.x, 0, CFG.CANVAS_W - player.w);
  player.y = clamp(player.y, 0, CFG.CANVAS_H - player.h);

  // targets
  for (let i = targets.length - 1; i >= 0; i--){
    const t = targets[i];
    updateTargetAI(t, dt);
    if (rectsOverlap(player, t)){
      // caught
      score += 1;
      targets.splice(i, 1);
    }
  }

  // keep count
  ensureTargetCount();
}

// ---------------------------
// MODULE 9: Render
// ---------------------------
function render(){
  ctx.clearRect(0,0,CFG.CANVAS_W, CFG.CANVAS_H);

  // border
  ctx.strokeStyle = STYLE.BORDER;
  ctx.lineWidth = 2;
  ctx.strokeRect(1,1,CFG.CANVAS_W-2,CFG.CANVAS_H-2);

  // score
  ctx.fillStyle = STYLE.TEXT;
  ctx.font = STYLE.SCORE_FONT;
  ctx.fillText(`Score: ${score}`, 12, 22);

  // targets
  ctx.fillStyle = STYLE.TARGET;
  targets.forEach(t => ctx.fillRect(t.x, t.y, t.w, t.h));

  // player
  ctx.fillStyle = STYLE.PLAYER;
  ctx.fillRect(player.x, player.y, player.w, player.h);
}

// ---------------------------
// MODULE 10: Loop/Boot
// ---------------------------
canvas.focus();
let last = performance.now(), acc=0, frames=0, fps=0;
function frame(t){
  const dt = Math.min(0.033, (t - last)/1000);
  last = t;
  update(dt);
  render();
  // fps hud
  acc += dt; frames++;
  if (acc >= 0.5){ fps = Math.round(frames/acc); hud.textContent = `fps: ${fps}`; acc=0; frames=0; }
  requestAnimationFrame(frame);
}

// boot
function boot(){
  targets = [];
  ensureTargetCount();
  requestAnimationFrame(frame);
}
boot();
