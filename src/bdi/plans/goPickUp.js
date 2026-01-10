import { adapter } from "../../client/adapter.js";
import { MoveBfs } from "./moveBfs.js";
import { PDDLMove } from "./pddlMove.js";
import config from "../../config/default.js";

class GoPickUp {
  static isApplicableTo(desire) { return desire === 'go_pick_up'; }
  constructor(parent) { this.parent = parent; this.stopped = false; }
  stop() { this.stopped = true; }
  async execute(_desire, x, y, id) {
    if (this.stopped) throw new Error("stopped");
    // muovi verso il pacco se non sei già sopra
    const mover = (config.usePddl ? new PDDLMove(this.parent) : new MoveBfs(this.parent));
    if (Math.round(this.parent.x) !== Math.round(x) || Math.round(this.parent.y) !== Math.round(y)) {
      await mover.execute('go_to', x, y, this.parent.belief);
    }
    if (this.stopped) throw new Error("stopped");
    const res = await adapter.pickup();
    
    // Se è un'esplorazione (id='explore') e non c'è niente, non è un errore
    if (!res || res.length === 0) {
      if (id === 'explore') {
        // Esplorazione senza pacchi: normale, non loggare come errore
        return false;
      }
      throw new Error("pickup failed " + id);
    }
    
    // Aggiorna stato agente — integra i pacchi appena raccolti nella lista di quelli trasportati
    // (adapter.pickup potrebbe ritornare solo i pacchi raccolti in questa azione)
    this.parent.carried_parcels = this.parent.carried_parcels || [];
    for (const p of res) {
      if (!this.parent.carried_parcels.some(cp => cp.id === p.id)) {
        this.parent.carried_parcels.push({ id: p.id, reward: p.reward || 0 });
      }
      // Rimuovi il pacco dalla belief (non è più disponibile sulla mappa)
      this.parent.belief.removeParcel(p.id);
    }
    // Aggiorna i contatori basati sulla lista cumulativa
    this.parent.carried = this.parent.carried_parcels.length;
    this.parent.carriedReward = this.parent.carried_parcels.reduce((sum, p) => sum + (p.reward || 0), 0);

    console.log('Picked up parcels, now carrying:', this.parent.carried, '| IDs:', this.parent.carried_parcels.map(p => p.id).join(','));
    
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
