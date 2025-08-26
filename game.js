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

// MODULE 7.1: AI_CFG — knobs & switches (small, safe to tweak)
const AI_CFG = {
  SEP_RADIUS: 90,
  SEP_FORCE: 0.9,

  ORBIT_DIST: 260,
  ORBIT_FORCE: 0.85,

  WALL_REPEL_MARGIN: 60,
  SLIDE_FORCE: 1.15,

  // Jukes
  JUKE_CLOSE_DIST: 190,   // start thinking about juking here
  JUKE_TRIGGER_ANGLE: 0.85, // cos(theta). ~> player heading mostly at target
  JUKE_COOLDOWN: 1.1,
  JUKE_DURATION: 0.14,
  JUKE_PUSH: 1.65,

  // Anti-corner patrol
  CORNER_NEAR_EDGE: 12,
  PATROL_COOLDOWN: 1.6,
  PATROL_TIME: 0.5,
  PATROL_PUSH: 0.9,
  SAFE_BAND: 120, // “aim toward this band away from edges when idle”

  // Wander
  WANDER_T: 0.9,
  WANDER_MAG_FAR: 0.8,
  WANDER_MAG_NEAR: 0.35,

  // Misc
  PANIC_SPEED_UP: 1.12,
  JITTER: 0.28,
  SMOOTH: 0.6,
  LEAD: 0.22, // seconds predict player
};


// MODULE 7.2: AI_STATE — per-target lazy init + helpers
function aiInit(t){
  if (t._ai) return;
  t._ai = {
    wanderTimer: Math.random()*AI_CFG.WANDER_T,
    wanderPhase: Math.random()*Math.PI*2,
    lastSteerX: 0, lastSteerY: 0,

    // Juke
    jukeTime: 0,
    jukeCool: 0,
    jukeDirX: 0, jukeDirY: 0,

    // Patrol
    patrolTime: 0,
    patrolCool: 0,
    patrolDirX: 0, patrolDirY: 0,
  };
}

function aiPredictPlayer() {
  let dx=0, dy=0;
  if (typeof readInput === 'function'){
    const di = readInput(); dx = di.dx; dy = di.dy;
  }
  const px = (player.x + player.w/2) + dx * player.speed * AI_CFG.LEAD;
  const py = (player.y + player.h/2) + dy * player.speed * AI_CFG.LEAD;
  const hv = Math.hypot(dx,dy); // player heading magnitude (0..1)
  return {px, py, hx:dx, hy:dy, hv};
}

function aiNearEdges(t){
  const L = t.x < AI_CFG.CORNER_NEAR_EDGE;
  const R = t.x > canvas.width - t.w - AI_CFG.CORNER_NEAR_EDGE;
  const T = t.y < AI_CFG.CORNER_NEAR_EDGE;
  const B = t.y > canvas.height - t.h - AI_CFG.CORNER_NEAR_EDGE;
  return {L,R,T,B, inCorner: (L||R)&&(T||B)};
}


// MODULE 7.3: AI_STEER_BASE — flee/orbit + separation + walls
function aiSteerBase(t, pred){
  const {px, py} = pred;
  const cx = t.x + t.w/2, cy = t.y + t.h/2;
  const toX = px - cx, toY = py - cy;
  const d   = Math.hypot(toX, toY) || 1;

  const awayX = -toX/d, awayY = -toY/d;
  const tangX = -awayY,  tangY =  awayX;

  const near = Math.min(1, Math.max(0, (AI_CFG.ORBIT_DIST - d)/AI_CFG.ORBIT_DIST));
  let sx = awayX * (0.75 + 0.25*near) + tangX * (AI_CFG.ORBIT_FORCE * near);
  let sy = awayY * (0.75 + 0.25*near) + tangY * (AI_CFG.ORBIT_FORCE * near);

  // Separation
  let sepX=0, sepY=0;
  for (let i=0;i<targets.length;i++){
    const o = targets[i]; if (o===t) continue;
    const ox = o.x + o.w/2, oy = o.y + o.h/2;
    const dx = cx - ox, dy = cy - oy, dist = Math.hypot(dx,dy);
    if (dist>0 && dist<AI_CFG.SEP_RADIUS){
      const s = (AI_CFG.SEP_RADIUS - dist)/AI_CFG.SEP_RADIUS;
      sepX += (dx/dist)*s; sepY += (dy/dist)*s;
    }
  }
  if (sepX||sepY){
    const sl = Math.hypot(sepX,sepY)||1;
    sx += (sepX/sl)*AI_CFG.SEP_FORCE;
    sy += (sepY/sl)*AI_CFG.SEP_FORCE;
  }

  // Wall repel + slide
  const m = AI_CFG.WALL_REPEL_MARGIN;
  if (t.x < m)                                   sx += (cx > px ? 0.4 : 0.2);
  if (t.x > canvas.width - t.w - m)              sx += (cx < px ? -0.4 : -0.2);
  if (t.y < m)                                   sy += (cy > py ? 0.4 : 0.2);
  if (t.y > canvas.height - t.h - m)             sy += (cy < py ? -0.4 : -0.2);
  const edge = aiNearEdges(t);
  if (edge.L || edge.R) sy += (cy > py ? 1 : -1) * AI_CFG.SLIDE_FORCE;
  if (edge.T || edge.B) sx += (cx > px ? 1 : -1) * AI_CFG.SLIDE_FORCE;

  return {sx, sy, d, cx, cy};
}


