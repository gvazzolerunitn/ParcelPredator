import { adapter } from "../../client/adapter.js";
import { MoveBfs } from "./moveBfs.js";
import { PDDLMove } from "./pddlMove.js";
import config from "../../config/default.js";

// Retry/backoff settings from config
const PLAN_MAX_ATTEMPTS = config.planMaxAttempts ?? 3;
const BACKOFF_BASE_MS = config.planBackoffBaseMs ?? 200;
const BACKOFF_JITTER_MS = config.planBackoffJitterMs ?? 100;
const TARGET_COOLDOWN_MS = config.targetCooldownMs ?? 3000;

/**
 * Helper: sleep for ms milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Helper: compute backoff with jitter
 */
function getBackoff(attempt) {
  const base = BACKOFF_BASE_MS * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * BACKOFF_JITTER_MS);
  return base + jitter;
}

class GoPickUp {
  static isApplicableTo(desire) { return desire === 'go_pick_up'; }
  constructor(parent) { this.parent = parent; this.stopped = false; }
  stop() { this.stopped = true; }
  async execute(_desire, x, y, id) {
    if (this.stopped) throw new Error("stopped");
    
    const tx = Math.round(x);
    const ty = Math.round(y);
    
    // Check if target is on cooldown
    if (this.parent.belief && this.parent.belief.isOnCooldown('parcel', id)) {
      console.log(`GoPickUp: Parcel ${id} is on cooldown, skipping`);
      throw new Error("target on cooldown");
    }
    
    // Macro-retry loop for movement with replan
    let moveResult = true;
    if (Math.round(this.parent.x) !== tx || Math.round(this.parent.y) !== ty) {
      for (let attempt = 0; attempt < PLAN_MAX_ATTEMPTS; attempt++) {
        if (this.stopped) throw new Error("stopped");
        
        const mover = (config.usePddl ? new PDDLMove(this.parent) : new MoveBfs(this.parent));
        
        // Wrap in try-catch to handle 'no plan found' and other errors
        try {
          moveResult = await mover.execute('go_to', tx, ty, this.parent.belief);
        } catch (err) {
          // Treat 'no plan found' as retriable (like obstructed)
          if (err.message === 'no plan found' || err.message === 'domain not found') {
            moveResult = 'no-plan';
          } else if (err.message === 'stopped') {
            throw err; // Re-throw stop signals
          } else {
            console.log(`GoPickUp: Unexpected error: ${err.message}`);
            moveResult = 'error';
          }
        }
        
        if (moveResult === true) {
          // Success - clear any cooldown on this target
          if (this.parent.belief) {
            this.parent.belief.clearCooldown('parcel', id);
          }
          break;
        }
        
        // Handle retriable failures: obstructed, no-plan, error
        if (moveResult === "obstructed" || moveResult === "no-plan" || moveResult === "error") {
          const reason = moveResult === "obstructed" ? "path obstructed" : 
                         moveResult === "no-plan" ? "no plan found" : "error";
          if (attempt < PLAN_MAX_ATTEMPTS - 1) {
            const backoff = getBackoff(attempt);
            console.log(`GoPickUp: ${reason}, attempt ${attempt + 1}/${PLAN_MAX_ATTEMPTS} — retrying in ${backoff}ms`);
            await sleep(backoff);
          } else {
            // All retries exhausted - set cooldown
            console.log(`GoPickUp: All ${PLAN_MAX_ATTEMPTS} attempts failed for parcel ${id} (${reason})`);
            if (this.parent.belief) {
              this.parent.belief.setCooldown('parcel', id, TARGET_COOLDOWN_MS);
            }
            throw new Error("pickup failed " + id);
          }
        }
      }
    }
    
    if (this.stopped) throw new Error("stopped");
    // Before attempting pickup, check belief: if the target parcel id is no longer
    // present in the belief (someone or we already picked it), consider success.
    if (id && id !== 'explore' && this.parent.belief) {
      const free = this.parent.belief.getFreeParcels().some(p => p.id === id);
      if (!free) {
        // Parcel already collected (likely via opportunistic pickup)
        return true;
      }
    }

    const res = await adapter.pickup();

    // Se è un'esplorazione (id='explore') e non c'è niente, non è un errore
    if (!res || res.length === 0) {
      if (id === 'explore') {
        // Esplorazione senza pacchi: imposta cooldown su questa coordinata
        // per evitare di riselezionarla subito
        const cx = Math.round(x);
        const cy = Math.round(y);
        if (this.parent.belief) {
          this.parent.belief.setCooldown('tile', `${cx},${cy}`, TARGET_COOLDOWN_MS);
        }
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
      // Clear cooldown if any
      if (this.parent.belief) {
        this.parent.belief.clearCooldown('parcel', p.id);
      }
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
