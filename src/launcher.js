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
  }
});

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