// MODULE 7.4: AI_JUKE — timed lateral bursts when player bears down
function aiApplyJuke(t, base, pred, dt){
  const s = t._ai;
  // cooldown timers
  s.jukeCool = Math.max(0, s.jukeCool - dt);
  s.jukeTime = Math.max(0, s.jukeTime - dt);

  const {px, py, hx, hy, hv} = pred;
  const {cx, cy, d} = base;

  // If already juking, apply ongoing push
  if (s.jukeTime > 0){
    base.sx += s.jukeDirX * AI_CFG.JUKE_PUSH;
    base.sy += s.jukeDirY * AI_CFG.JUKE_PUSH;
    return base;
  }

  // Consider starting a juke if close and player heading largely toward target
  if (d < AI_CFG.JUKE_CLOSE_DIST && s.jukeCool === 0 && hv > 0.3){
    const toTX = cx - (player.x + player.w/2);
    const toTY = cy - (player.y + player.h/2);
    const toTL = Math.hypot(toTX,toTY)||1;
    const nhx = hx/(Math.hypot(hx,hy)||1), nhy = hy/(Math.hypot(hx,hy)||1);
    const dot = ( (toTX/toTL)*nhx + (toTY/toTL)*nhy ); // cos(theta)

    if (dot > AI_CFG.JUKE_TRIGGER_ANGLE){
      // Choose lateral dir perpendicular to away vector
      const awayX = (cx - px) / (Math.hypot(cx-px, cy-py)||1);
      const awayY = (cy - py) / (Math.hypot(cx-px, cy-py)||1);
      // Two options: left/right
      const lx = -awayY, ly =  awayX;
      const rx =  awayY, ry = -awayX;

      // Pick the one that increases distance from predicted player point
      const sL = (cx + lx*40 - px)**2 + (cy + ly*40 - py)**2;
      const sR = (cx + rx*40 - px)**2 + (cy + ry*40 - py)**2;
      if (sL > sR){ s.jukeDirX = lx; s.jukeDirY = ly; }
      else        { s.jukeDirX = rx; s.jukeDirY = ry; }

      s.jukeTime = AI_CFG.JUKE_DURATION;
      s.jukeCool = AI_CFG.JUKE_COOLDOWN + Math.random()*0.4;
    }
  }
  return base;
}


  // MODULE 7.5: AI_PATROL — proactive anti-corner if player not near
  function aiApplyPatrol(t, base, pred, dt){
    const s = t._ai;
    s.patrolCool = Math.max(0, s.patrolCool - dt);
    s.patrolTime = Math.max(0, s.patrolTime - dt);

    const {cx, cy, d} = base;
    const edge = aiNearEdges(t);

    // If already patrolling, keep nudging off edges
    if (s.patrolTime > 0){
      base.sx += s.patrolDirX * AI_CFG.PATROL_PUSH;
      base.sy += s.patrolDirY * AI_CFG.PATROL_PUSH;
      return base;
    }

    // Only start patrol if player is NOT close and we are hugging a wall/corner
    const playerFar = d > AI_CFG.ORBIT_DIST * 0.9;
    const onEdge = edge.inCorner || edge.L || edge.R || edge.T || edge.B;

    if (playerFar && onEdge && s.patrolCool === 0){
      // Choose a “safer band” inside the arena
      const targetX = Math.min(
        canvas.width - AI_CFG.SAFE_BAND,
        Math.max(AI_CFG.SAFE_BAND, cx)
      );
      const targetY = Math.min(
        canvas.height - AI_CFG.SAFE_BAND,
        Math.max(AI_CFG.SAFE_BAND, cy)
      );

      // Bias away from the closer wall
      let dirX = Math.sign(targetX - cx);
      let dirY = Math.sign(targetY - cy);

      // Small tangential component so they don’t drift straight into you
      const tangX = -(pred.py - cy); // rotate by 90°
      const tangY =  (pred.px - cx);
      const tL = Math.hypot(tangX, tangY) || 1;
      dirX = 0.75*dirX + 0.25*(tangX/tL);
      dirY = 0.75*dirY + 0.25*(tangY/tL);
      const n = Math.hypot(dirX,dirY)||1;

      s.patrolDirX = dirX/n;
      s.patrolDirY = dirY/n;
      s.patrolTime = AI_CFG.PATROL_TIME;
      s.patrolCool = AI_CFG.PATROL_COOLDOWN + Math.random()*0.5;
    }

    return base;
  }


