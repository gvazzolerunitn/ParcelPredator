import { adapter } from "../../client/adapter.js";
import { grid } from "../../utils/grid.js";

class MoveBfs {
  static isApplicableTo(desire) { return desire === 'go_to'; }
  constructor(parent) { this.parent = parent; this.stopped = false; }
  stop() { this.stopped = true; }
  async execute(_desire, x, y) {
    const sx = Math.round(this.parent.x);
    const sy = Math.round(this.parent.y);
    const tx = Math.round(x); const ty = Math.round(y);
    if (sx === tx && sy === ty) return true;
    const path = grid.bfsPath(sx, sy, tx, ty);
    if (!path || path.length === 0) {
      throw new Error('MoveBfs: path not found');
    }
    for (const dir of path) {
      if (this.stopped) throw new Error("stopped");
      const ok = await adapter.move(dir);
      // move può restituire false se bloccato, ma anche status; ignora solo se esplicitamente false
      if (ok === false) throw new Error("move blocked: " + dir);
    }
    return true;
  }
}

export { MoveBfs };
