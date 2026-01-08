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
  // Aggiorna spawners/delivery nelle credenze
  belief.parcelSpawners = tiles.filter(t => t.type === 1).map(t => ({x:t.x,y:t.y}));
  belief.deliveryZones = tiles.filter(t => t.type === 2).map(t => ({x:t.x,y:t.y}));
});

adapter.onParcels((parcels) => {
  parcels.forEach(p => belief.addParcel(p));
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