// MODULE 7.6: AI_INTEGRATE — smoothing, velocity, clamps
function aiIntegrate(t, base, dt){
  const s = t._ai;

  // Wander & jitter
  s.wanderTimer -= dt;
  if (s.wanderTimer <= 0){
    s.wanderTimer = AI_CFG.WANDER_T + Math.random()*0.6;
    s.wanderPhase += (Math.random()-0.5)*1.1;
  }
  const wanderMag = (base.d > AI_CFG.ORBIT_DIST ? AI_CFG.WANDER_MAG_FAR : AI_CFG.WANDER_MAG_NEAR);
  base.sx += Math.cos(s.wanderPhase)*wanderMag + (Math.random()-0.5)*AI_CFG.JITTER;
  base.sy += Math.sin(s.wanderPhase)*wanderMag + (Math.random()-0.5)*AI_CFG.JITTER;

  // Smooth steering
  const sl = Math.hypot(base.sx, base.sy)||1;
  let ax = base.sx/sl, ay = base.sy/sl;
  ax = ax*(1-AI_CFG.SMOOTH) + s.lastSteerX*AI_CFG.SMOOTH;
  ay = ay*(1-AI_CFG.SMOOTH) + s.lastSteerY*AI_CFG.SMOOTH;
  s.lastSteerX = ax; s.lastSteerY = ay;

  // Panic speed bump near player
  const panic = base.d < 150 ? AI_CFG.PANIC_SPEED_UP : 1.0;

  // Integrate vel
  t.vx += ax * CFG.TARGET_MAX_ACCEL * dt;
  t.vy += ay * CFG.TARGET_MAX_ACCEL * dt;

  // Clamp speed
  const maxV = CFG.TARGET_MAX_SPEED * panic;
  const vL = Math.hypot(t.vx, t.vy)||1;
  if (vL > maxV){ t.vx = (t.vx/vL)*maxV; t.vy = (t.vy/vL)*maxV; }

  // Move
  t.x += t.vx * dt; t.y += t.vy * dt;

  // Bounds with soft bounce
  if (t.x < 0){ t.x = 0; t.vx = Math.abs(t.vx)*0.7; }
  if (t.y < 0){ t.y = 0; t.vy = Math.abs(t.vy)*0.7; }
  if (t.x > canvas.width - t.w){ t.x = canvas.width - t.w; t.vx = -Math.abs(t.vx)*0.7; }
  if (t.y > canvas.height - t.h){ t.y = canvas.height - t.h; t.vy = -Math.abs(t.vy)*0.7; }
}


// ========================
// MODULE 7.7 PATCH: UPDATE
// ========================
// Replace your existing updateTargetAI body with this version so 7.8–7.11 are used.
// Keep the function name identical (your game loop already calls it).
function updateTargetAI(t, dt){
  aiInit(t);           // 7.2
  aiAssignSectors();   // 7.9 (no-op after first)

  // keep the heatmap rolling
  heatmapTick(dt);     // 7.10

  const pred = aiPredictPlayer();           // 7.2
  let base  = aiSteerBase(t, pred);         // 7.3

  // Player distance bands for “when to waste time”
  const playerFar = base.d > AI_CFG.ORBIT_DIST * 0.9;

  // New layers
  base = aiHeatmapBias(t, base);                    // 7.10
  base = aiApplyDispersion(t, base);                // 7.11
  base = aiSectorBias(t, base, playerFar, dt);      // 7.9

  // Existing behaviors
  base = aiApplyJuke(t, base, pred, dt);            // 7.4
  base = aiApplyPatrol(t, base, pred, dt);          // 7.5
  aiIntegrate(t, base, dt);                         // 7.6
}


