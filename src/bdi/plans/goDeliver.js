/**
 * goDeliver.js - Delivery Plan
 * 
 * Moves to delivery zone and drops all carried parcels.
 * Includes retry logic with exponential backoff.
 */

import { adapter } from "../../client/adapter.js";
import { MoveBfs } from "./moveBfs.js";
import { PDDLMove } from "./pddlMove.js";
import config from "../../config/default.js";
import { agentLogger } from '../../utils/logger.js';

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 200;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getBackoff(attempt) {
  return BACKOFF_BASE_MS * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
}

class GoDeliver {
  static isApplicableTo(desire) { return desire === 'go_deliver'; }
  
  constructor(parent) {
    this.parent = parent;
    this.stopped = false;
  }
  
  stop() { this.stopped = true; }
  
  async execute(_desire, x, y) {
    if (this.stopped) throw new Error("stopped");
    
    const tx = Math.round(x);
    const ty = Math.round(y);
    const tileKey = tx + ',' + ty;
    
    // No cooldown check - in corridor maps we must keep trying
    
    // Move to delivery zone with retry
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
          agentLogger.hot('retry', 3000, 'GoDeliver: Movement failed, retrying in ' + backoff + 'ms');
          await sleep(backoff);
        } else {
          // All retries exhausted - don't set cooldown, just fail
          throw new Error("delivery failed");
        }
      }
    }
    
    // If no parcels to deliver, consider success
    if (this.parent.carried <= 0) return true;

    // Capture parcel IDs before delivery
    const deliveredIds = (this.parent.carried_parcels || []).map(p => p.id);
    const deliveredCount = deliveredIds.length;

    // Putdown action
    const res = await adapter.putdown();
    if (!res) throw new Error("putdown failed");

    // Remove delivered parcels from belief
    for (const id of deliveredIds) {
      try { this.parent.belief.removeParcel(id); } catch (e) { /* ignore */ }
    }

    // Reset carried state
    this.parent.carried = 0;
    this.parent.carriedReward = 0;
    this.parent.carried_parcels = [];

    agentLogger.hot('deliver', 2000, 'Delivered ' + deliveredCount + ' parcels');
    
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

export { GoDeliver };
