/**
 * launcher.js - Agent Entry Point
 * 
 * Initializes the agent, connects to server, and sets up event handlers.
 */

import config from "./config/default.js";
import { client, isSecondAgent, agentLabel } from "./client/context.js";
import { adapter } from "./client/adapter.js";
import { Agent } from "./bdi/agent.js";
import { Belief } from "./bdi/belief.js";
import { optionsGeneration } from "./bdi/options.js";
import { Grid, setGrid } from "./utils/grid.js";
import { Comm } from "./bdi/comm.js";
import { defaultLogger } from './utils/logger.js';
import { initRunLogger, runLogger } from './utils/runLogger.js';

// Initialize core components
const belief = new Belief();
const me = new Agent();
let gridRef = null;

// Initialize communication module
const comm = new Comm(adapter, me, belief, config);

// Initialize unified run logger
initRunLogger(config);

// Link references to agent
me.belief = belief;
me.optionsGeneration = optionsGeneration;
me.carried_parcels = [];
me.isSecondAgent = isSecondAgent;
me.comm = comm;

// ============================================================================
// EVENT HANDLERS
// ============================================================================

adapter.onConnect(async () => {
  defaultLogger.info('[' + agentLabel + '] connected');
  
  if (config.DUAL) {
    await comm.init(isSecondAgent);
  }
});

adapter.onDisconnect(async () => {
  defaultLogger.info('[' + agentLabel + '] disconnected');
});

adapter.onYou(({ id, name, x, y, score, carried }) => {
  me.setValues({ id, name, x, y, score, carried });
  runLogger.updateScore({ id, name, score });
  runLogger.recordEvent('onYou');
  optionsGeneration({ me, belief, grid: gridRef, push: (p) => me.push(p), comm });
});

adapter.onMap((w, h, tiles) => {
  const g = new Grid(w, h, tiles);
  setGrid(g);
  gridRef = g;
  me.grid = g;
  
  belief.parcelSpawners = tiles.filter(t => t.type == 1 || t.type === '1').map(t => ({ x: t.x, y: t.y }));
  belief.deliveryZones = tiles.filter(t => t.type == 2 || t.type === '2').map(t => ({ x: t.x, y: t.y }));
  
  defaultLogger.info('MAP loaded: ' + w + 'x' + h + ' | spawners: ' + belief.parcelSpawners.length + ' | delivery: ' + belief.deliveryZones.length);
});

adapter.onParcels((parcels) => {
  belief.syncParcels(parcels);
  
  const carriedByMe = parcels.filter(p => p.carriedBy === me.id);
  me.carried = carriedByMe.length;
  me.carriedReward = carriedByMe.reduce((sum, p) => sum + (p.reward || 0), 0);
  
  // Log latency (one event per batch)
  runLogger.recordEvent('onParcels');
  
  if (config.DUAL && comm.isReady()) {
    comm.sendParcels(parcels);
  }
  
  optionsGeneration({ me, belief, grid: gridRef, push: (p) => me.push(p), comm });
});

adapter.onAgents((agents) => {
  belief.syncAgents(agents, me.id);
  
  // Log latency (one event per batch)
  runLogger.recordEvent('onAgents');
  
  if (config.DUAL && comm.isReady()) {
    const agentsToSend = agents.filter(a => a.id !== me.id);
    comm.sendAgents(agentsToSend);
    
    // =========================================================================
    // CORRIDOR DEADLOCK DETECTION: Trigger handoff protocol when stuck
    // =========================================================================
    // Deterministic initiator to avoid race: the agent with lower id
    if (!me.isInHandoff() && me.friendId && me.id && String(me.id) < String(me.friendId)) {
      const friend = belief.getAgent(me.friendId);
      if (friend && gridRef && belief.deliveryZones?.length > 0) {
        const myX = Math.round(me.x);
        const myY = Math.round(me.y);
        const friendX = Math.round(friend.x);
        const friendY = Math.round(friend.y);
        const dx = Math.abs(myX - friendX);
        const dy = Math.abs(myY - friendY);
        
        // Check if we're adjacent (potential corridor situation)
        if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) {
          // Count escape routes for each agent
          const myEscapeRoutes = getEscapeRoutes(myX, myY, agents, gridRef);
          const friendEscapeRoutes = getEscapeRoutes(friendX, friendY, agents, gridRef);
          
          // Corridor deadlock: both have limited movement options
          if (myEscapeRoutes.length <= 1 && friendEscapeRoutes.length <= 1) {
            const friendCarried = belief.getParcelsArray().filter(p => p.carriedBy === me.friendId).length;
            
            // Only initiate if one has parcels and other doesn't (handoff makes sense)
            if ((me.carried > 0 && friendCarried === 0) || (me.carried === 0 && friendCarried > 0)) {
              const nearestDelivery = belief.deliveryZones[0];
              const myDist = gridRef.manhattanDistance(myX, myY, nearestDelivery.x, nearestDelivery.y);
              const friendDist = gridRef.manhattanDistance(friendX, friendY, nearestDelivery.x, nearestDelivery.y);
              
              // Agent with parcels farther from delivery should initiate handoff
              const iShouldHandoff = me.carried > 0 && myDist > friendDist;
              const friendShouldHandoff = friendCarried > 0 && friendDist > myDist;
              
              if (iShouldHandoff || friendShouldHandoff) {
                defaultLogger.info(`[HANDOFF] Corridor deadlock detected, initiating protocol (initiator=${me.id})`);
                // send escape cell info so partner knows where to retreat to / drop
                const escape = myEscapeRoutes[0] || null;
                comm.initiateHandoff(escape);
              }
            }
          }
        }
      }
    }
  }
});

