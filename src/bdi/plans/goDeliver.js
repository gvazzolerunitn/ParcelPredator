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

class GoDeliver {
  static isApplicableTo(desire) { return desire === 'go_deliver'; }
  constructor(parent) { this.parent = parent; this.stopped = false; }
  stop() { this.stopped = true; }
  async execute(_desire, x, y) {
    if (this.stopped) throw new Error("stopped");
    
    const tx = Math.round(x);
    const ty = Math.round(y);
    const tileKey = `${tx},${ty}`;
    
    // Check if delivery zone is on cooldown
    if (this.parent.belief && this.parent.belief.isOnCooldown('delivery', tileKey)) {
      console.log(`GoDeliver: Delivery zone (${tx},${ty}) is on cooldown, skipping`);
      throw new Error("target on cooldown");
    }
    
    // Macro-retry loop for movement with replan
    let moveResult = true;
    if (Math.round(this.parent.x) !== tx || Math.round(this.parent.y) !== ty) {
      for (let attempt = 0; attempt < PLAN_MAX_ATTEMPTS; attempt++) {
        if (this.stopped) throw new Error("stopped");
        
        const mover = (config.usePddl ? new PDDLMove(this.parent) : new MoveBfs(this.parent));
        moveResult = await mover.execute('go_to', tx, ty, this.parent.belief);
        
        if (moveResult === true) {
          // Success - clear any cooldown on this target
          if (this.parent.belief) {
            this.parent.belief.clearCooldown('delivery', tileKey);
          }
          break;
        }
        
        if (moveResult === "obstructed") {
          if (attempt < PLAN_MAX_ATTEMPTS - 1) {
            const backoff = getBackoff(attempt);
            console.log(`GoDeliver: Path obstructed, attempt ${attempt + 1}/${PLAN_MAX_ATTEMPTS} — retrying in ${backoff}ms`);
            await sleep(backoff);
          } else {
            // All retries exhausted - set cooldown
            console.log(`GoDeliver: All ${PLAN_MAX_ATTEMPTS} attempts failed for delivery zone (${tx},${ty})`);
            if (this.parent.belief) {
              this.parent.belief.setCooldown('delivery', tileKey, TARGET_COOLDOWN_MS);
            }
            throw new Error("delivery failed");
          }
        }
      }
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
