import { adapter } from "../../client/adapter.js";
import { grid } from "../../utils/grid.js";

class GoRandom {
  static isApplicableTo(desire) { return desire === 'go_random'; }
  constructor(parent) { this.parent = parent; this.stopped = false; }
  stop() { this.stopped = true; }
  async execute(_desire, x, y) {
    // Try all directions in random order and move to the first valid one
    const dirs = ['up','down','left','right'].sort(() => Math.random() - 0.5);
    for (const dir of dirs) {
      if (this.stopped) throw new Error("stopped");
      // Compute target position
      let nx = Math.round(this.parent.x), ny = Math.round(this.parent.y);
      if (dir === 'up') ny += 1;
      else if (dir === 'down') ny -= 1;
      else if (dir === 'left') nx -= 1;
      else if (dir === 'right') nx += 1;
      // Check if accessible
      if (grid.isAccessible(nx, ny)) {
        const res = await adapter.move(dir);
        if (res !== false) return true; // move succeeded
      }
    }
    // No valid direction, wait briefly and return
    await new Promise(r => setTimeout(r, 200));
    return true;
  }
}

export { GoRandom };
