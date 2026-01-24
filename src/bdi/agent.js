import { Intention } from "./intention.js";

class Agent {
  constructor() {
    this.id = undefined;
    this.name = undefined;
    this.x = undefined;
    this.y = undefined;
    this.score = 0;
    this.carried = 0;
    this.carriedReward = 0;       // Total reward of carried parcels
    this.intentions = [];
    // External references set by launcher
    this.belief = null;
    this.grid = null;
    this.optionsGeneration = null;
    // Scoring parameters for multi-pick
    this.capacity = 4;            // Max parcels carried
    this.lossForMovement = 0;     // Reward loss per move (from server config)
    // Multi-agent coordination
    this.friendId = null;         // ID of collaborative friend agent
    this.isSecondAgent = false;   // true if this is agent 2
    this.comm = null;             // Communication module reference
    // Coordination state for corridor handoff protocol
    this._coordinationMode = false;      // Flag for handoff/coordination protocol
    this._coordinationCooldownUntil = 0; // Cooldown to prevent rapid re-triggering
    // Ignore recently dropped parcels to avoid yo-yo
    this.ignoredParcels = new Map(); // key "x,y" -> expiry timestamp
  }

  /** Check if agent is in handoff state or cooldown */
  isInHandoff() {
    if (this._coordinationMode) return true;
    if (Date.now() < this._coordinationCooldownUntil) return true;
    return false;
  }

  /** Set handoff state (with cooldown on exit) */
  setHandoffState(value) {
    this._coordinationMode = value;
    if (!value) {
      // Set 3s cooldown after handoff ends
      this._coordinationCooldownUntil = Date.now() + 3000;
    }
  }

  /** Alias to align with coordination wording */
  setCoordinationState(value) {
    this.setHandoffState(value);
  }

  ignoreParcelAt(x, y, duration = 3000) {
    const key = `${Math.round(x)},${Math.round(y)}`;
    this.ignoredParcels.set(key, Date.now() + duration);
  }

  isParcelIgnored(x, y) {
    const key = `${Math.round(x)},${Math.round(y)}`;
    if (!this.ignoredParcels.has(key)) return false;
    const expiry = this.ignoredParcels.get(key);
    if (Date.now() > expiry) {
      this.ignoredParcels.delete(key);
      return false;
    }
    return true;
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
    if (this.isInHandoff()) return;
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
    // Wait until the agent receives its initial position from the server
    while (this.x === undefined) {
      await new Promise(res => setTimeout(res, 100));
    }
    while (true) {
      // Brain-freeze: pause BDI while coordination protocol runs
      if (this.isInHandoff()) {
        await new Promise(res => setTimeout(res, 50));
        continue;
      }
      // If idle, generate new options
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