/** Helper: Get cells where agent can move (not blocked by other agents) */
function getEscapeRoutes(x, y, agents, grid) {
  const adjacent = [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 }
  ];
  return adjacent.filter(cell => {
    if (!grid.isAccessible(cell.x, cell.y)) return false;
    const occupied = agents.some(a => Math.round(a.x) === cell.x && Math.round(a.y) === cell.y);
    return !occupied;
  });
}

adapter.onConfig((cfg) => {
  defaultLogger.info('Server config received');
  
  // Calculate loss per second from decay interval
  let lossPerSecond = 0;
  const decayInterval = cfg.PARCEL_DECADING_INTERVAL;
  if (decayInterval && decayInterval !== 'infinite') {
    let intervalMs;
    if (typeof decayInterval === 'number') {
      intervalMs = decayInterval;
    } else if (typeof decayInterval === 'string') {
      const str = decayInterval.trim().toLowerCase();
      if (str.endsWith('ms')) {
        intervalMs = parseFloat(str.replace('ms', ''));
      } else if (str.endsWith('s')) {
        intervalMs = parseFloat(str.replace('s', '')) * 1000;
      } else {
        intervalMs = parseFloat(str);
      }
    }
    if (intervalMs && !isNaN(intervalMs) && intervalMs > 0) {
      lossPerSecond = 1000 / intervalMs;
    }
  }
  
  // Calculate moves per second from movement duration
  let movesPerSecond = 1;
  const moveDuration = cfg.MOVEMENT_DURATION;
  if (moveDuration) {
    const durationMs = typeof moveDuration === 'number' ? moveDuration : parseFloat(moveDuration);
    if (durationMs && !isNaN(durationMs) && durationMs > 0) {
      movesPerSecond = 1000 / durationMs;
    }
  }
  
  me.lossForMovement = lossPerSecond / movesPerSecond;
  me.lossForSecond = lossPerSecond;
  belief.setLossForSecond(lossPerSecond);
  
  defaultLogger.info('Loss/move: ' + me.lossForMovement.toFixed(4));
  
  // Initialize run logger with server config
  const mapName = cfg.MAP_FILE || cfg.MAP || cfg.LEVEL || 'unknown';
  const randomAgents = cfg.RANDOMLY_MOVING_AGENTS || 0;
  runLogger.init(mapName, randomAgents);
});

// ============================================================================
// DUAL MODE: Message handlers for partner communication
// ============================================================================

