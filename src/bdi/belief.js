/**
 * belief.js - Belief State Management
 * 
 * Manages agent's beliefs about:
 * - Parcels: location, reward, decay over time
 * - Agents: other agents' positions
 * - Cooldowns: avoid re-targeting failed destinations
 * - Claims: coordination with partner agent
 */

class Belief {
  constructor() {
    this.parcels = new Map();     // id -> {id, x, y, reward, carriedBy, timestamp}
    this.agents = new Map();       // id -> {id, name, x, y, score, timestamp}
    this.parcelSpawners = [];
    this.deliveryZones = [];
    this.lossForSecond = 1;
    this._cooldowns = new Map();
    this._claims = new Map();
  }

  /** Set loss rate (called after server config) */
  setLossForSecond(loss) {
    this.lossForSecond = loss;
  }

  // =========================================================================
  // PARCELS
  // =========================================================================

  /** Sync parcels from perception */
  syncParcels(parcelsArray) {
    const now = Date.now();
    for (const p of parcelsArray) {
      this.parcels.set(p.id, {
        id: p.id,
        x: Math.round(p.x),
        y: Math.round(p.y),
        reward: p.reward,
        observedReward: p.reward,
        carriedBy: p.carriedBy,
        timestamp: now
      });
    }
    this.checkExpiredParcels();
  }

  addParcel(p) { 
    this.parcels.set(p.id, {
      ...p,
      x: Math.round(p.x),
      y: Math.round(p.y),
      observedReward: p.reward,
      timestamp: Date.now()
    }); 
  }

  removeParcel(id) { 
    this.parcels.delete(id); 
  }

  /** Remove expired parcels (not seen in 2s or reward decayed to 0) */
  checkExpiredParcels() {
    const now = Date.now();
    const toRemove = [];
    
    for (const [id, parcel] of this.parcels) {
      const elapsed = now - parcel.timestamp;
      const decayLoss = (elapsed / 1000) * this.lossForSecond;
      const estimatedReward = parcel.observedReward - decayLoss;
      
      if (elapsed >= 2000 || estimatedReward <= 0) {
        toRemove.push(id);
      }
    }
    
    for (const id of toRemove) {
      this.parcels.delete(id);
    }
  }

  /** Get free parcels with estimated current reward */
  getFreeParcels() {
    this.checkExpiredParcels();
    const now = Date.now();
    
    return Array.from(this.parcels.values())
      .filter(p => !p.carriedBy)
      .map(p => {
        const elapsed = now - p.timestamp;
        const decayLoss = (elapsed / 1000) * this.lossForSecond;
        const estimatedReward = Math.max(0, p.observedReward - decayLoss);
        return { ...p, reward: estimatedReward };
      })
      .filter(p => p.reward > 0);
  }

  getParcelsArray() { 
    return Array.from(this.parcels.values()); 
  }

  // =========================================================================
  // AGENTS
  // =========================================================================

  /** Sync agents from perception */
  syncAgents(agentsArray, myId = undefined) {
    const now = Date.now();
    for (const a of agentsArray) {
      if (a && a.id === myId) continue;
      this.agents.set(a.id, {
        id: a.id,
        name: a.name,
        x: Math.round(a.x),
        y: Math.round(a.y),
        score: a.score,
        timestamp: now
      });
    }
    this.checkExpiredAgents();
  }

  addAgent(a) { 
    this.agents.set(a.id, {
      ...a,
      x: Math.round(a.x),
      y: Math.round(a.y),
      timestamp: Date.now()
    }); 
  }

  getAgent(id) { 
    return this.agents.get(id); 
  }

  /** Remove agents not seen in 5000ms (increased for slow-moving agents) */
  checkExpiredAgents() {
    const now = Date.now();
    const toRemove = [];
    
    for (const [id, agent] of this.agents) {
      if (now - agent.timestamp >= 5000) {
        toRemove.push(id);
      }
    }
    
    for (const id of toRemove) {
      this.agents.delete(id);
    }
  }

