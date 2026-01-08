import { adapter } from "../../client/adapter.js";
import { MoveBfs } from "./moveBfs.js";

class GoDeliver {
  static isApplicableTo(desire) { return desire === 'go_deliver'; }
  constructor(parent) { this.parent = parent; this.stopped = false; }
  stop() { this.stopped = true; }
  async execute(_desire, x, y) {
    if (this.stopped) throw new Error("stopped");
    const mover = new MoveBfs(this.parent);
    if (Math.round(this.parent.x) !== Math.round(x) || Math.round(this.parent.y) !== Math.round(y)) {
      await mover.execute('go_to', x, y);
    }
    if (this.parent.carried <= 0) throw new Error("no parcels to deliver");
    const res = await adapter.putdown();
    if (!res) throw new Error("putdown failed");
    return true;
  }
}

export { GoDeliver };
