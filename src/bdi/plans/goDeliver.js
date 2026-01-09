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
      await mover.execute('go_to', x, y, this.parent.belief);
    }
    if (this.parent.carried <= 0) throw new Error("no parcels to deliver");

    // Cattura gli ID dei pacchi che stiamo per consegnare (evita race con onParcels)
    const deliveredIdsArr = (this.parent.carried_parcels || []).map(p => p.id);
    const deliveredCount = deliveredIdsArr.length;

    const res = await adapter.putdown();
    if (!res) throw new Error("putdown failed");

    // Rimuovi dalla belief eventuali record residui dei pacchi consegnati
    for (const id of deliveredIdsArr) {
      try { this.parent.belief.removeParcel(id); } catch (e) { /* ignore */ }
    }

    // Reset stato dopo consegna
    const deliveredIds = deliveredIdsArr.join(',');
    this.parent.carried = 0;
    this.parent.carriedReward = 0;
    this.parent.carried_parcels = [];

    console.log('Delivered', deliveredCount, 'parcels | IDs:', deliveredIds);
    
    // Chiama immediatamente optionsGeneration per decidere il prossimo passo
    if (this.parent.optionsGeneration) {
      this.parent.optionsGeneration({
        me: this.parent,
        belief: this.parent.belief,
        grid: this.parent.grid,
        push: (p) => this.parent.push(p)
      });
    }
    return true;
  }
}

export { GoDeliver };