// ===============================
// MODULE 7.8: DIFFICULTY_PROFILES
// ===============================
const AI_PROFILE = {
  // How much time-waste vs risk the AI aims for (tweak anytime)
  name: "TimeWaste_Default",
  HEATMAP_BIAS: 0.75,        // push away from your recent paths
  SECTOR_STICK: 0.55,        // tendency to drift toward own sector when you're far
  DISPERSION_MIN_SPACING: 110, // try to keep at least this px from neighbors near edges
  DISPERSION_EDGE_FAN: 0.9,  // push to fan-out when sharing an edge
  CORNER_IDLE_BUDGET: 0.6,   // (s) allowed near corner when player is far before leaving (7.13 will hard-enforce later)
  JUKE_STAGGER_MIN: 0.25,    // (s) min stagger between enemies juking
  JUKE_STAGGER_MAX: 0.55,    // (s) max stagger between enemies juking
  HEATMAP_CELL: 80,          // px size of heatmap cells
  HEATMAP_DECAY: 0.94,       // frame decay of heat
  HEATMAP_PLAYER_STAMP: 2.6, // heat added near your position per tick
  SECTOR_RING_RATIO: 0.34,   // sector “safe ring” radius vs arena min dimension
  SECTOR_ROT_SPEED: 0.06,    // (rad/sec) slow rotation of sector anchors
};

// =======================
// MODULE 7.9: SECTORS
// =======================
// Each enemy gets a "home sector" target that slowly rotates and sits on a safe ring
// inside the arena. When you're far, they drift toward this point to avoid clumping.

const _SECT = { assigned: false, t0: performance.now()/1000 };

function aiAssignSectors(){
  if (_SECT.assigned) return;
  _SECT.assigned = true;
  for (let i = 0; i < targets.length; i++){
    const t = targets[i];
    if (!t._ai) aiInit(t);
    t._ai.sectorIndex = i;  // simple index-based partition (stable across session)
  }
}

function aiSectorPointFor(t, timeSec){
  const idx = t._ai?.sectorIndex ?? 0;
  const N = Math.max(1, targets.length);
  // ring radius based on arena
  const arenaW = canvas.width, arenaH = canvas.height;
  const ring = Math.min(arenaW, arenaH) * AI_PROFILE.SECTOR_RING_RATIO;

  // center
  const cx = arenaW * 0.5, cy = arenaH * 0.5;

  // rotating slot angle
  const baseAngle = (idx / N) * Math.PI * 2;
  const rot = baseAngle + timeSec * AI_PROFILE.SECTOR_ROT_SPEED;

  return { x: cx + Math.cos(rot)*ring, y: cy + Math.sin(rot)*ring };
}

function aiSectorBias(t, base, playerFar, dt){
  // Only bias toward sector when player is far; keep it subtle
  if (!playerFar) return base;
  const now = performance.now()/1000 - _SECT.t0;
  const p = aiSectorPointFor(t, now);
  const toX = p.x - (t.x + t.w/2);
  const toY = p.y - (t.y + t.h/2);
  const L = Math.hypot(toX,toY) || 1;
  const gain = AI_PROFILE.SECTOR_STICK;
  base.sx += (toX/L) * gain;
  base.sy += (toY/L) * gain;
  return base;
}

// ========================
// MODULE 7.10: HEATMAP
// ========================
// Rolling grid of your recent positions. Enemies bias away from "hot" lanes
// so they don't ride the same edges/corners you just searched.

const _HEAT = {
  grid: null, cols: 0, rows: 0,
  lastW: 0, lastH: 0,
};

function heatmapInit(){
  const cell = AI_PROFILE.HEATMAP_CELL|0;
  if (!cell) return;
  const cols = Math.ceil(canvas.width / cell);
  const rows = Math.ceil(canvas.height / cell);
  _HEAT.cols = cols; _HEAT.rows = rows;
  _HEAT.grid = new Float32Array(cols * rows);
  _HEAT.lastW = canvas.width; _HEAT.lastH = canvas.height;
}

function heatmapEnsure(){
  if (!_HEAT.grid || _HEAT.lastW !== canvas.width || _HEAT.lastH !== canvas.height){
    heatmapInit();
  }
}

