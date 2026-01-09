// optionsGeneration: produce intenzioni candidate con scoring multi-pick
// Versione 2: supporta batch pickup (raccoglie più pacchi prima di consegnare)
import { grid as globalGrid } from "../utils/grid.js";

// ============================================================================
// HELPERS per Multi-Pick
// ============================================================================

/**
 * Ritorna i K pacchi liberi più vicini, ordinati per distanza da (x,y)
 */
function getNearbyFreeParcels(belief, x, y, g, K = 10) {
  const parcels = belief.getFreeParcels();
  const withDist = parcels.map(p => ({
    ...p,
    dist: g.manhattanDistance(x, y, Math.round(p.x), Math.round(p.y))
  }));
  withDist.sort((a, b) => a.dist - b.dist);
  return withDist.slice(0, K);
}

/**
 * Trova la delivery zone più vicina a (x,y)
 */
function findNearestDelivery(x, y, deliveryZones, g) {
  let best = null;
  let bestDist = Infinity;
  for (const d of deliveryZones) {
    const dist = g.manhattanDistance(x, y, d.x, d.y);
    if (dist < bestDist) { bestDist = dist; best = d; }
  }
  return { zone: best, dist: bestDist };
}

/**
 * Calcola il costo e reward di una rotta multi-pick:
 * - start: posizione iniziale
 * - sequence: array di parcels da raccogliere in ordine
 * - deliveryZones: zone di consegna disponibili
 * - me: agente (per me.carried, me.carriedReward, me.lossForMovement)
 * - g: griglia per calcolo distanze
 * 
 * Ritorna { totalReward, totalCost, netScore, deliveryZone, segments }
 */
function evaluateRoute(start, sequence, deliveryZones, me, g) {
  if (sequence.length === 0) return { totalReward: 0, totalCost: 0, netScore: -Infinity, deliveryZone: null, segments: [] };

  const loss = me.lossForMovement || 0;
  let pos = { x: start.x, y: start.y };
  let carried = me.carried;          // pacchi già trasportati
  let totalReward = me.carriedReward; // reward già accumulato
  let totalCost = 0;
  const segments = [];

  // Segmenti di pickup
  for (const parcel of sequence) {
    const px = Math.round(parcel.x);
    const py = Math.round(parcel.y);
    const segmentDist = g.manhattanDistance(pos.x, pos.y, px, py);
    // Costo del movimento: distanza × loss × pacchi trasportati DURANTE il movimento
    const segmentCost = segmentDist * loss * carried;
    totalCost += segmentCost;
    segments.push({ from: { ...pos }, to: { x: px, y: py }, dist: segmentDist, carried, cost: segmentCost });
    // Dopo il pickup: incrementa carried e reward
    carried++;
    totalReward += (parcel.reward || 0);
    pos = { x: px, y: py };
  }

  // Segmento finale: dal ultimo pacco alla delivery zone più vicina
  const { zone: deliveryZone, dist: deliveryDist } = findNearestDelivery(pos.x, pos.y, deliveryZones, g);
  if (!deliveryZone) return { totalReward: 0, totalCost: Infinity, netScore: -Infinity, deliveryZone: null, segments };

  const deliveryCost = deliveryDist * loss * carried;
  totalCost += deliveryCost;
  segments.push({ from: { ...pos }, to: { x: deliveryZone.x, y: deliveryZone.y }, dist: deliveryDist, carried, cost: deliveryCost });

  const netScore = totalReward - totalCost;
  return { totalReward, totalCost, netScore, deliveryZone, segments };
}

/**
 * Costruisce una rotta greedy nearest-neighbor:
 * Partendo dalla posizione corrente, aggiunge iterativamente il pacco
 * che massimizza il delta score, fino a raggiungere capacity o esaurire pacchi.
 */
function buildGreedyRoute(start, candidates, deliveryZones, me, g, maxPicks) {
  const remaining = [...candidates];
  const sequence = [];
  let pos = { x: start.x, y: start.y };
  let currentCarried = me.carried;

  while (sequence.length < maxPicks && remaining.length > 0) {
    // Trova il pacco che, aggiunto alla sequenza, dà il miglior netScore
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const testSeq = [...sequence, remaining[i]];
      const eval_ = evaluateRoute(start, testSeq, deliveryZones, me, g);
      if (eval_.netScore > bestScore) {
        bestScore = eval_.netScore;
        bestIdx = i;
      }
    }

    if (bestIdx === -1 || bestScore <= 0) break; // nessun miglioramento positivo

    sequence.push(remaining[bestIdx]);
    const picked = remaining.splice(bestIdx, 1)[0];
    pos = { x: Math.round(picked.x), y: Math.round(picked.y) };
  }

  return sequence;
}

// ============================================================================
// MAIN: optionsGeneration
// ============================================================================

