import config from "./config/default.js";
import { client, isSecondAgent, agentLabel } from "./client/context.js";
import { adapter } from "./client/adapter.js";
import { Agent } from "./bdi/agent.js";
import { Belief } from "./bdi/belief.js";
import { optionsGeneration } from "./bdi/options.js";
import { Grid, setGrid } from "./utils/grid.js";
import { Comm } from "./bdi/comm.js";
import { defaultLogger, commLogger, ThrottledLogger } from './utils/logger.js';

const belief = new Belief();
const me = new Agent();
let gridRef = null;

// Initialize communication module (will be activated after connect if DUAL mode)
const comm = new Comm(adapter, me, belief, config);

// Collega riferimenti all'agente per il loop
me.belief = belief;
me.optionsGeneration = optionsGeneration;
me.carried_parcels = []; // Lista dei pacchi trasportati {id, reward}
me.isSecondAgent = isSecondAgent;
me.comm = comm; // Reference to comm module for claim coordination

// Hook events
adapter.onConnect(async () => {
  defaultLogger.info(`[${agentLabel}] connected`);
  
  // If DUAL mode enabled, initialize communication
  if (config.DUAL) {
    await comm.init(isSecondAgent);
  }
});

adapter.onDisconnect(() => defaultLogger.info(`[${agentLabel}] disconnected`));

adapter.onYou(({ id, name, x, y, score, carried }) => {
  me.setValues({ id, name, x, y, score, carried });
  optionsGeneration({ me, belief, grid: gridRef, push: (p)=>me.push(p), comm });
});

adapter.onMap((w, h, tiles) => {
  const g = new Grid(w, h, tiles);
  setGrid(g);
  gridRef = g;
  me.grid = g;
  // Aggiorna spawners/delivery nelle credenze (type può essere stringa o numero)
  belief.parcelSpawners = tiles.filter(t => t.type == 1 || t.type === '1').map(t => ({x:t.x,y:t.y}));
  belief.deliveryZones = tiles.filter(t => t.type == 2 || t.type === '2').map(t => ({x:t.x,y:t.y}));
  defaultLogger.info('MAP loaded:', `${w}x${h}`, '| spawners:', belief.parcelSpawners.length, '| delivery zones:', belief.deliveryZones.length);
});

adapter.onParcels((parcels) => {
  belief.syncParcels(parcels);
  // Aggiorna me.carried e carriedReward in base ai pacchi che hanno carriedBy === me.id
  const carriedByMe = parcels.filter(p => p.carriedBy === me.id);
  me.carried = carriedByMe.length;
  me.carriedReward = carriedByMe.reduce((sum, p) => sum + (p.reward || 0), 0);
  
  // In DUAL mode, send parcels info to friend
  if (config.DUAL && comm.isReady()) {
    comm.sendParcels(parcels);
  }
  
  optionsGeneration({ me, belief, grid: gridRef, push: (p)=>me.push(p), comm });
});

adapter.onAgents((agents) => {
  // Pass our id to avoid overwriting our own entry in belief
  belief.syncAgents(agents, me.id);
  
  // In DUAL mode, send agents info to friend (exclude self)
  if (config.DUAL && comm.isReady()) {
    const agentsToSend = agents.filter(a => a.id !== me.id);
    comm.sendAgents(agentsToSend);
  }
});

adapter.onConfig((cfg) => {
  defaultLogger.info('server config', cfg);
  
  // Calcola lossPerSecond in base a PARCEL_DECADING_INTERVAL
  // Formati possibili: 'infinite', '1000ms', '1s', 1000 (numero), '1000' (stringa numerica)
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
      lossPerSecond = 1000 / intervalMs; // 1 reward perso ogni intervalMs ms
    }
  }
  
  // Calcola movesPerSecond in base a MOVEMENT_DURATION
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
  defaultLogger.info('lossForMovement:', me.lossForMovement.toFixed(4), '| lossForSecond:', lossPerSecond.toFixed(4));
});

// ============================================================================
// DUAL MODE: Register message handlers for receiving belief from friend
// ============================================================================
if (config.DUAL) {
  // Statistics for periodic summary
  const commStats = {
    parcelsReceived: 0,
    agentsReceived: 0,
    intentionsReceived: 0,
    lastLogTime: Date.now()
  };

  // Periodic summary logger (avoids flooding stdout)
  const logCommSummary = () => {
    const now = Date.now();
    const interval = config.COMM_SUMMARY_INTERVAL || 5000;
      if (now - commStats.lastLogTime >= interval) {
      if (commStats.parcelsReceived > 0 || commStats.agentsReceived > 0 || commStats.intentionsReceived > 0) {
        commLogger.hot('summary', interval, `Summary: ${commStats.parcelsReceived} parcel msgs, ${commStats.agentsReceived} agent msgs, ${commStats.intentionsReceived} intentions (last ${interval/1000}s)`);
      }
      commStats.parcelsReceived = 0;
      commStats.agentsReceived = 0;
      commStats.intentionsReceived = 0;
      commStats.lastLogTime = now;
    }
  };

  // Handle parcels info from friend (full sync)
  comm.on('INFO_PARCELS', (senderId, parcels, reply) => {
    commStats.parcelsReceived++;
    belief.mergeRemoteParcels(parcels);
    logCommSummary();
  });

  // Handle parcels delta from friend (diff-only)
  comm.on('INFO_PARCELS_DELTA', (senderId, delta, reply) => {
    commStats.parcelsReceived++;
    belief.applyParcelsDelta(delta);
    logCommSummary();
  });

  // Handle agents info from friend (full sync)
  comm.on('INFO_AGENTS', (senderId, agents, reply) => {
    commStats.agentsReceived++;
    belief.mergeRemoteAgents(agents, me.id);
    logCommSummary();
  });

  // Handle agents delta from friend (diff-only)
  comm.on('INFO_AGENTS_DELTA', (senderId, delta, reply) => {
    commStats.agentsReceived++;
    belief.applyAgentsDelta(delta, me.id);
    logCommSummary();
  });

  // Handle intention from friend (for claim-based coordination)
  comm.on('INTENTION', (senderId, predicate, reply) => {
    commStats.intentionsReceived++;
    if (config.DEBUG) {
      console.log(`[COMM] Friend intention: ${predicate.join(' ')}`);
    }
    belief.registerClaim(senderId, predicate);
    logCommSummary();
  });
}

// Avvia loop dell'agente
me.loop();

// Stampa token per incollarlo nella UI se serve
if (client.token && typeof client.token.then === 'function') {
  client.token.then(t => defaultLogger.info('AGENT TOKEN:', ThrottledLogger.maskToken(t))).catch(()=>{});
}