function heatmapIdx(x, y){
  const cell = AI_PROFILE.HEATMAP_CELL|0;
  const c = Math.min(_HEAT.cols-1, Math.max(0, Math.floor(x / cell)));
  const r = Math.min(_HEAT.rows-1, Math.max(0, Math.floor(y / cell)));
  return r * _HEAT.cols + c;
}

function heatmapTick(dt){
  heatmapEnsure();
  if (!_HEAT.grid) return;

  // Decay
  const g = _HEAT.grid;
  const decay = AI_PROFILE.HEATMAP_DECAY;
  for (let i=0;i<g.length;i++){ g[i] *= decay; }

  // Stamp player
  const px = player.x + player.w/2, py = player.y + player.h/2;
  const idx = heatmapIdx(px, py);
  g[idx] += AI_PROFILE.HEATMAP_PLAYER_STAMP;
}

function heatmapSample(x, y){
  heatmapEnsure();
  if (!_HEAT.grid) return 0;
  return _HEAT.grid[ heatmapIdx(x,y) ] || 0;
}

function aiHeatmapBias(t, base){
  if (!_HEAT.grid) return base;

  // Sample ahead and behind to approximate gradient
  const cx = t.x + t.w/2, cy = t.y + t.h/2;
  const s0 = heatmapSample(cx, cy);
  const sX = heatmapSample(cx + 24, cy) - heatmapSample(cx - 24, cy);
  const sY = heatmapSample(cy + 24, cx); // slight orthogonal smear
  // Bias away from hotter direction (negative gradient)
  base.sx += (-sX) * 0.02 * AI_PROFILE.HEATMAP_BIAS;
  base.sy += (-sY) * 0.02 * AI_PROFILE.HEATMAP_BIAS;
  return base;
}

// ===========================
// MODULE 7.11: DISPERSION
// ===========================
// Avoid clumping on same edge/corner. When multiple enemies are near the same
// edge, they "fan" into distinct lanes. Also encourages minimum spacing.

function aiApplyDispersion(t, base){
  const cx = t.x + t.w/2, cy = t.y + t.h/2;
  const nearEdge =
    (t.x < 12) || (t.y < 12) ||
    (t.x > canvas.width - t.w - 12) ||
    (t.y > canvas.height - t.h - 12);

  if (!nearEdge) return base;

  // Compute a simple lane vector along the closest edge
  let edgeVX = 0, edgeVY = 0;
  const dLeft   = t.x;
  const dRight  = canvas.width - (t.x + t.w);
  const dTop    = t.y;
  const dBottom = canvas.height - (t.y + t.h);
  const minD = Math.min(dLeft, dRight, dTop, dBottom);

  if (minD === dLeft || minD === dRight){
    // On vertical edge → lanes go along Y
    edgeVX = 0; edgeVY = 1;
  } else {
    // On horizontal edge → lanes go along X
    edgeVX = 1; edgeVY = 0;
  }

  // Push away from neighbors along tangential direction & enforce spacing
  let tangentPush = 0;
  let spaceX = 0, spaceY = 0;

  for (let i=0;i<targets.length;i++){
    const o = targets[i]; if (o===t) continue;
    const ox = o.x + o.w/2, oy = o.y + o.h/2;
    const dist = Math.hypot(cx-ox, cy-oy);
    if (dist < AI_PROFILE.DISPERSION_MIN_SPACING){
      // radial spacing push
      const dx = cx - ox, dy = cy - oy;
      const L = Math.hypot(dx,dy)||1;
      spaceX += (dx/L) * ((AI_PROFILE.DISPERSION_MIN_SPACING - dist)/AI_PROFILE.DISPERSION_MIN_SPACING);
      spaceY += (dy/L) * ((AI_PROFILE.DISPERSION_MIN_SPACING - dist)/AI_PROFILE.DISPERSION_MIN_SPACING);
    }

    // if both are near the same edge, fan out in opposite tangents
    const oNearEdge = (o.x < 12) || (o.y < 12) ||
      (o.x > canvas.width - o.w - 12) ||
      (o.y > canvas.height - o.h - 12);

    if (oNearEdge && nearEdge){
      // signed distance along tangent
      const along = ( (ox - cx) * edgeVX + (oy - cy) * edgeVY );
      tangentPush += Math.sign(along || (Math.random()-0.5));
    }
  }

  base.sx += (spaceX) * 1.0 + (edgeVX * tangentPush * AI_PROFILE.DISPERSION_EDGE_FAN);
  base.sy += (spaceY) * 1.0 + (edgeVY * tangentPush * AI_PROFILE.DISPERSION_EDGE_FAN);

  return base;
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