function optionsGeneration({ me, belief, grid, push }) {
  const g = grid || globalGrid;
  if (!g || me.x === undefined || me.y === undefined) return;

  const deliveryZones = belief.deliveryZones;
  const loss = me.lossForMovement || 0;
  const capacity = me.capacity || 4;
  const freeSlots = capacity - me.carried;

  // Se c'è già un'intenzione utile in corso, non interrompere (tranne go_random)
  if (me.intentions.length > 0) {
    const current = me.intentions[0]?.predicate?.[0];
    if (current !== 'go_random') return;
    const parcels = belief.getFreeParcels();
    if (me.carried === 0 && parcels.length === 0) return;
    me.intentions[0]?.stop?.();
    me.intentions.shift();
  }

  // Trova delivery zone più vicina dalla posizione attuale
  const { zone: nearestDelivery, dist: distToDelivery } = findNearestDelivery(me.x, me.y, deliveryZones, g);

  // Prendi i K pacchi più vicini
  const K = 10;
  const nearbyCandidates = getNearbyFreeParcels(belief, me.x, me.y, g, K);

  console.log('options: carried=', me.carried, '/', capacity, 'carriedReward=', me.carriedReward, 'parcels=', nearbyCandidates.length);

  // -------------------------------------------------------------------------
  // OPZIONE 1: DELIVER ORA (se ho pacchi)
  // -------------------------------------------------------------------------
  let deliverNowScore = -Infinity;
  if (me.carried > 0 && nearestDelivery) {
    const deliverCost = distToDelivery * loss * me.carried;
    deliverNowScore = me.carriedReward - deliverCost;
  }

  // -------------------------------------------------------------------------
  // OPZIONE 2: MULTI-PICK (greedy route) + DELIVER
  // -------------------------------------------------------------------------
  let bestRoute = [];
  let bestRouteScore = -Infinity;
  let bestRouteDelivery = null;

  if (freeSlots > 0 && nearbyCandidates.length > 0) {
    // Costruisci rotta greedy
    const greedySeq = buildGreedyRoute(
      { x: me.x, y: me.y },
      nearbyCandidates,
      deliveryZones,
      me,
      g,
      freeSlots
    );

    if (greedySeq.length > 0) {
      const eval_ = evaluateRoute({ x: me.x, y: me.y }, greedySeq, deliveryZones, me, g);
      bestRoute = greedySeq;
      bestRouteScore = eval_.netScore;
      bestRouteDelivery = eval_.deliveryZone;
    }
  }

  // -------------------------------------------------------------------------
  // DECISIONE: scegli l'opzione migliore
  // -------------------------------------------------------------------------

  // Caso A: ho una rotta multi-pick con score migliore di consegnare subito
  if (bestRoute.length > 0 && bestRouteScore > deliverNowScore && bestRouteScore > 0) {
    const firstParcel = bestRoute[0];
    console.log(`-> MULTI-PICK route: ${bestRoute.length} parcels, score=${bestRouteScore.toFixed(2)}`);
    console.log(`   parcels: ${bestRoute.map(p => p.id).join(' -> ')} -> deliver@(${bestRouteDelivery?.x},${bestRouteDelivery?.y})`);
    // Push solo il primo pickup; dopo il pickup optionsGeneration verrà richiamata
    // e deciderà se continuare la rotta o cambiare piano
    push(['go_pick_up', Math.round(firstParcel.x), Math.round(firstParcel.y), firstParcel.id, bestRouteScore]);
    return;
  }

  // Caso B: consegna ora è meglio (o l'unica opzione positiva)
  if (me.carried > 0 && nearestDelivery && deliverNowScore > 0) {
    console.log('-> go_deliver to', nearestDelivery.x, nearestDelivery.y, 'score=', deliverNowScore.toFixed(2));
    push(['go_deliver', nearestDelivery.x, nearestDelivery.y, 'deliver', deliverNowScore]);
    return;
  }

  // Caso C: ho pacchi ma nessuna opzione positiva -> consegna comunque per non perderli
  if (me.carried > 0 && nearestDelivery) {
    console.log('-> go_deliver (fallback, avoid losing parcels)');
    push(['go_deliver', nearestDelivery.x, nearestDelivery.y, 'deliver', 0]);
    return;
  }

  // Caso D: nessun pacco trasportato e nessuna rotta valida -> esplora spawner
  if (belief.parcelSpawners && belief.parcelSpawners.length > 0) {
    const spawner = belief.parcelSpawners[Math.floor(Math.random() * belief.parcelSpawners.length)];
    console.log('-> go_to spawner', spawner.x, spawner.y);
    push(['go_pick_up', spawner.x, spawner.y, 'explore', 0]);
    return;
  }

  // Caso E: fallback totale
  console.log('-> go_random');
  push(['go_random', me.x ?? 0, me.y ?? 0, 'rnd', 0]);
}

export { optionsGeneration };
