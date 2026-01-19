import { Intention } from "./intention.js";

class Agent {
  constructor() {
    this.id = undefined;
    this.name = undefined;
    this.x = undefined;
    this.y = undefined;
    this.score = 0;
    this.carried = 0;
    this.carriedReward = 0;       // Somma reward dei pacchi trasportati
    this.intentions = [];
    // Riferimenti esterni impostati dal launcher
    this.belief = null;
    this.grid = null;
    this.optionsGeneration = null;
    // Parametri per scoring multi-pick
    this.capacity = 4;            // Numero max pacchi trasportabili
    this.lossForMovement = 0;     // Perdita reward per movimento (calcolato da config server)
    // Multi-agent coordination
    this.friendId = null;         // ID of collaborative friend agent
    this.isSecondAgent = false;   // true if this is agent 2
    this.comm = null;             // Communication module reference
    // Handoff state for coordinated parcel transfer
    this._inHandoff = false;      // Flag for handoff protocol
    this._handoffCooldownUntil = 0;  // Cooldown to prevent rapid re-triggering
  }

  /** Check if agent is in handoff state or cooldown */
  isInHandoff() {
    if (this._inHandoff) return true;
    if (Date.now() < this._handoffCooldownUntil) return true;
    return false;
  }

  /** Set handoff state (with cooldown on exit) */
  setHandoffState(value) {
    this._inHandoff = value;
    if (!value) {
      // Set 3s cooldown after handoff ends
      this._handoffCooldownUntil = Date.now() + 3000;
    }
  }

  setValues({ id, name, x, y, score, carried }) {
    this.id = id; 
    this.name = name; 
    // Store ROUNDED coordinates for grid-based logic (like ASAPlanners)
    // This prevents issues with fractional positions during movement
    this.x = Math.round(x); 
    this.y = Math.round(y); 
    this.score = score;
    if (carried !== undefined) this.carried = carried;
  }

  /**
   * Add a new intention to the queue.
   * If replace=true (default), stops current intention for revision.
   * If replace=false, just queues the intention without interrupting.
   */
  push(predicate, replace = true) {
    // Avoid duplicates
    const isDuplicate = this.intentions.some(i => i.predicate.join(" ") === predicate.join(" "));
    if (isDuplicate) return;
    
    const i = new Intention(this, predicate);
    this.intentions.push(i);
    
    // Only stop current intention if replace=true and there's something running
    if (replace && this.intentions.length > 1) {
      this.intentions[0]?.stop?.();
    }
  }

  async loop() {
    // Aspetta che l'agente abbia ricevuto la propria posizione dal server
    while (this.x === undefined) {
      await new Promise(res => setTimeout(res, 100));
    }
    while (true) {
      // Se idle, genera nuove opzioni
      if (this.intentions.length === 0 && this.optionsGeneration) {
        this.optionsGeneration({
          me: this,
          belief: this.belief,
          grid: this.grid,
          push: (p) => this.push(p),
          comm: this.comm
        });
      }
      if (this.intentions.length > 0) {
        const intention = this.intentions[0];
        try {
          await intention.achieve();
        } catch (err) {
          console.error("intention failed", intention.predicate, err);
        }
        this.intentions.shift();
      }
      await new Promise(res => setTimeout(res, 50));
    }
  }
}

export { Agent };
