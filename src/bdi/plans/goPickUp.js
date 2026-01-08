import { adapter } from "../../client/adapter.js";
import { MoveBfs } from "./moveBfs.js";

class GoPickUp {
  static isApplicableTo(desire) { return desire === 'go_pick_up'; }
  constructor(parent) { this.parent = parent; this.stopped = false; }
  stop() { this.stopped = true; }
  async execute(_desire, x, y, id) {
    if (this.stopped) throw new Error("stopped");
    // muovi verso il pacco se non sei già sopra
    const mover = new MoveBfs(this.parent);
    if (Math.round(this.parent.x) !== Math.round(x) || Math.round(this.parent.y) !== Math.round(y)) {
      await mover.execute('go_to', x, y);
    }
    if (this.stopped) throw new Error("stopped");
    const res = await adapter.pickup();
    if (!res) throw new Error("pickup failed " + id);
    return true;
  }
}

export { GoPickUp };
