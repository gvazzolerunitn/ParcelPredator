import { adapter } from "../../client/adapter.js";
import { grid } from "../../utils/grid.js";
import { ConflictDetectedError } from "../errors.js";

// ============================================================================
// RETRY AND BACKOFF CONFIGURATION
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
// TARGET COOLDOWN: avoid retrying the same target right after failures
// ============================================================================
const targetCooldown = new Map(); // key: "x,y" -> { until: timestamp, failures: count }
const COOLDOWN_BASE_MS = 2000;
const MAX_COOLDOWN_MS = 10000;

/**
 * Check whether a target is on cooldown
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
 * Record a target failure and increase cooldown
 */
function markTargetFailed(x, y) {
  const key = `${Math.round(x)},${Math.round(y)}`;
  const entry = targetCooldown.get(key) || { until: 0, failures: 0 };
  entry.failures++;
  // Exponential cooldown: 2s, 4s, 8s, max 10s
  const cooldownMs = Math.min(COOLDOWN_BASE_MS * Math.pow(2, entry.failures - 1), MAX_COOLDOWN_MS);
  entry.until = Date.now() + cooldownMs;
  targetCooldown.set(key, entry);
}

/**
 * Clear target cooldown on success
 */
function clearTargetCooldown(x, y) {
  const key = `${Math.round(x)},${Math.round(y)}`;
  targetCooldown.delete(key);
}

/**
 * Build a set of blocked cells from agent positions
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
   * Execute BFS movement toward (x, y)
   * @param {string} _desire - desire type (ignored)
   * @param {number} x - target x
   * @param {number} y - target y
   * @param {object} belief - optional belief for agent-aware pathfinding
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
      
      // Already at target
      if (sx === tx && sy === ty) {
        clearTargetCooldown(tx, ty);
        return true;
      }
      
      // Get cells blocked by other agents (includes friend's destination)
      const blockedCells = belief ? getBlockedCells(belief, this.parent.id, this.parent.friendId) : null;
      
      // Try agent-aware path first, then fall back to normal path
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
        
        // emitMove returns {x,y} on success, false if blocked
        // Use !ok to catch false, undefined, or null
        if (!ok) {
          if (this._isFriendBlocking(next, belief)) {
            const started = await this._triggerCoordination(next);
            throw new ConflictDetectedError(started ? "handoff_immediate_exit" : "blocked by friend");
          }
          // Movement blocked: exponential backoff and retry
          blocked = true;
          retries++;
          if (retries < MAX_RETRIES) {
            const delay = BASE_DELAY_MS * Math.pow(2, retries - 1);
            await new Promise(r => setTimeout(r, delay));
          }
          break; // Exit loop to recompute path
        }
        curX = next.x;
        curY = next.y;
      }
      
      if (!blocked) {
        clearTargetCooldown(tx, ty);
        return true; // Path completed successfully
      }
    }
    
    // After MAX_RETRIES, record failure and throw
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
      const started = await this.parent.comm.beginCoordinationProtocol({ blockedCell });
      return !!started;
    }
    return false;
  }
}

export { MoveBfs };
