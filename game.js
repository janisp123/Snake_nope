// Minimal cube collector: one player cube, one target cube.
// Plain JS (no modules). Extra-robust key handling + FPS on screen.

(function(){
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const hud = document.getElementById('hud');

  // ensure focus so keys work
  setTimeout(() => canvas.focus(), 0);
  canvas.addEventListener('pointerdown', () => canvas.focus());

  // --- State
  const player = { x: 100, y: 100, w: 24, h: 24, speed: 220 }; // px/sec
  let target = { x: 420, y: 300, w: 24, h: 24 };                // null after collected
  const keys = new Set();

  // --- Input (listen everywhere)
  function mapKey(code){
    switch(code){
      case 'KeyW': case 'ArrowUp':    return 'up';
      case 'KeyS': case 'ArrowDown':  return 'down';
      case 'KeyA': case 'ArrowLeft':  return 'left';
      case 'KeyD': case 'ArrowRight': return 'right';
      default: return null;
    }
  }
  const onDown = (e) => { const k = mapKey(e.code); if (k) { keys.add(k); e.preventDefault(); } };
  const onUp   = (e) => { const k = mapKey(e.code); if (k) { keys.delete(k); e.preventDefault(); } };
  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);
  document.addEventListener('keydown', onDown);
  document.addEventListener('keyup', onUp);
  canvas.addEventListener('keydown', onDown);
  canvas.addEventListener('keyup', onUp);

  // --- Loop
  let last = performance.now();
  let fpsAccum = 0, frames = 0, fps = 0;

  function frame(t){
    const dt = Math.min(0.033, (t - last)/1000); // clamp ~30ms
    last = t;

    update(dt);
    render();

    // fps display
    fpsAccum += dt; frames++;
    if (fpsAccum >= 0.5) { // update twice a second
      fps = Math.round(frames / fpsAccum);
      hud.textContent = `fps: ${fps}`;
      fpsAccum = 0; frames = 0;
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // --- Update
  function update(dt){
    let dx = 0, dy = 0;
    if (keys.has('up')) dy -= 1;
    if (keys.has('down')) dy += 1;
    if (keys.has('left')) dx -= 1;
    if (keys.has('right')) dx += 1;

    if (dx !== 0 || dy !== 0){
      const len = Math.hypot(dx, dy) || 1; // normalize diagonal
      dx /= len; dy /= len;
      player.x += dx * player.speed * dt;
      player.y += dy * player.speed * dt;
    }

    // keep inside canvas
    player.x = Math.max(0, Math.min(canvas.width  - player.w, player.x));
    player.y = Math.max(0, Math.min(canvas.height - player.h, player.y));

    // collision with target
    if (target && rectsOverlap(player, target)){
      target = null; // vanish on touch
    }
  }

  function rectsOverlap(a, b){
    return a.x < b.x + b.w &&
           a.x + a.w > b.x &&
           a.y < b.y + b.h &&
           a.y + a.h > b.y;
  }

  // --- Render
  function render(){
    ctx.clearRect(0,0,canvas.width, canvas.height);

    // border
    ctx.strokeStyle = '#e6eef7';
    ctx.lineWidth = 2;
    ctx.strokeRect(1,1,canvas.width-2, canvas.height-2);

    // target (if present)
    if (target){
      ctx.fillStyle = '#60a5fa';      // blue target
      ctx.fillRect(target.x, target.y, target.w, target.h);
    } else {
      ctx.fillStyle = '#86efac';      // green "collected" text
      ctx.font = '16px system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial';
      ctx.fillText('Collected!', 12, 22);
    }

    // player
    ctx.fillStyle = '#fbbf24';        // yellow player
    ctx.fillRect(player.x, player.y, player.w, player.h);
  }
})();
