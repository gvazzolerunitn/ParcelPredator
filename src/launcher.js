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
  // Aggiorna me.carried in base ai pacchi che hanno carriedBy === me.id
  const carriedByMe = parcels.filter(p => p.carriedBy === me.id);
  me.carried = carriedByMe.length;
  optionsGeneration({ me, belief, grid: gridRef, push: (p)=>me.push(p) });
});

adapter.onAgents((agents) => {
  agents.forEach(a => belief.addAgent(a));
});

adapter.onConfig((cfg) => {
  console.log("server config", cfg);
});

// Avvia loop dell'agente
me.loop();

// Stampa token per incollarlo nella UI se serve
if (client.token && typeof client.token.then === 'function') {
  client.token.then(t => console.log('AGENT TOKEN:', t)).catch(()=>{});
}
