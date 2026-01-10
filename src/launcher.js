import config from "./config/default.js";
import { client } from "./client/context.js";
import { adapter } from "./client/adapter.js";
import { Agent } from "./bdi/agent.js";
import { Belief } from "./bdi/belief.js";
import { optionsGeneration } from "./bdi/options.js";
import { Grid, setGrid } from "./utils/grid.js";

const belief = new Belief();
const me = new Agent();
let gridRef = null;

// Collega riferimenti all'agente per il loop
me.belief = belief;
me.optionsGeneration = optionsGeneration;
me.carried_parcels = []; // Lista dei pacchi trasportati {id, reward}

// Hook events
adapter.onConnect(() => console.log("connected"));
adapter.onDisconnect(() => console.log("disconnected"));

adapter.onYou(({ id, name, x, y, score, carried }) => {
  me.setValues({ id, name, x, y, score, carried });
  optionsGeneration({ me, belief, grid: gridRef, push: (p)=>me.push(p) });
});

adapter.onMap((w, h, tiles) => {
  const g = new Grid(w, h, tiles);
  setGrid(g);
  gridRef = g;
  me.grid = g;
  // Aggiorna spawners/delivery nelle credenze (type può essere stringa o numero)
  belief.parcelSpawners = tiles.filter(t => t.type == 1 || t.type === '1').map(t => ({x:t.x,y:t.y}));
  belief.deliveryZones = tiles.filter(t => t.type == 2 || t.type === '2').map(t => ({x:t.x,y:t.y}));
  console.log('MAP loaded:', w, 'x', h, '| spawners:', belief.parcelSpawners.length, '| delivery zones:', belief.deliveryZones.length);
});

adapter.onParcels((parcels) => {
  belief.syncParcels(parcels);
  // Aggiorna me.carried e carriedReward in base ai pacchi che hanno carriedBy === me.id
  const carriedByMe = parcels.filter(p => p.carriedBy === me.id);
  me.carried = carriedByMe.length;
  me.carriedReward = carriedByMe.reduce((sum, p) => sum + (p.reward || 0), 0);
  optionsGeneration({ me, belief, grid: gridRef, push: (p)=>me.push(p) });
});

adapter.onAgents((agents) => {
  belief.syncAgents(agents);
});

adapter.onConfig((cfg) => {
  console.log("server config", cfg);
  
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
  console.log('lossForMovement:', me.lossForMovement.toFixed(4), '| lossForSecond:', lossPerSecond.toFixed(4));
});

// Avvia loop dell'agente
me.loop();

// Stampa token per incollarlo nella UI se serve
if (client.token && typeof client.token.then === 'function') {
  client.token.then(t => console.log('AGENT TOKEN:', t)).catch(()=>{});
}
