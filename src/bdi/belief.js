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
  syncAgents(agentsArray) {
    const now = Date.now();
    for (const a of agentsArray) {
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
    console.log(`Cooldown set: ${fullKey} until ${new Date(until).toISOString().slice(11, 19)}`);
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
}

export { Belief };
