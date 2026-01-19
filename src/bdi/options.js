/**
 * options.js - Intention Generation Module
 * 
 * Generates candidate intentions using simple nearest-parcel scoring.
 * Supports claim-based coordination for multi-agent scenarios.
 * Implements collaborative parcel delegation using FIPA REQUEST protocol.
 */

import { grid as globalGrid } from "../utils/grid.js";
import { defaultLogger } from '../utils/logger.js';
import { Msg } from './Msg.js';

// Cooldown tracking for REQUEST messages to avoid spam
const requestCooldowns = new Map(); // parcelId -> timestamp
const REQUEST_COOLDOWN_MS = 3000; // 3 seconds

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Checks if another agent is closer to the parcel than me.
 * Returns { contested: bool, penalty: number (0-1) }
 */
function getContentionPenalty(parcel, myX, myY, otherAgents, g) {
  const px = Math.round(parcel.x);
  const py = Math.round(parcel.y);
  const myDist = g.manhattanDistance(myX, myY, px, py);
  
  let minOtherDist = Infinity;
  for (const agent of otherAgents) {
    const agentDist = g.manhattanDistance(agent.x, agent.y, px, py);
    if (agentDist < minOtherDist) minOtherDist = agentDist;
  }
  
  // No other agent nearby
  if (minOtherDist === Infinity) return { contested: false, penalty: 1.0 };
  
  // Other agent is closer -> heavily contested
  if (minOtherDist < myDist) return { contested: true, penalty: 0.1 };
  
  // Same distance -> moderately contested
  if (minOtherDist === myDist) return { contested: true, penalty: 0.5 };
  
  // I'm closer but other is nearby
  if (minOtherDist <= myDist + 2) return { contested: false, penalty: 0.8 };
  
  return { contested: false, penalty: 1.0 };
}

/**
 * Returns free parcels sorted by distance, filtering out cooldown targets.
 * Implements ZONING strategy: agents prefer different halves based on ID hash.
 */
function getFreeParcelsWithScoring(belief, x, y, g, myId, friendId = null) {
  const parcels = belief.getFreeParcels();
  const otherAgents = belief.getOtherAgents(myId);
  const mapWidth = g.width;
  const halfWidth = mapWidth / 2;
  
  // Determine my zone based on string comparison of agent IDs
  // This ensures deterministic zone assignment for any ID format (string/number)
  const isFirstZone = friendId ? (String(myId) < String(friendId)) : true;
  
  const scored = parcels
    // Filter parcels on cooldown (recently failed targets)
    .filter(p => !(belief?.isOnCooldown && belief.isOnCooldown('parcel', p.id)))
    .map(p => {
      const dist = g.manhattanDistance(x, y, Math.round(p.x), Math.round(p.y));
      const contention = getContentionPenalty(p, x, y, otherAgents, g);
      // Zone logic: first agent prefers left (x < halfWidth), second prefers right
      const isInMyZone = (isFirstZone && p.x < halfWidth) || (!isFirstZone && p.x >= halfWidth);
      return { ...p, dist, contested: contention.contested, penalty: contention.penalty, isInMyZone };
    });
  
  // ZONING LOGIC: Filter by zone with fallback
  const myZoneParcels = scored.filter(p => p.isInMyZone);
  const parcelsToUse = myZoneParcels.length > 0 ? myZoneParcels : scored;
  
  // Sort: non-contested first, then by distance
  parcelsToUse.sort((a, b) => {
    if (a.contested !== b.contested) return a.contested ? 1 : -1;
    return a.dist - b.dist;
  });
  
  return parcelsToUse;
}

/**
 * Finds the nearest delivery zone from position (x, y).
 */
