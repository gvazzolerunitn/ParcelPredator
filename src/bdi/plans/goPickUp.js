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
    if (!res || res.length === 0) throw new Error("pickup failed " + id);
    
    // Aggiorna stato agente
    this.parent.carried = res.length;
    this.parent.carriedReward = res.reduce((sum, p) => sum + (p.reward || 0), 0);
    
    // Rimuovi i pacchi raccolti dalla belief (non sono più liberi)
    for (const p of res) {
      this.parent.belief.removeParcel(p.id);
    }
    
    console.log('Picked up parcels, now carrying:', this.parent.carried);
    
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

export { GoPickUp };
