// MODULE INDEX (game.js)
// MODULE 1: Config
// MODULE 2: Style
// MODULE 3: State
// MODULE 4: Input
// MODULE 5: Helpers
// MODULE 6: Spawning & Cap (time-based)
// MODULE 7: AI (evasion)
// MODULE 8: Update (drain, catch-all regen, time cap)
// MODULE 9: Render (score, HP, targets info, game over)
// MODULE 10: Loop/Boot

(function(){
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // ---------------------------
  // MODULE 1: Config
  // ---------------------------
  const CFG = {
    PLAYER_SIZE: 24,
    PLAYER_SPEED: 240,

    TARGET_SIZE: 24,
    TARGET_MAX_SPEED: 220,
    TARGET_MAX_ACCEL: 600,
    JUKE_STRENGTH: 0.8,
    JITTER: 0.35,

    HEALTH_MAX: 100,
    HEALTH_DECAY_PER_SEC: 8,
    HEALTH_REFILL_ON_CLEAR: 100, // full heal on clearing all current cubes

    TIME_STEP_SEC: 30 // every 30s, cap += 1 (1→2→3…)
  };

  // ---------------------------
  // MODULE 2: Style
  // ---------------------------
  const STYLE = {
    PLAYER: '#fbbf24',
    TARGET: '#60a5fa',
    BORDER: '#e6eef7',
    TEXT:   '#e6eef7',
    SCORE_FONT: '16px system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial',
    HP_BG:  '#273646',
    HP_OK:  '#86efac',
    HP_LOW: '#fca5a5',
    HP_BORDER: '#1e2a36'
  };

  // ---------------------------
  // MODULE 3: State
  // ---------------------------
  const player = { x: 120, y: 120, w: CFG.PLAYER_SIZE, h: CFG.PLAYER_SIZE, speed: CFG.PLAYER_SPEED };
  const keys = new Set();
  let score = 0;
  let hp = CFG.HEALTH_MAX;
  let alive = true;

  let elapsed = 0;       // seconds since run start
  let targets = [];      // active cubes

  // ---------------------------
  // MODULE 4: Input
  // ---------------------------
  function mapKey(code){
    switch(code){
      case 'KeyW': case 'ArrowUp':    return 'up';
      case 'KeyS': case 'ArrowDown':  return 'down';
      case 'KeyA': case 'ArrowLeft':  return 'left';
      case 'KeyD': case 'ArrowRight': return 'right';
      case 'Space':                   return 'space';
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
    if (dx || dy){ const l = Math.hypot(dx,dy) || 1; dx/=l; dy/=l; }
    return {dx, dy};
  }

  // ---------------------------
  // MODULE 5: Helpers
  // ---------------------------
  function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
  function rectsOverlap(a,b){
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function len(x,y){return Math.hypot(x,y)||1;}
  function norm(x,y){const l=len(x,y); return {x:x/l,y:y/l};}

  // ---------------------------
  // MODULE 6: Spawning & Cap (time-based)
  // ---------------------------
  function makeTarget(){
    const w=CFG.TARGET_SIZE, h=CFG.TARGET_SIZE;
    return {
      x: Math.random() * (canvas.width  - w),
      y: Math.random() * (canvas.height - h),
      w, h,
      vx:0, vy:0
    };
  }

  function spawnAvoidingPlayer(){
    const w=CFG.TARGET_SIZE, h=CFG.TARGET_SIZE;
    for(let i=0;i<20;i++){
      const t = makeTarget();
      if (!rectsOverlap(player, t)) return t;
    }
    // fallback
    return { x: canvas.width-w-10, y: canvas.height-h-10, w, h, vx:0, vy:0 };
  }

  function targetCap(){
    return 1 + Math.floor(elapsed / CFG.TIME_STEP_SEC);
  }

  function ensureCap(){
    const cap = targetCap();
    while (targets.length < cap){
      targets.push(spawnAvoidingPlayer());
    }
  }

// MODULE 7: AI (evasion)
// Less predictable: occasional fast turns ("zigs"), light wandering when far,
// separation so they don't bunch, and wall-slide if pinned.
function updateTargetAI(t, dt){
  // --- local knobs (tune here)
  const SEP_RADIUS   = 80;     // how far they repel each other
  const SEP_FORCE    = 0.8;    // strength of that repulsion
  const WANDER_FREQ  = 1.2;    // lower = more frequent small direction shifts
  const WANDER_STRENGTH = 0.6; // magnitude of those shifts
  const ZIG_DIST     = 220;    // start a quick turn if you're within this distance
  const ZIG_TIME     = 0.18;   // seconds per zig burst
  const ZIG_COOLDOWN = 0.9;    // minimal cooldown between zigs
  const ZIG_FORCE    = 1.35;   // how strong the zig lateral shove is
  const SLIDE_FORCE  = 1.0;    // bias along walls when near them

  // init one-time fields
  if (t.zigTime === undefined){
    t.zigTime = 0;
    t.zigCooldown = 0;
    t.wanderPhase = Math.random() * Math.PI * 2;
    t.wanderTimer = 0;
    t.lastSteerX = 0; t.lastSteerY = 0; // for smoothing
  }

  // centers
  const cx = t.x + t.w/2, cy = t.y + t.h/2;
  const px = player.x + player.w/2, py = player.y + player.h/2;

  // --- base flee + mild strafe (but not 100% away every frame)
  const toX = px - cx, toY = py - cy;
  const d   = Math.hypot(toX, toY) || 1;
  const awayX = -toX / d, awayY = -toY / d;
  const sideX = -awayY, sideY = awayX;

  // Start with a softer flee (so they don't beeline to the opposite corner)
  let steerX = awayX * 0.8 + sideX * (CFG.JUKE_STRENGTH * 0.6);
  let steerY = awayY * 0.8 + sideY * (CFG.JUKE_STRENGTH * 0.6);

  // --- separation: push away from nearby targets (de-bunch)
  let sepX = 0, sepY = 0;
  for (let i = 0; i < targets.length; i++){
    const o = targets[i]; if (o === t) continue;
    const dx = (cx - (o.x + o.w/2)), dy = (cy - (o.y + o.h/2));
    const dist = Math.hypot(dx, dy);
    if (dist > 0 && dist < SEP_RADIUS){
      const s = (SEP_RADIUS - dist) / SEP_RADIUS;
      sepX += (dx / dist) * s;
      sepY += (dy / dist) * s;
    }
  }
  if (sepX || sepY){
    const l = Math.hypot(sepX, sepY) || 1;
    steerX += (sepX / l) * SEP_FORCE;
    steerY += (sepY / l) * SEP_FORCE;
  }

  // --- wall-slide: if hugging a wall, bias along it away from player
  const nearLeft   = t.x < 12, nearRight = t.x > canvas.width - t.w - 12;
  const nearTop    = t.y < 12, nearBottom= t.y > canvas.height - t.h - 12;
  if (nearLeft || nearRight){
    // slide up/down such that distance from player increases
    steerY += (cy > py ? 1 : -1) * SLIDE_FORCE;
  }
  if (nearTop || nearBottom){
    // slide left/right such that distance from player increases
    steerX += (cx > px ? 1 : -1) * SLIDE_FORCE;
  }

  // --- WANDER: small, slow heading changes when far so paths aren't straight
  t.wanderTimer -= dt;
  if (t.wanderTimer <= 0){
    t.wanderTimer = WANDER_FREQ + Math.random() * 0.6; // jitter the frequency
    t.wanderPhase += (Math.random() - 0.5) * 1.2;
  }
  const wanderX = Math.cos(t.wanderPhase) * WANDER_STRENGTH * (d > ZIG_DIST ? 1 : 0.4);
  const wanderY = Math.sin(t.wanderPhase) * WANDER_STRENGTH * (d > ZIG_DIST ? 1 : 0.4);
  steerX += wanderX; steerY += wanderY;

  // --- ZIG: quick lateral burst when you're close (fast turn / direction swap)
  t.zigCooldown = Math.max(0, t.zigCooldown - dt);
  t.zigTime     = Math.max(0, t.zigTime - dt);

  if (d < ZIG_DIST && t.zigCooldown === 0 && t.zigTime === 0){
    // pick a lateral direction that doesn't push straight into a nearby wall
    const leftSpace  = cx > canvas.width * 0.33;
    const rightSpace = cx < canvas.width * 0.66;
    const upSpace    = cy > canvas.height * 0.33;
    const downSpace  = cy < canvas.height * 0.66;

    // two options: +side or -side; choose the one with more space
    const opt1 = { x: sideX,  y: sideY };
    const opt2 = { x: -sideX, y: -sideY };
    const favor1 = (opt1.x < 0 ? leftSpace : rightSpace) + (opt1.y < 0 ? upSpace : downSpace);
    const favor2 = (opt2.x < 0 ? leftSpace : rightSpace) + (opt2.y < 0 ? upSpace : downSpace);
    t.zigDirX = favor1 >= favor2 ? opt1.x : opt2.x;
    t.zigDirY = favor1 >= favor2 ? opt1.y : opt2.y;

    t.zigTime = ZIG_TIME;
    t.zigCooldown = ZIG_COOLDOWN + Math.random()*0.4; // slight randomness
  }

  if (t.zigTime > 0){
    steerX += t.zigDirX * ZIG_FORCE;
    steerY += t.zigDirY * ZIG_FORCE;
  }

  // --- tiny randomness so they don't loop perfectly
  steerX += (Math.random() - 0.5) * CFG.JITTER;
  steerY += (Math.random() - 0.5) * CFG.JITTER;

  // --- accelerate toward steer, with a touch of smoothing to avoid twitch
  const sL = Math.hypot(steerX, steerY) || 1;
  let ax = (steerX / sL), ay = (steerY / sL);
  // blend with previous frame's steer for smoother headings
  const SMOOTH = 0.65;
  ax = ax * (1 - SMOOTH) + (t.lastSteerX || 0) * SMOOTH;
  ay = ay * (1 - SMOOTH) + (t.lastSteerY || 0) * SMOOTH;
  t.lastSteerX = ax; t.lastSteerY = ay;

  t.vx += ax * CFG.TARGET_MAX_ACCEL * dt;
  t.vy += ay * CFG.TARGET_MAX_ACCEL * dt;

  // cap speed
  const vL = Math.hypot(t.vx, t.vy) || 1;
  if (vL > CFG.TARGET_MAX_SPEED){
    t.vx = (t.vx / vL) * CFG.TARGET_MAX_SPEED;
    t.vy = (t.vy / vL) * CFG.TARGET_MAX_SPEED;
  }

  // move
  t.x += t.vx * dt; t.y += t.vy * dt;

  // contain + soft bounce
  if (t.x < 0){ t.x = 0; t.vx = Math.abs(t.vx) * 0.7; }
  if (t.y < 0){ t.y = 0; t.vy = Math.abs(t.vy) * 0.7; }
  if (t.x > canvas.width - t.w){ t.x = canvas.width - t.w; t.vx = -Math.abs(t.vx) * 0.7; }
  if (t.y > canvas.height - t.h){ t.y = canvas.height - t.h; t.vy = -Math.abs(t.vy) * 0.7; }
}



// MODULE 8: Update (drain, catch-all regen, time cap)
function restart(){
  score = 0;
  hp = CFG.HEALTH_MAX;
  alive = true;
  elapsed = 0;
  targets.length = 0;
  // spawn to current cap at start (1)
  const cap = targetCap();
  while (targets.length < cap) targets.push(spawnAvoidingPlayer());
}

function update(dt){
  if (!alive){
    if (keys.has('space')) restart();
    return;
  }

  elapsed += dt;

  // health drain
  hp -= CFG.HEALTH_DECAY_PER_SEC * dt;
  hp = clamp(hp, 0, CFG.HEALTH_MAX);
  if (hp <= 0){ alive = false; return; }

  // player movement
  const dir = readInput();
  player.x += dir.dx * player.speed * dt;
  player.y += dir.dy * player.speed * dt;
  player.x = clamp(player.x, 0, canvas.width  - player.w);
  player.y = clamp(player.y, 0, canvas.height - player.h);

  // update targets + collect
  for (let i = targets.length - 1; i >= 0; i--){
    const t = targets[i];
    updateTargetAI(t, dt);
    if (rectsOverlap(player, t)){
      score += 1;
      targets.splice(i, 1);
    }
  }

  // ✅ Only when ALL current cubes are cleared:
  if (targets.length === 0){
    // regen health
    hp = clamp(hp + CFG.HEALTH_REFILL_ON_CLEAR, 0, CFG.HEALTH_MAX);
    // spawn up to current time-based cap
    const cap = targetCap();
    while (targets.length < cap) targets.push(spawnAvoidingPlayer());
  }

  // ⛔️ No unconditional "ensureCap()" here — that was causing mid-wave respawns.
}


// MODULE 9: Render (score, HP, targets info, game over)
function drawHealth(){
  const pad = 12, barW = canvas.width - pad*2, barH = 12, x = pad, y = 44;
  ctx.fillStyle = STYLE.HP_BG; ctx.fillRect(x, y, barW, barH);
  const pct = hp / CFG.HEALTH_MAX;
  ctx.fillStyle = (pct < 0.3) ? STYLE.HP_LOW : STYLE.HP_OK;
  ctx.fillRect(x, y, barW * pct, barH);
  ctx.strokeStyle = STYLE.HP_BORDER; ctx.strokeRect(x + 0.5, y + 0.5, barW - 1, barH - 1);
}

function render(){
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // border
  ctx.strokeStyle = STYLE.BORDER; ctx.lineWidth = 2;
  ctx.strokeRect(1,1,canvas.width-2,canvas.height-2);

  // left HUD: score
  ctx.fillStyle = STYLE.TEXT;
  ctx.font = STYLE.SCORE_FONT;
  ctx.textAlign = 'left';
  ctx.fillText(`Score: ${score}`, 12, 22);

  // right HUD: targets
  const cap = targetCap();
  ctx.textAlign = 'right';
  ctx.fillText(`Targets: ${targets.length}/${cap}`, canvas.width - 12, 22);
  ctx.textAlign = 'left'; // restore default for other text

  // health bar
  drawHealth();

  // targets
  ctx.fillStyle = STYLE.TARGET;
  targets.forEach(t => ctx.fillRect(t.x, t.y, t.w, t.h));

  // player
  ctx.fillStyle = STYLE.PLAYER;
  ctx.fillRect(player.x, player.y, player.w, player.h);

  // game over
  if (!alive){
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = STYLE.TEXT;
    ctx.font = '24px system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial';
    ctx.fillText('Game Over', 12, 100);
    ctx.font = '16px system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial';
    ctx.fillText('Press Space to restart', 12, 130);
  }
}


  // ---------------------------
  // MODULE 10: Loop/Boot
  // ---------------------------
  let last = performance.now();
  function frame(t){
    const dt = Math.min(0.033, (t - last)/1000); last = t;
    update(dt); render(); requestAnimationFrame(frame);
  }
  function boot(){ restart(); requestAnimationFrame(frame); }
  boot();
})();