if (config.DUAL) {
  // Handle parcels from partner
  comm.on('INFO_PARCELS', (senderId, parcels, reply) => {
    belief.mergeRemoteParcels(parcels);
  });

  // Handle agents from partner
  comm.on('INFO_AGENTS', (senderId, agents, reply) => {
    belief.mergeRemoteAgents(agents, me.id);
  });

  // Handle intention from partner (claim coordination)
  comm.on('INTENTION', (senderId, predicate, reply) => {
    if (config.DEBUG) {
      console.log('[COMM] Partner intention: ' + predicate.join(' '));
    }
    belief.registerClaim(senderId, predicate);
  });

  // Handle COMPLETE notification (partner picked up a parcel)
  comm.on('COMPLETE', (senderId, data, reply) => {
    const { parcelId, success } = data;
    if (success && parcelId) {
      // Remove parcel from belief (partner successfully picked it up)
      belief.removeParcel(parcelId);
      // Clear any cooldown for this parcel
      belief.clearCooldown('parcel', parcelId);
      defaultLogger.hot('partnerComplete', 3000, 'Partner completed pickup of ' + parcelId);
    }
  });

  // =========================================================================
  // HANDOFF PROTOCOL: Coordinate parcel transfer in narrow passages
  // =========================================================================
  comm.on('HANDOFF', async (senderId, data, reply) => {
    const { phase, escapeCell } = data;
    
    // Enter handoff state to pause normal behavior
    me.setHandoffState(true);
    
    // Stop any current intention
    if (me.intentions.length > 0) {
      me.intentions[0]?.stop?.();
      me.intentions = [];
    }
    
    const myX = Math.round(me.x);
    const myY = Math.round(me.y);
    const friendCarried = belief.getParcelsArray().filter(p => p.carriedBy === me.friendId).length;
    
    if (phase === 'START') {
      // Partner initiated handoff, I need to respond
      defaultLogger.info('[HANDOFF] Received START from partner');
      
      // Find my escape route
      const myEscapes = getEscapeRoutes(myX, myY, belief.getAgentsArray(), gridRef);
      const myEscape = myEscapes[0];
      
      if (myEscape) {
        if (me.carried > 0) {
          // I have parcels: drop them and retreat
          await adapter.putdown();
          me.carried = 0;
          me.carriedReward = 0;
          me.carried_parcels = [];
          await adapter.move(gridRef.getDirection(myX, myY, myEscape.x, myEscape.y));
          comm.sendHandoff('DROPPED', myEscape);
        } else {
          // I don't have parcels: retreat and signal partner to drop
          await adapter.move(gridRef.getDirection(myX, myY, myEscape.x, myEscape.y));
          comm.sendHandoff('RETREATED', myEscape);
        }
      } else {
        // Can't move, abort
        me.setHandoffState(false);
        comm.sendHandoff('ABORT', null);
      }
    }
    else if (phase === 'DROPPED') {
      // Partner dropped parcels and retreated, I pick them up
      defaultLogger.info('[HANDOFF] Partner dropped parcels, picking up');
      
      // Find cell with parcels nearby
      const nearbyParcels = belief.getParcelsArray().filter(p => {
        if (p.carriedBy) return false;
        const dist = Math.abs(Math.round(p.x) - myX) + Math.abs(Math.round(p.y) - myY);
        return dist <= 2;
      });
      
      if (nearbyParcels.length > 0) {
        const parcel = nearbyParcels[0];
        const px = Math.round(parcel.x);
        const py = Math.round(parcel.y);
        
        if (px !== myX || py !== myY) {
          await adapter.move(gridRef.getDirection(myX, myY, px, py));
        }
        await adapter.pickup();
        defaultLogger.info('[HANDOFF] Picked up parcels, completing');
      }
      
      me.setHandoffState(false);
      comm.sendHandoff('DONE', null);
    }
    else if (phase === 'RETREATED') {
      // Partner retreated, now I drop my parcels for them
      defaultLogger.info('[HANDOFF] Partner retreated, dropping parcels');
      
      if (me.carried > 0) {
        // Move toward where partner was, drop parcels
        const friend = belief.getAgent(me.friendId);
        if (friend && escapeCell) {
          // Move one step toward the escape cell (where parcels should go)
          const targetX = escapeCell.x;
          const targetY = escapeCell.y;
          await adapter.move(gridRef.getDirection(myX, myY, targetX, targetY));
          await adapter.putdown();
          me.carried = 0;
          me.carriedReward = 0;
          me.carried_parcels = [];
          // Move back
          const newX = Math.round(me.x);
          const newY = Math.round(me.y);
          await adapter.move(gridRef.getDirection(newX, newY, myX, myY));
        }
        comm.sendHandoff('DROPPED', null);
      } else {
        me.setHandoffState(false);
        comm.sendHandoff('DONE', null);
      }
    }
    else if (phase === 'DONE' || phase === 'ABORT') {
      // Handoff completed or aborted
      defaultLogger.info('[HANDOFF] Protocol ' + (phase === 'DONE' ? 'completed' : 'aborted'));
      me.setHandoffState(false);
    }
  });
}

// ============================================================================
// START AGENT
// ============================================================================

me.loop();

defaultLogger.info('Agent started' + (config.DUAL ? ' (DUAL mode)' : ''));

// Graceful shutdown - save unified run report
process.on('SIGINT', async () => {
  console.log('\n[SHUTDOWN] Saving run report...');
  await runLogger.save();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await runLogger.save();
  process.exit(0);
});
