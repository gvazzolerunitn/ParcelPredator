// optionsGeneration: produce intenzioni candidate con scoring multi-pick
import { grid as globalGrid } from "../utils/grid.js";

function optionsGeneration({ me, belief, grid, push }) {
  const g = grid || globalGrid;
  if (!g || me.x === undefined || me.y === undefined) return;

  const parcels = belief.getFreeParcels();
  const deliveryZones = belief.deliveryZones;
  const loss = me.lossForMovement || 0;

  // Se c'è già un'intenzione utile in corso, non interrompere (tranne go_random)
  if (me.intentions.length > 0) {
    const current = me.intentions[0]?.predicate?.[0];
    if (current !== 'go_random') return;
    if (me.carried === 0 && parcels.length === 0) return;
    me.intentions[0]?.stop?.();
    me.intentions.shift();
  }

  console.log('options: carried=', me.carried, '/', me.capacity, 'carriedReward=', me.carriedReward, 'parcels=', parcels.length);

  // Trova delivery zone più vicina (per calcoli)
  let nearestDelivery = null;
  let distToDelivery = Infinity;
  if (deliveryZones.length > 0) {
    for (const d of deliveryZones) {
      const dist = g.manhattanDistance(me.x, me.y, d.x, d.y);
      if (dist < distToDelivery) { distToDelivery = dist; nearestDelivery = d; }
    }
  }

  // Costruisci opzioni con score
  const options = [];

  // Opzione DELIVER: se trasporto pacchi
  if (me.carried > 0 && nearestDelivery) {
    const moveCost = distToDelivery * loss * me.carried;
    const deliverScore = me.carriedReward - moveCost;
    if (deliverScore > 0) {
      options.push({ type: 'go_deliver', x: nearestDelivery.x, y: nearestDelivery.y, score: deliverScore });
    }
  }

  // Opzioni PICKUP: se ho ancora capacità
  if (me.carried < me.capacity && parcels.length > 0) {
    for (const p of parcels) {
      const distToParcel = g.manhattanDistance(me.x, me.y, Math.round(p.x), Math.round(p.y));
      // Distanza dal pacco alla delivery più vicina
      let distParcelToDelivery = Infinity;
      for (const d of deliveryZones) {
        const dd = g.manhattanDistance(Math.round(p.x), Math.round(p.y), d.x, d.y);
        if (dd < distParcelToDelivery) distParcelToDelivery = dd;
      }
      // Score = reward netto dopo aver preso il pacco e consegnato tutto
      const futureLoss = (distToParcel + distParcelToDelivery) * loss * (me.carried + 1);
      const pickupScore = (me.carriedReward + (p.reward || 0)) - futureLoss;
      if (pickupScore > 0) {
        options.push({ type: 'go_pick_up', x: Math.round(p.x), y: Math.round(p.y), id: p.id, reward: p.reward || 0, score: pickupScore });
      }
    }
  }

  // Ordina per score decrescente
  options.sort((a, b) => b.score - a.score);

  if (options.length > 0) {
    const best = options[0];
    if (best.type === 'go_deliver') {
      console.log('-> go_deliver to', best.x, best.y, 'score=', best.score.toFixed(2));
      push(['go_deliver', best.x, best.y, 'deliver', best.score]);
    } else {
      console.log('-> go_pick_up', best.id, 'at', best.x, best.y, 'score=', best.score.toFixed(2));
      push(['go_pick_up', best.x, best.y, best.id, best.score]);
    }
    return;
  }

  // Se ho pacchi ma nessuna opzione valida (score negativo), consegna comunque per non perderli
  if (me.carried > 0 && nearestDelivery) {
    console.log('-> go_deliver (fallback, no positive options)');
    push(['go_deliver', nearestDelivery.x, nearestDelivery.y, 'deliver', 0]);
    return;
  }

  // Fallback: vai verso spawner o random
  if (belief.parcelSpawners && belief.parcelSpawners.length > 0) {
    const spawner = belief.parcelSpawners[Math.floor(Math.random() * belief.parcelSpawners.length)];
    console.log('-> go_to spawner', spawner.x, spawner.y);
    push(['go_pick_up', spawner.x, spawner.y, 'explore', 0]);
    return;
  }

  console.log('-> go_random');
  push(['go_random', me.x ?? 0, me.y ?? 0, 'rnd', 0]);
}

export { optionsGeneration };
