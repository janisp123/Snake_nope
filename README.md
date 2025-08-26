# Cube Collector

A minimal browser game made with vanilla JavaScript + Canvas.  
You control a yellow cube, chase the blue cubes, and survive as long as you can.

---

## 🎮 How to Play
- Open **`index.html`** in a modern browser (no install needed).
- Move with **WASD** or **Arrow keys**.
- Blue cubes run away with evasive AI (they strafe, juke, and spread apart).
- Every **30 seconds**, the maximum number of active cubes increases by +1.
- Your **health bar** slowly drains over time.
- **Clear all cubes** on screen to refill health and reset the board to the current cap.
- If health reaches zero → **Game Over** (press Space to restart).

---

## ⚙️ Features
- **Health bar** that decays over time and refills only after clearing all active cubes.
- **Time-based difficulty**: more cubes appear as time goes on (1 → 2 → 3…).
- **AI with behavior**:
  - Flee and strafe rather than run in a straight line.
  - Separation so they don’t clump together.
  - Zig-zag bursts when you get close (harder to corner).
  - Wall-slide to avoid being trapped in corners.
- **Scoring system**: +1 point per cube caught.
- **Restart system**: Press Space after death to reset.

---

## 🔧 Tuning
All the knobs live at the top of `game.js` in **MODULE 1: Config**.

- `PLAYER_SIZE`, `PLAYER_SPEED` → your cube stats.
- `HEALTH_MAX`, `HEALTH_DECAY_PER_SEC`, `HEALTH_REFILL_ON_CLEAR` → health system.
- `TIME_STEP_SEC` → how often new cubes get added (default: 30s).
- `TARGET_MAX_SPEED`, `TARGET_MAX_ACCEL` → cube mobility.
- `JUKE_STRENGTH`, `JITTER`, and AI module constants (`SEP_RADIUS`, `ZIG_FORCE`, etc.) → evasive behavior.

---

## 🚀 Roadmap Ideas
- Limit maximum cubes to prevent impossible swarms.
- Add sound effects for catches and game over.
- Power-ups (e.g. speed boost, health pack).
- Scoreboard persistence (local storage).

---

## 📝 License
Do whatever you want with it. Just have fun.
