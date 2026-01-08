import { adapter } from "../../client/adapter.js";

class GoRandom {
  static isApplicableTo(desire) { return desire === 'go_random'; }
  constructor(parent) { this.parent = parent; this.stopped = false; }
  stop() { this.stopped = true; }
  async execute(_desire, x, y) {
    // Muove un passo casuale se possibile; placeholder semplice.
    const dirs = ['up','down','left','right'];
    const dir = dirs[Math.floor(Math.random()*dirs.length)];
    const res = await adapter.move(dir);
    if (!res) throw new Error("random move failed");
    return true;
  }
}

export { GoRandom };