  /** Get all agents except self */
  getOtherAgents(myId) {
    this.checkExpiredAgents();
    return Array.from(this.agents.values()).filter(a => a.id !== myId);
  }

  // =========================================================================
  // COOLDOWNS
  // =========================================================================

  /** Set cooldown for a target */
  setCooldown(kind, key, ms) {
    const fullKey = kind + ':' + key;
    this._cooldowns.set(fullKey, Date.now() + ms);
  }

  /** Check if target is on cooldown */
  isOnCooldown(kind, key) {
    const fullKey = kind + ':' + key;
    const until = this._cooldowns.get(fullKey);
    if (!until) return false;
    if (Date.now() >= until) {
      this._cooldowns.delete(fullKey);
      return false;
    }
    return true;
  }

  /** Clear cooldown for a target */
  clearCooldown(kind, key) {
    const fullKey = kind + ':' + key;
    this._cooldowns.delete(fullKey);
  }

  // =========================================================================
  // CLAIMS (Multi-Agent Coordination)
  // =========================================================================

  /** Merge parcels from partner agent */
  mergeRemoteParcels(remoteParcels) {
    const now = Date.now();
    for (const p of remoteParcels) {
      const existing = this.parcels.get(p.id);
      if (!existing || (p.timestamp && p.timestamp > existing.timestamp)) {
        this.parcels.set(p.id, {
          id: p.id,
          x: Math.round(p.x),
          y: Math.round(p.y),
          reward: p.reward,
          observedReward: p.reward,
          carriedBy: p.carriedBy,
          timestamp: p.timestamp || now
        });
      }
    }
  }

  /** Merge agents from partner agent */
  mergeRemoteAgents(remoteAgents, myId) {
    const now = Date.now();
    for (const a of remoteAgents) {
      if (a.id === myId) continue;
      const existing = this.agents.get(a.id);
      if (!existing || (a.timestamp && a.timestamp > existing.timestamp)) {
        this.agents.set(a.id, {
          id: a.id,
          name: a.name,
          x: Math.round(a.x),
          y: Math.round(a.y),
          score: a.score,
          timestamp: a.timestamp || now
        });
      }
    }
  }

  /** Register a claim (intention) from an agent */
  registerClaim(agentId, predicate) {
    const [action, x, y, id, score] = predicate;
    this._claims.set(agentId, {
      action, x, y,
      targetId: id,
      score,
      timestamp: Date.now()
    });
  }

  /** Get all active claims (expire after 3s) */
  getClaims() {
    const now = Date.now();
    const CLAIM_TTL = 3000;
    
    for (const [agentId, claim] of this._claims) {
      if (now - claim.timestamp > CLAIM_TTL) {
        this._claims.delete(agentId);
      }
    }
    return this._claims;
  }

  /** Check if parcel is claimed by another agent */
  isParcelClaimed(parcelId) {
    const claims = this.getClaims();
    for (const [agentId, claim] of claims) {
      if (claim.action === 'go_pick_up' && claim.targetId === parcelId) {
        return { agentId, ...claim };
      }
    }
    return null;
  }

  /** 
   * Check if we should yield to partner's claim
   * Priority: higher score wins, tie-break by agentId
   */
  shouldYieldClaim(parcelId, myId, myScore) {
    const claims = this.getClaims();
    for (const [agentId, claim] of claims) {
      if (agentId === myId) continue;
      if (claim.action === 'go_pick_up' && claim.targetId === parcelId) {
        const theirScore = claim.score || 0;
        if (theirScore > myScore) {
          return { yieldTo: agentId, reason: 'higher score' };
        }
        if (theirScore === myScore && agentId < myId) {
          return { yieldTo: agentId, reason: 'tie-break' };
        }
      }
    }
    return null;
  }

  /** Clear our claim for a parcel */
  clearMyClaim(myId, parcelId) {
    const myClaim = this._claims.get(myId);
    if (myClaim && myClaim.targetId === parcelId) {
      this._claims.delete(myId);
    }
  }

  /** Get partner's current intention */
  getFriendIntention(friendId) {
    return this._claims.get(friendId) || null;
  }
}

export { Belief };
