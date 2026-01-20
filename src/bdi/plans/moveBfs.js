import { adapter } from "../../client/adapter.js";
import { grid } from "../../utils/grid.js";
import { ConflictDetectedError } from "../errors.js";

// ============================================================================
// CONFIGURAZIONE RETRY E BACKOFF
// ============================================================================
const MAX_RETRIES = 4;
const BASE_DELAY_MS = 100;
// Exponential backoff: 100, 200, 400, 800 ms
const DIR_TO_DELTA = {
  up: { dx: 0, dy: 1 },
  down: { dx: 0, dy: -1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 }
};

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
 * Includes friend's destination to avoid path collision
 */
function getBlockedCells(belief, myId, friendId = null) {
  const blocked = new Set();
  if (!belief || !belief.getOtherAgents) return blocked;
  
  const others = belief.getOtherAgents(myId);
  for (const agent of others) {
    blocked.add(`${Math.round(agent.x)},${Math.round(agent.y)}`);
  }
  
  // Also block friend's destination to avoid collision during movement
  if (friendId && belief.getFriendIntention) {
    const friendClaim = belief.getFriendIntention(friendId);
    if (friendClaim && friendClaim.x !== undefined && friendClaim.y !== undefined) {
      blocked.add(`${Math.round(friendClaim.x)},${Math.round(friendClaim.y)}`);
    }
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
      let curX = sx;
      let curY = sy;
      
      // Già arrivato
      if (sx === tx && sy === ty) {
        clearTargetCooldown(tx, ty);
        return true;
      }
      
      // Ottieni celle bloccate da altri agenti (include friend's destination)
      const blockedCells = belief ? getBlockedCells(belief, this.parent.id, this.parent.friendId) : null;
      
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
        const next = this._nextCell(curX, curY, dir);
        const ok = await adapter.move(dir);
        
        // emitMove ritorna {x,y} se successo, false se bloccato
        // Verifichiamo con !ok per catturare false, undefined, null
        if (!ok) {
          if (this._isFriendBlocking(next, belief)) {
            await this._triggerCoordination(next);
            throw new ConflictDetectedError("blocked by friend");
          }
          // Movimento bloccato: exponential backoff e riprova
          blocked = true;
          retries++;
          if (retries < MAX_RETRIES) {
            const delay = BASE_DELAY_MS * Math.pow(2, retries - 1);
            await new Promise(r => setTimeout(r, delay));
          }
          break; // Esci dal for per ricalcolare il path
        }
        curX = next.x;
        curY = next.y;
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

  _nextCell(x, y, dir) {
    const delta = DIR_TO_DELTA[dir];
    if (!delta) return { x, y };
    return { x: x + delta.dx, y: y + delta.dy };
  }

  _isFriendBlocking(next, belief) {
    if (!belief || !this.parent.friendId || !belief.getAgent) return false;
    const friend = belief.getAgent(this.parent.friendId);
    if (!friend) return false;
    return Math.round(friend.x) === Math.round(next.x) && Math.round(friend.y) === Math.round(next.y);
  }

  async _triggerCoordination(blockedCell) {
    if (this.parent.comm && this.parent.comm.beginCoordinationProtocol) {
      await this.parent.comm.beginCoordinationProtocol({ blockedCell });
    }
  }
}

export { MoveBfs };
