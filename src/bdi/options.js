// optionsGeneration: produce intenzioni candidate
// Per ora versione minimale: se vede un pacco non raccolto, punta a quello; se trasporta pacchi e vede delivery, consegna; altrimenti random.
import { grid as globalGrid } from "../utils/grid.js";

function optionsGeneration({ me, belief, grid, push }) {
  const g = grid || globalGrid;
  if (!g || me.x === undefined || me.y === undefined) return;

  const parcels = belief.getFreeParcels();
  const deliveryZones = belief.deliveryZones;

  // Se c'e' gia' un'intenzione, interrompi solo se e' go_random e c'e' un pacco o devo consegnare
  if (me.intentions.length > 0) {
    const current = me.intentions[0]?.predicate?.[0];
    // Se sto gia' facendo qualcosa di utile, non interrompere
    if (current !== 'go_random') return;
    // Se go_random ma non c'e' nulla di meglio, lascia stare
    if (me.carried === 0 && parcels.length === 0) return;
    // Altrimenti interrompi go_random
    me.intentions[0]?.stop?.();
    me.intentions.shift();
  }

  // Debug log
  console.log('options: carried=', me.carried, 'parcels=', parcels.length, 'deliveryZones=', deliveryZones.length);

  // Se sto trasportando, consegna verso delivery piu' vicino
  if (me.carried > 0 && deliveryZones.length > 0) {
    const target = deliveryZones
      .map(d => ({ d, dist: g.manhattanDistance(me.x, me.y, d.x, d.y) }))
      .sort((a,b)=>a.dist-b.dist)[0].d;
    console.log('-> go_deliver to', target.x, target.y);
    push(['go_deliver', target.x, target.y, 'deliver', 0]);
    return;
  }

  // Se c'è almeno un pacco, scegli il più vicino per Manhattan
  if (parcels.length > 0) {
    const p = parcels
      .map(p => ({ p, dist: g.manhattanDistance(me.x, me.y, p.x, p.y) }))
      .sort((a,b)=>a.dist-b.dist)[0].p;
    console.log('-> go_pick_up', p.id, 'at', p.x, p.y);
    push(['go_pick_up', Math.round(p.x), Math.round(p.y), p.id, p.reward || 0]);
    return;
  }

  // fallback random
  console.log('-> go_random');
  push(['go_random', me.x ?? 0, me.y ?? 0, 'rnd', 0]);
}

export { optionsGeneration };
