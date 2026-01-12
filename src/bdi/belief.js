// Stato delle credenze con timestamps, decay e expiry
// Ispirato a ASAPlanners per gestione realistica delle informazioni
class Belief {
  constructor() {
    this.parcels = new Map(); // id -> {id,x,y,reward,carriedBy,timestamp,observedReward}
    this.agents = new Map();  // id -> {id,name,x,y,score,timestamp}
    this.parcelSpawners = [];
    this.deliveryZones = [];
    this.startTime = Date.now();
    this.lossForSecond = 1; // Verrà aggiornato dal launcher con il valore del server
  }

  // Imposta il loss rate (chiamato dal launcher dopo onConfig)
  setLossForSecond(loss) {
    this.lossForSecond = loss;
  }

  // Sincronizza i pacchi: aggiorna quelli visti con nuovo timestamp
  syncParcels(parcelsArray) {
    const now = Date.now();
    // Aggiorna o aggiungi i pacchi visti
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
    // Rimuovi pacchi expired (non visti da troppo tempo o con reward decaduto)
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

  removeParcel(id) { this.parcels.delete(id); }

  /**
   * Rimuove pacchi scaduti:
   * - Non visti da più di 2000ms
   * - Con reward stimato <= 0 (decay li ha esauriti)
   */
  checkExpiredParcels(carriedParcels = null) {
    const now = Date.now();
    const toRemove = [];
    
    for (const [id, parcel] of this.parcels) {
      const elapsed = now - parcel.timestamp;
      const decayLoss = (elapsed / 1000) * this.lossForSecond;
      const estimatedReward = parcel.observedReward - decayLoss;
      
      // Scade se troppo vecchio (2s) o reward stimato <= 0
      if (elapsed >= 2000 || estimatedReward <= 0) {
        toRemove.push(id);
        // Se l'agente sta trasportando questo pacco, rimuovilo dalla lista
        if (carriedParcels) {
          const idx = carriedParcels.findIndex(cp => cp.id === id);
          if (idx !== -1) {
            console.log(`Removing expired carried parcel ${id}`);
            carriedParcels.splice(idx, 1);
          }
        }
      }
    }
    
    for (const id of toRemove) {
      this.parcels.delete(id);
    }
  }

  /**
   * Restituisce i pacchi liberi con reward stimato attuale
   * Considera il decay dal momento dell'osservazione
   */
  getFreeParcels() {
    this.checkExpiredParcels();
    const now = Date.now();
    
    return Array.from(this.parcels.values())
      .filter(p => p.carriedBy === null || p.carriedBy === undefined || p.carriedBy === '')
      .map(p => {
        const elapsed = now - p.timestamp;
        const decayLoss = (elapsed / 1000) * this.lossForSecond;
        const estimatedReward = Math.max(0, p.observedReward - decayLoss);
        return {
          ...p,
          reward: estimatedReward // Reward stimato attuale
        };
      })
      .filter(p => p.reward > 0); // Escludi pacchi con reward 0
  }

  getParcelsArray() { return Array.from(this.parcels.values()); }

  // Sincronizza agenti con timestamp
  // Optional `myId` parameter: if provided, skip updating the entry for `myId`
  syncAgents(agentsArray, myId = undefined) {
    const now = Date.now();
    for (const a of agentsArray) {
      if (a && a.id === myId) continue; // Do not overwrite our own agent entry
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

  getAgent(id) { return this.agents.get(id); }

  /**
   * Rimuove agenti non visti da più di 500ms
   */
  checkExpiredAgents() {
    const now = Date.now();
    const toRemove = [];
    
    for (const [id, agent] of this.agents) {
      if (now - agent.timestamp >= 500) {
        toRemove.push(id);
      }
    }
    
    for (const id of toRemove) {
      this.agents.delete(id);
    }
  }

  /**
   * Ritorna tutti gli agenti (non expired) tranne quello con id specificato
   */
  getOtherAgents(myId) {
    this.checkExpiredAgents();
    return Array.from(this.agents.values()).filter(a => a.id !== myId);
  }

  // ============================================================================
  // COOLDOWN API - per evitare retry aggressivi su target irraggiungibili
  // ============================================================================
  
  /**
   * Imposta un cooldown per un target specifico
   * @param {string} kind - tipo di target ('parcel', 'tile', 'spawner')
   * @param {string} key - identificativo (es. 'p4', '5,3')
   * @param {number} ms - durata cooldown in millisecondi
   */
  setCooldown(kind, key, ms) {
    if (!this._cooldowns) this._cooldowns = new Map();
    const fullKey = `${kind}:${key}`;
    const until = Date.now() + ms;
    this._cooldowns.set(fullKey, until);
    // Verbose cooldown logs removed for cleaner output
  }

  /**
   * Verifica se un target è in cooldown
   * @param {string} kind - tipo di target
   * @param {string} key - identificativo
   * @returns {boolean} true se ancora in cooldown
   */
  isOnCooldown(kind, key) {
    if (!this._cooldowns) return false;
    const fullKey = `${kind}:${key}`;
    const until = this._cooldowns.get(fullKey);
    if (!until) return false;
    if (Date.now() >= until) {
      this._cooldowns.delete(fullKey);
      return false;
    }
    return true;
  }

  /**
   * Rimuove il cooldown di un target (es. quando raggiungiamo con successo)
   * @param {string} kind - tipo di target
   * @param {string} key - identificativo
   */
  clearCooldown(kind, key) {
    if (!this._cooldowns) return;
    const fullKey = `${kind}:${key}`;
    if (this._cooldowns.has(fullKey)) {
      this._cooldowns.delete(fullKey);
      console.log(`Cooldown cleared: ${fullKey}`);
    }
  }

  // ============================================================================
  // MULTI-AGENT: Remote belief merging and claim registry
  // ============================================================================

  /**
   * Merge parcels received from friend agent
   * Only adds parcels we don't already know about or updates if remote is fresher
   * @param {Array} remoteParcels - parcels from friend agent
   */
  mergeRemoteParcels(remoteParcels) {
    const now = Date.now();
    for (const p of remoteParcels) {
      const existing = this.parcels.get(p.id);
      // Add if we don't have it, or if remote observation is newer
      if (!existing || (p.timestamp && p.timestamp > existing.timestamp)) {
        this.parcels.set(p.id, {
          id: p.id,
          x: Math.round(p.x),
          y: Math.round(p.y),
          reward: p.reward,
          observedReward: p.reward,
          carriedBy: p.carriedBy,
          timestamp: p.timestamp || now,
          remote: true // Mark as received from friend
        });
      }
    }
  }

  /**
   * Apply parcels delta received from friend agent (diff-only)
   * @param {Object} delta - { added: [], updated: [], removed: [] }
   */
  applyParcelsDelta(delta) {
    const now = Date.now();
    
    // Add new parcels
    for (const p of delta.added || []) {
      if (!this.parcels.has(p.id)) {
        this.parcels.set(p.id, {
          id: p.id,
          x: Math.round(p.x),
          y: Math.round(p.y),
          reward: p.reward,
          observedReward: p.reward,
          carriedBy: p.carriedBy,
          timestamp: now,
          remote: true
        });
      }
    }
    
    // Update existing parcels
    for (const p of delta.updated || []) {
      this.parcels.set(p.id, {
        id: p.id,
        x: Math.round(p.x),
        y: Math.round(p.y),
        reward: p.reward,
        observedReward: p.reward,
        carriedBy: p.carriedBy,
        timestamp: now,
        remote: true
      });
    }
    
    // Remove parcels
    for (const id of delta.removed || []) {
      this.parcels.delete(id);
    }
  }

  /**
   * Merge agents received from friend agent
   * @param {Array} remoteAgents - agents from friend agent
   * @param {string} myId - our agent id (to exclude self)
   */
  mergeRemoteAgents(remoteAgents, myId) {
    const now = Date.now();
    for (const a of remoteAgents) {
      if (a.id === myId) continue; // Don't overwrite self
      const existing = this.agents.get(a.id);
      // Add if we don't have it, or if remote observation is newer
      if (!existing || (a.timestamp && a.timestamp > existing.timestamp)) {
        this.agents.set(a.id, {
          id: a.id,
          name: a.name,
          x: Math.round(a.x),
          y: Math.round(a.y),
          score: a.score,
          timestamp: a.timestamp || now,
          remote: true
        });
      }
    }
  }

  /**
   * Apply agents delta received from friend agent (diff-only)
   * @param {Object} delta - { added: [], updated: [], removed: [] }
   * @param {string} myId - our agent id (to exclude self)
   */
  applyAgentsDelta(delta, myId) {
    const now = Date.now();
    
    // Add new agents
    for (const a of delta.added || []) {
      if (a.id === myId) continue;
      if (!this.agents.has(a.id)) {
        this.agents.set(a.id, {
          id: a.id,
          x: Math.round(a.x),
          y: Math.round(a.y),
          timestamp: now,
          remote: true
        });
      }
    }
    
    // Update existing agents
    for (const a of delta.updated || []) {
      if (a.id === myId) continue;
      this.agents.set(a.id, {
        ...this.agents.get(a.id),
        id: a.id,
        x: Math.round(a.x),
        y: Math.round(a.y),
        timestamp: now,
        remote: true
      });
    }
    
    // Remove agents
    for (const id of delta.removed || []) {
      if (id !== myId) {
        this.agents.delete(id);
      }
    }
  }

  /**
   * Register a claim (intention) from friend agent
   * Used for coordination: avoid picking same parcel
   * @param {string} agentId - friend agent id
   * @param {Array} predicate - intention [action, x, y, id, score]
   */
  registerClaim(agentId, predicate) {
    if (!this._claims) this._claims = new Map();
    const [action, x, y, id, score] = predicate;
    this._claims.set(agentId, {
      action,
      x,
      y,
      targetId: id,
      score,
      timestamp: Date.now()
    });
  }

  /**
   * Get all active claims (not expired)
   * Claims expire after 3 seconds
   * @returns {Map} agentId -> claim object
   */
  getClaims() {
    if (!this._claims) return new Map();
    const now = Date.now();
    const CLAIM_TTL = 3000; // 3 seconds
    
    // Clean expired claims
    for (const [agentId, claim] of this._claims) {
      if (now - claim.timestamp > CLAIM_TTL) {
        this._claims.delete(agentId);
      }
    }
    return this._claims;
  }

  /**
   * Check if a parcel is claimed by another agent
   * @param {string} parcelId - parcel id to check
   * @returns {object|null} claim object if claimed, null otherwise
   */
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
   * Determine if we should yield a parcel to another agent's claim.
   * Priority rules:
   * 1. Higher score wins
   * 2. If scores are equal, lower agentId (lexicographic) wins
   * @param {string} parcelId - parcel id
   * @param {string} myId - our agent id
   * @param {number} myScore - our score for this parcel
   * @returns {object|null} - { yieldTo: agentId, reason: string } if we should yield, null otherwise
   */
  shouldYieldClaim(parcelId, myId, myScore) {
    const claims = this.getClaims();
    for (const [agentId, claim] of claims) {
      if (agentId === myId) continue; // Skip our own claim
      if (claim.action === 'go_pick_up' && claim.targetId === parcelId) {
        const theirScore = claim.score || 0;
        // Higher score wins
        if (theirScore > myScore) {
          return { yieldTo: agentId, reason: 'higher score' };
        }
        // Equal score: lower agentId wins (tie-breaker)
        if (theirScore === myScore && agentId < myId) {
          return { yieldTo: agentId, reason: 'tie-break (agentId)' };
        }
      }
    }
    return null; // We have priority or no competing claim
  }

  /**
   * Clear our own claim for a parcel (after successful pickup or abandonment)
   * @param {string} myId - our agent id
   * @param {string} parcelId - parcel id
   */
  clearMyClaim(myId, parcelId) {
    if (!this._claims) return;
    const myClaim = this._claims.get(myId);
    if (myClaim && myClaim.targetId === parcelId) {
      this._claims.delete(myId);
    }
  }

  /**
   * Get friend's current intention (if any)
   * @param {string} friendId - friend agent id
   * @returns {object|null} claim object or null
   */
  getFriendIntention(friendId) {
    if (!this._claims) return null;
    return this._claims.get(friendId) || null;
  }
}

export { Belief };
