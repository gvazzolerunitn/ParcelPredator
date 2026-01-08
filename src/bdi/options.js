// optionsGeneration: produce intenzioni candidate
// Per ora versione minimale: se vede un pacco non raccolto, punta a quello; se trasporta pacchi e vede delivery, consegna; altrimenti random.
import { grid as globalGrid } from "../utils/grid.js";

function optionsGeneration({ me, belief, grid, push }) {
  const g = grid || globalGrid;
  if (!g || me.x === undefined || me.y === undefined) return;
  // evita di interrompere continuamente: se c'è già un'intenzione attiva lasciala finire
  if (me.intentions.length > 0) return;

  const parcels = belief.getParcelsArray().filter(p => !p.carriedBy);
  const deliveryZones = belief.deliveryZones;

  // Se sto trasportando, consegna verso delivery più vicino
  if (me.carried > 0 && deliveryZones.length > 0) {
    const target = deliveryZones
      .map(d => ({ d, dist: g.manhattanDistance(me.x, me.y, d.x, d.y) }))
      .sort((a,b)=>a.dist-b.dist)[0].d;
    push(['go_deliver', target.x, target.y, 'deliver', 0]);
    return;
  }

  // Se c'è almeno un pacco, scegli il più vicino per Manhattan
  if (parcels.length > 0) {
    const p = parcels
      .map(p => ({ p, dist: g.manhattanDistance(me.x, me.y, p.x, p.y) }))
      .sort((a,b)=>a.dist-b.dist)[0].p;
    push(['go_pick_up', Math.round(p.x), Math.round(p.y), p.id, p.reward || 0]);
    return;
  }

  // fallback random
  push(['go_random', me.x ?? 0, me.y ?? 0, 'rnd', 0]);
}

export { optionsGeneration };
