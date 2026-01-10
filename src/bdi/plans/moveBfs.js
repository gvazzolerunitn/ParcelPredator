import { adapter } from "../../client/adapter.js";
import { grid } from "../../utils/grid.js";

// ============================================================================
// CONFIGURAZIONE RETRY E BACKOFF
// ============================================================================
const MAX_RETRIES = 4;
const BASE_DELAY_MS = 100;
// Exponential backoff: 100, 200, 400, 800 ms

// ============================================================================
// TARGET COOLDOWN: evita di riprovare lo stesso target subito dopo fallimenti
// ============================================================================
const targetCooldown = new Map(); // key: "x,y" -> { until: timestamp, failures: count }
const COOLDOWN_BASE_MS = 2000;
const MAX_COOLDOWN_MS = 10000;

/**
 * Verifica se un target è in cooldown
 */
export function isTargetInCooldown(x, y) {
  const key = `${Math.round(x)},${Math.round(y)}`;
  const entry = targetCooldown.get(key);
  if (!entry) return false;
  if (Date.now() > entry.until) {
    targetCooldown.delete(key);
    return false;
  }
  return true;
}

/**
 * Registra un fallimento per un target, aumentando il cooldown
 */
function markTargetFailed(x, y) {
  const key = `${Math.round(x)},${Math.round(y)}`;
  const entry = targetCooldown.get(key) || { until: 0, failures: 0 };
  entry.failures++;
  // Cooldown esponenziale: 2s, 4s, 8s, max 10s
  const cooldownMs = Math.min(COOLDOWN_BASE_MS * Math.pow(2, entry.failures - 1), MAX_COOLDOWN_MS);
  entry.until = Date.now() + cooldownMs;
  targetCooldown.set(key, entry);
}

/**
 * Resetta il cooldown di un target (quando ci arriviamo con successo)
 */
function clearTargetCooldown(x, y) {
  const key = `${Math.round(x)},${Math.round(y)}`;
  targetCooldown.delete(key);
}

/**
 * Costruisce un set di celle bloccate dalle posizioni degli agenti
 */
function getBlockedCells(belief, myId) {
  const blocked = new Set();
  if (!belief || !belief.getOtherAgents) return blocked;
  const others = belief.getOtherAgents(myId);
  for (const agent of others) {
    blocked.add(`${Math.round(agent.x)},${Math.round(agent.y)}`);
  }
  return blocked;
}

class MoveBfs {
  static isApplicableTo(desire) { return desire === 'go_to'; }
  constructor(parent) { this.parent = parent; this.stopped = false; }
  stop() { this.stopped = true; }
  
  /**
   * Esegue movimento BFS verso (x, y)
   * @param {string} _desire - tipo di desiderio (ignorato)
   * @param {number} x - target x
   * @param {number} y - target y
   * @param {object} belief - opzionale, belief per agent-aware pathfinding
   */
  async execute(_desire, x, y, belief = null) {
    const tx = Math.round(x); 
    const ty = Math.round(y);
    let retries = 0;
    
    while (retries < MAX_RETRIES) {
      if (this.stopped) throw new Error("stopped");
      
      const sx = Math.round(this.parent.x);
      const sy = Math.round(this.parent.y);
      
      // Già arrivato
      if (sx === tx && sy === ty) {
        clearTargetCooldown(tx, ty);
        return true;
      }
      
      // Ottieni celle bloccate da altri agenti
      const blockedCells = belief ? getBlockedCells(belief, this.parent.id) : null;
      
      // Prova prima con agent-aware path, poi fallback a path normale
      let path = blockedCells ? grid.bfsPath(sx, sy, tx, ty, blockedCells) : null;
      if (!path || path.length === 0) {
        path = grid.bfsPath(sx, sy, tx, ty);
      }
      if (!path || path.length === 0) {
        throw new Error('MoveBfs: path not found');
      }
      
      let blocked = false;
      for (const dir of path) {
        if (this.stopped) throw new Error("stopped");
        const ok = await adapter.move(dir);
        
        // emitMove ritorna {x,y} se successo, false se bloccato
        // Verifichiamo con !ok per catturare false, undefined, null
        if (!ok) {
          // Movimento bloccato: exponential backoff e riprova
          blocked = true;
          retries++;
          if (retries < MAX_RETRIES) {
            const delay = BASE_DELAY_MS * Math.pow(2, retries - 1);
            await new Promise(r => setTimeout(r, delay));
          }
          break; // Esci dal for per ricalcolare il path
        }
      }
      
      if (!blocked) {
        clearTargetCooldown(tx, ty);
        return true; // Percorso completato con successo
      }
    }
    
    // Dopo MAX_RETRIES, registra fallimento e lancia errore
    markTargetFailed(tx, ty);
    throw new Error("move blocked after retries");
  }
}

export { MoveBfs };