function findNearestDelivery(x, y, deliveryZones, g, belief) {
  let best = null;
  let bestDist = Infinity;
  
  for (const d of deliveryZones) {
    // Skip if on cooldown
    const key = d.x + ',' + d.y;
    if (belief?.isOnCooldown && belief.isOnCooldown('delivery', key)) continue;
    
    const dist = g.manhattanDistance(x, y, d.x, d.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  
  // Fallback: if all on cooldown, pick any
  if (!best && deliveryZones.length > 0) {
    for (const d of deliveryZones) {
      const dist = g.manhattanDistance(x, y, d.x, d.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
  }
  
  return { zone: best, dist: bestDist };
}

/**
 * Chooses a spawner to explore, avoiding positions near other agents.
 */
function chooseBestSpawner(spawners, myX, myY, otherAgents, g, belief) {
  if (spawners.length === 0) return null;
  
  let bestSpawner = null;
  let bestScore = -Infinity;
  
  for (const spawner of spawners) {
    // Skip if on cooldown
    const key = spawner.x + ',' + spawner.y;
    if (belief?.isOnCooldown && belief.isOnCooldown('tile', key)) continue;
    
    const myDist = g.manhattanDistance(myX, myY, spawner.x, spawner.y);
    
    // Find min distance of other agents to this spawner
    let minOtherDist = Infinity;
    for (const agent of otherAgents) {
      const agentDist = g.manhattanDistance(agent.x, agent.y, spawner.x, spawner.y);
      if (agentDist < minOtherDist) minOtherDist = agentDist;
    }
    
    // Score: prefer spawners close to me but far from others
    const score = (minOtherDist === Infinity ? 20 : minOtherDist) - myDist * 0.5;
    
    if (score > bestScore) {
      bestScore = score;
      bestSpawner = spawner;
    }
  }
  
  // Fallback: if all on cooldown, pick the nearest one
  if (!bestSpawner && spawners.length > 0) {
    let nearestDist = Infinity;
    for (const s of spawners) {
      const dist = g.manhattanDistance(myX, myY, s.x, s.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        bestSpawner = s;
      }
    }
  }
  
  return bestSpawner;
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Generates intentions based on current belief state.
 * Uses simple nearest-parcel scoring with claim coordination.
 */
function optionsGeneration({ me, belief, grid, push, comm }) {
  const g = grid || globalGrid;
  if (!g || me.x === undefined || me.y === undefined) return;
  
  // Skip if agent is in handoff protocol (let the protocol complete)
  if (me.isInHandoff && me.isInHandoff()) return;

  const deliveryZones = belief.deliveryZones;
  const loss = me.lossForMovement || 0;
  const capacity = me.capacity || 4;
  const otherAgents = belief.getOtherAgents(me.id);

  // Don't interrupt useful intentions (except go_random)
  if (me.intentions.length > 0) {
    const current = me.intentions[0]?.predicate?.[0];
    if (current !== 'go_random') return;
    const parcels = belief.getFreeParcels();
    if (me.carried === 0 && parcels.length === 0) return;
    me.intentions[0]?.stop?.();
    me.intentions.shift();
  }

  // Get nearest delivery zone
  const { zone: nearestDelivery, dist: distToDelivery } = findNearestDelivery(
    me.x, me.y, deliveryZones, g, belief
  );

  // Get free parcels sorted by distance and contention
  const candidates = getFreeParcelsWithScoring(belief, me.x, me.y, g, me.id, me.friendId);
  const contestedCount = candidates.filter(p => p.contested).length;

  defaultLogger.hot('optionsSummary', 2000, 'options:', 
    'carried=' + me.carried + '/' + capacity,
    'reward=' + me.carriedReward,
    'parcels=' + candidates.length + (contestedCount > 0 ? ' (' + contestedCount + ' contested)' : ''),
    'agents=' + otherAgents.length
  );

  // -------------------------------------------------------------------------
  // OPTION 1: PICK UP (if capacity available and parcels exist)
  // -------------------------------------------------------------------------
  let pickupScore = -Infinity;
  let bestParcel = null;
  
  if (me.carried < capacity && candidates.length > 0) {
    // Clean expired cooldowns
    const now = Date.now();
    for (const [pid, expiry] of requestCooldowns.entries()) {
      if (now >= expiry) requestCooldowns.delete(pid);
    }
    
    // Get friend agent position if available
    let friendAgent = null;
    if (me.friendId && belief.agents) {
      friendAgent = belief.agents.get(me.friendId);
    }
    
    // Evaluate parcels with collaborative delegation
    for (const parcel of candidates) {
      const px = Math.round(parcel.x);
      const py = Math.round(parcel.y);
      const myDist = g.manhattanDistance(me.x, me.y, px, py);
      
      // CLAIM CHECK: Skip parcels already claimed by friend (unless I'm much closer)
      const existingClaim = belief.isParcelClaimed(parcel.id);
      if (existingClaim && existingClaim.agentId !== me.id) {
        // Friend has a claim - only compete if I'm significantly closer
        if (friendAgent) {
          const friendDist = g.manhattanDistance(friendAgent.x, friendAgent.y, px, py);
          if (myDist >= friendDist * 0.7) {
            // Friend is close enough to their claim, skip this parcel
            continue;
          }
        } else {
          // Can't see friend, respect their claim
          continue;
        }
      }
      
      // COLLABORATIVE LOGIC: delegate if friend is significantly closer
      if (friendAgent && comm?.isReady()) {
        const friendDist = g.manhattanDistance(friendAgent.x, friendAgent.y, px, py);
        const threshold = myDist * 0.6; // Friend must be < 60% of my distance
        
        // Check if parcel is NOT in my critical zone (very close to me)
        const inMyCriticalZone = myDist <= 3;
        
        if (friendDist < threshold && !inMyCriticalZone && !requestCooldowns.has(parcel.id)) {
          // Delegate to friend via REQUEST
          defaultLogger.hot('delegate', 3000, 'Delegating ' + parcel.id + ' to friend (myDist=' + myDist + ', friendDist=' + friendDist + ')');
          
          const requestMsg = Msg.request(parcel);
          comm.adapter.say(comm.friendId, requestMsg).catch(err => 
            console.error('[COMM] Failed to send REQUEST:', err)
          );
          
          // Set cooldown to avoid spam
          requestCooldowns.set(parcel.id, now + REQUEST_COOLDOWN_MS);
          continue; // Skip this parcel, try next one
        }
      }
      
      // Parcel not delegated, evaluate it for myself
      const distToParcel = myDist;
      const { dist: deliveryFromParcel } = findNearestDelivery(px, py, deliveryZones, g, belief);
      
      // Score: parcel reward - movement cost (to parcel + to delivery)
      const totalDist = distToParcel + deliveryFromParcel;
      const moveCost = totalDist * loss * (me.carried + 1);
      const score = ((parcel.reward || 1) + me.carriedReward - moveCost) * parcel.penalty;
      
      if (score > pickupScore) {
        pickupScore = score;
        bestParcel = parcel;
      }
      
      // Stop at first good candidate (already sorted by distance/contention)
      if (pickupScore > 0) break;
    }
  }

  // -------------------------------------------------------------------------
  // OPTION 2: DELIVER NOW (if carrying parcels)
  // -------------------------------------------------------------------------
  let deliverScore = -Infinity;
  if (me.carried > 0 && nearestDelivery) {
    const deliverCost = distToDelivery * loss * me.carried;
    deliverScore = me.carriedReward - deliverCost;
  }

  // -------------------------------------------------------------------------
  // DECISION LOGIC
  // -------------------------------------------------------------------------

  // Case A: Pickup is the best option
  if (bestParcel && pickupScore > deliverScore && pickupScore > 0) {
    const px = Math.round(bestParcel.x);
    const py = Math.round(bestParcel.y);
    
    // Check if friend has a higher-priority claim
    const yieldInfo = belief.shouldYieldClaim(bestParcel.id, me.id, pickupScore);
    if (yieldInfo) {
      defaultLogger.hot('yield', 3000, 'Yielding ' + bestParcel.id + ' to friend (' + yieldInfo.reason + ')');
      // Try next parcel or fallback to deliver
      if (me.carried > 0 && nearestDelivery) {
        push(['go_deliver', nearestDelivery.x, nearestDelivery.y, 'deliver', deliverScore]);
        return;
      }
    } else {
      // Register claim and communicate
      const claim = ['go_pick_up', px, py, bestParcel.id, pickupScore];
      belief.registerClaim(me.id, claim);
      if (comm?.isReady()) comm.sendIntention(claim);
      
      defaultLogger.hot('pickup', 3000, '-> go_pick_up (' + px + ',' + py + ') id=' + bestParcel.id + ' score=' + pickupScore.toFixed(2));
      push(['go_pick_up', px, py, bestParcel.id, pickupScore]);
      return;
    }
  }

  // Case B: Deliver is the best option
  if (me.carried > 0 && nearestDelivery && deliverScore > 0) {
    defaultLogger.hot('deliver', 3000, '-> go_deliver (' + nearestDelivery.x + ',' + nearestDelivery.y + ') score=' + deliverScore.toFixed(2));
    push(['go_deliver', nearestDelivery.x, nearestDelivery.y, 'deliver', deliverScore]);
    return;
  }

  // Case C: Carrying parcels but no positive option -> deliver anyway
  if (me.carried > 0 && nearestDelivery) {
    defaultLogger.hot('deliverFallback', 5000, '-> go_deliver (fallback)');
    push(['go_deliver', nearestDelivery.x, nearestDelivery.y, 'deliver', 0]);
    return;
  }

  // Case D: No parcels carried, explore spawners
  if (belief.parcelSpawners?.length > 0) {
    if (belief?.isOnCooldown && belief.isOnCooldown('parcel', 'explore')) {
      defaultLogger.hot('exploreCooldown', 5000, '-> explore on cooldown');
    } else {
      const spawner = chooseBestSpawner(belief.parcelSpawners, me.x, me.y, otherAgents, g, belief);
      if (spawner) {
        defaultLogger.hot('explore', 3000, '-> go_to spawner (' + spawner.x + ',' + spawner.y + ')');
        push(['go_pick_up', spawner.x, spawner.y, 'explore', 0]);
        return;
      }
    }
  }

  // Case E: Fallback to random movement
  defaultLogger.hot('random', 5000, '-> go_random');
  push(['go_random', me.x ?? 0, me.y ?? 0, 'rnd', 0]);
}

export { optionsGeneration };
