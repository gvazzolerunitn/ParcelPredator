/**
 * goPickUp.js - Pickup Plan
 * 
 * Moves to parcel location and picks it up.
 * Includes retry logic with exponential backoff.
 */

import { adapter } from "../../client/adapter.js";
import { MoveBfs } from "./moveBfs.js";
import { PDDLMove } from "./pddlMove.js";
import config from "../../config/default.js";
import { agentLogger } from '../../utils/logger.js';

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 200;
const COOLDOWN_MS = 3000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getBackoff(attempt) {
  return BACKOFF_BASE_MS * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
}

class GoPickUp {
  static isApplicableTo(desire) { return desire === 'go_pick_up'; }
  
  constructor(parent) {
    this.parent = parent;
    this.stopped = false;
  }
  
  stop() { this.stopped = true; }
  
  async execute(_desire, x, y, id) {
    if (this.stopped) throw new Error("stopped");
    
    const tx = Math.round(x);
    const ty = Math.round(y);
    
    // Skip if target is on cooldown
    if (this.parent.belief?.isOnCooldown('parcel', id)) {
      agentLogger.hot('cooldown', 3000, 'GoPickUp: Parcel on cooldown, skipping');
      throw new Error("target on cooldown");
    }
    
    // Move to target with retry
    if (Math.round(this.parent.x) !== tx || Math.round(this.parent.y) !== ty) {
      let moveResult = true;
      
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (this.stopped) throw new Error("stopped");
        
        const mover = config.usePddl ? new PDDLMove(this.parent) : new MoveBfs(this.parent);
        
        try {
          moveResult = await mover.execute('go_to', tx, ty, this.parent.belief);
        } catch (err) {
          if (err.message === 'stopped') throw err;
          moveResult = 'error';
        }
        
        if (moveResult === true) break;
        
        // Retry on failure
        if (attempt < MAX_ATTEMPTS - 1) {
          const backoff = getBackoff(attempt);
          agentLogger.hot('retry', 3000, 'GoPickUp: Movement failed, retrying in ' + backoff + 'ms');
          await sleep(backoff);
        } else {
          // All retries exhausted
          if (this.parent.belief) {
            this.parent.belief.setCooldown('parcel', id, COOLDOWN_MS);
          }
          throw new Error("pickup failed");
        }
      }
    }
    
    if (this.stopped) throw new Error("stopped");
    
    // Check if parcel still available
    if (id && id !== 'explore' && this.parent.belief) {
      const stillFree = this.parent.belief.getFreeParcels().some(p => p.id === id);
      if (!stillFree) return true; // Already picked by someone
      
      // Yield to friend if they have higher priority claim
      const myScore = this.parent.intentions?.[0]?.predicate?.[4] || 0;
      const yieldInfo = this.parent.belief.shouldYieldClaim(id, this.parent.id, myScore);
      if (yieldInfo) {
        agentLogger.hot('yield', 3000, 'GoPickUp: Yielding to friend');
        this.parent.belief.clearMyClaim(this.parent.id, id);
        throw new Error("yielded");
      }
    }

    // Pickup action
    const res = await adapter.pickup();

    if (!res || res.length === 0) {
      if (id === 'explore') {
        // Exploration with no parcel - set tile cooldown
        if (this.parent.belief) {
          this.parent.belief.setCooldown('tile', tx + ',' + ty, COOLDOWN_MS);
        }
        return false;
      }
      throw new Error("pickup failed");
    }
    
    // Update agent state
    this.parent.carried_parcels = this.parent.carried_parcels || [];
    for (const p of res) {
      if (!this.parent.carried_parcels.some(cp => cp.id === p.id)) {
        this.parent.carried_parcels.push({ id: p.id, reward: p.reward || 0 });
      }
      this.parent.belief.removeParcel(p.id);
      this.parent.belief.clearCooldown('parcel', p.id);
      this.parent.belief.clearMyClaim(this.parent.id, p.id);
    }
    
    this.parent.carried = this.parent.carried_parcels.length;
    this.parent.carriedReward = this.parent.carried_parcels.reduce((s, p) => s + (p.reward || 0), 0);

    agentLogger.hot('pickup', 2000, 'Picked up parcels, carrying: ' + this.parent.carried);
    
    // Trigger new intention generation
    if (this.parent.optionsGeneration) {
      this.parent.optionsGeneration({
        me: this.parent,
        belief: this.parent.belief,
        grid: this.parent.grid,
        push: (p) => this.parent.push(p),
        comm: this.parent.comm
      });
    }
    
    return true;
  }
}

export { GoPickUp };
