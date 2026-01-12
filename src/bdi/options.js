// optionsGeneration: produce intenzioni candidate con scoring multi-pick
// Versione 3: supporta batch pickup + agent avoidance/contention handling
import { grid as globalGrid } from "../utils/grid.js";
import { defaultLogger } from '../utils/logger.js';

// ============================================================================
// STATO per backoff esplorazione spawner
// ============================================================================
const recentlyVisitedSpawners = new Map(); // key: "x,y" -> timestamp ultimo tentativo
const SPAWNER_BACKOFF_MS = 3000; // Non tornare sullo stesso spawner per 3 secondi
const AREA_BACKOFF_RADIUS = 2; // Penalizza anche tile vicine (Manhattan radius)

// ============================================================================
// HELPERS per Multi-Pick e Agent Avoidance
// ============================================================================

/**
 * Calcola la penalità di contention per un pacco.
 * Ritorna { contested: bool, penalty: number (0-1, dove 1 = nessuna penalità) }
 */
function getContentionPenalty(parcel, myX, myY, otherAgents, g) {
  const px = Math.round(parcel.x);
  const py = Math.round(parcel.y);
  const myDist = g.manhattanDistance(myX, myY, px, py);
  
  let minOtherDist = Infinity;
  for (const agent of otherAgents) {
    const agentDist = g.manhattanDistance(agent.x, agent.y, px, py);
    if (agentDist < minOtherDist) {
      minOtherDist = agentDist;
    }
  }
  
  // Nessun altro agente -> nessuna contention
  if (minOtherDist === Infinity) {
    return { contested: false, penalty: 1.0 };
  }
  
  // Altro agente è più vicino -> fortemente contested
  if (minOtherDist < myDist) {
    return { contested: true, penalty: 0.1 };
  }
  
  // Stessa distanza -> moderatamente contested
  if (minOtherDist === myDist) {
    return { contested: true, penalty: 0.5 };
  }
  
  // Sono più vicino io -> leggera penalità se l'altro è molto vicino
  if (minOtherDist <= myDist + 2) {
    return { contested: false, penalty: 0.8 };
  }
  
  return { contested: false, penalty: 1.0 };
}

/**
 * Ritorna i K pacchi liberi più vicini, ordinati per distanza da (x,y)
 * Include info sulla contention con altri agenti
 * Filtra i pacchi in cooldown (target falliti di recente)
 */
function getNearbyFreeParcels(belief, x, y, g, myId, K = 10) {
  const parcels = belief.getFreeParcels();
  const otherAgents = belief.getOtherAgents(myId);
  
  const withDist = parcels
    // Filtra pacchi in cooldown (usando belief cooldowns)
    .filter(p => !(belief?.isOnCooldown && belief.isOnCooldown('parcel', p.id)))
    .map(p => {
      const dist = g.manhattanDistance(x, y, Math.round(p.x), Math.round(p.y));
      const contention = getContentionPenalty(p, x, y, otherAgents, g);
      return {
        ...p,
        dist,
        contested: contention.contested,
        contentionPenalty: contention.penalty
      };
    });
  
  // Ordina per distanza, ma i pacchi fortemente contested vanno in fondo
  withDist.sort((a, b) => {
    // Prima i non-contested, poi per distanza
    if (a.contested !== b.contested) return a.contested ? 1 : -1;
    return a.dist - b.dist;
  });
  
  return withDist.slice(0, K);
}

/**
 * Verifica se uno spawner è in backoff (diretto o per prossimità area)
 */
function isInAreaBackoff(spawnerX, spawnerY, now) {
  for (const [key, timestamp] of recentlyVisitedSpawners) {
    if ((now - timestamp) >= SPAWNER_BACKOFF_MS) continue; // backoff scaduto
    const [vx, vy] = key.split(',').map(Number);
    const dist = Math.abs(spawnerX - vx) + Math.abs(spawnerY - vy);
    if (dist <= AREA_BACKOFF_RADIUS) return true;
  }
  return false;
}

/**
 * Sceglie lo spawner migliore evitando zone con altri agenti e spawner visitati di recente.
 * Supporta stochastic escape: con probabilità `escapeProbability`, sceglie uno spawner distante.
 * Rispetta anche i cooldown per-tile impostati dalla belief.
 */
function chooseBestSpawner(spawners, myX, myY, otherAgents, g, belief = null, escapeProbability = 0.15) {
  if (spawners.length === 0) return null;
  
  const now = Date.now();
  
  // Stochastic escape: con probabilità p, scegli uno spawner lontano per uscire da cicli locali
  if (Math.random() < escapeProbability) {
    // Ordina spawner per distanza decrescente e scegline uno tra i più lontani
    const sorted = [...spawners]
      .map(s => ({ ...s, dist: g.manhattanDistance(myX, myY, s.x, s.y) }))
      .sort((a, b) => b.dist - a.dist);
    // Scegli casualmente tra il top 20% più lontani
    const topN = Math.max(1, Math.floor(sorted.length * 0.2));
    const chosen = sorted[Math.floor(Math.random() * topN)];
    console.log(`-> [ESCAPE] jumping to distant spawner (${chosen.x},${chosen.y}) dist=${chosen.dist}`);
    recentlyVisitedSpawners.set(`${chosen.x},${chosen.y}`, now);
    return { spawner: chosen, nearbyAgents: otherAgents.length, escaped: true };
  }
  
  let bestSpawner = null;
  let bestScore = -Infinity;
  
  for (const spawner of spawners) {
    // Salta spawner in area backoff (inclusi vicini)
    if (isInAreaBackoff(spawner.x, spawner.y, now)) {
      continue;
    }
    
    // Salta spawner con cooldown per-tile (esplorazione fallita di recente)
    if (belief && belief.isOnCooldown && belief.isOnCooldown('tile', `${spawner.x},${spawner.y}`)) {
      continue;
    }
    
    const myDist = g.manhattanDistance(myX, myY, spawner.x, spawner.y);
    
    // Trova la distanza minima di altri agenti da questo spawner
    let minOtherDist = Infinity;
    for (const agent of otherAgents) {
      const agentDist = g.manhattanDistance(agent.x, agent.y, spawner.x, spawner.y);
      if (agentDist < minOtherDist) {
        minOtherDist = agentDist;
      }
    }
    
    // Score: preferisci spawner vicini a me ma lontani da altri agenti
    // score = (distanza altri) - (distanza mia) * 0.5
    const score = (minOtherDist === Infinity ? 20 : minOtherDist) - myDist * 0.5;
    
    if (score > bestScore) {
      bestScore = score;
      bestSpawner = spawner;
    }
  }
  
  // Se tutti gli spawner sono in backoff, scegli quello con backoff più vecchio
  if (!bestSpawner && spawners.length > 0) {
    let oldestTime = Infinity;
    for (const spawner of spawners) {
      const key = `${spawner.x},${spawner.y}`;
      const lastVisit = recentlyVisitedSpawners.get(key) || 0;
      if (lastVisit < oldestTime) {
        oldestTime = lastVisit;
        bestSpawner = spawner;
      }
    }
  }
  
  // Registra questo spawner come visitato
  if (bestSpawner) {
    const key = `${bestSpawner.x},${bestSpawner.y}`;
    recentlyVisitedSpawners.set(key, now);
  }
  
  return { spawner: bestSpawner, nearbyAgents: otherAgents.length, escaped: false };
}

/**
 * Trova la delivery zone più vicina a (x,y)
 * Preferisce zone non in cooldown, ma se tutte lo sono, sceglie la più vicina comunque
 */
function findNearestDelivery(x, y, deliveryZones, g, belief) {
  let bestNotCooled = null;
  let bestNotCooledDist = Infinity;
  let bestAny = null;
  let bestAnyDist = Infinity;
  
  for (const d of deliveryZones) {
    const dist = g.manhattanDistance(x, y, d.x, d.y);
    // Track best overall
    if (dist < bestAnyDist) { bestAnyDist = dist; bestAny = d; }
    // Track best not in cooldown
    const cooled = belief?.isOnCooldown && belief.isOnCooldown('delivery', `${d.x},${d.y}`);
    if (!cooled && dist < bestNotCooledDist) { 
      bestNotCooledDist = dist; 
      bestNotCooled = d; 
    }
  }
  
  // Preferisci non-cooled, fallback a qualsiasi
  const best = bestNotCooled || bestAny;
  const bestDist = bestNotCooled ? bestNotCooledDist : bestAnyDist;
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
 * Ritorna { totalReward, totalCost, netScore, deliveryZone, segments, avgContentionPenalty }
 */
function evaluateRoute(start, sequence, deliveryZones, me, g) {
  if (sequence.length === 0) return { totalReward: 0, totalCost: 0, netScore: -Infinity, deliveryZone: null, segments: [], avgContentionPenalty: 1 };

  const loss = me.lossForMovement || 0;
  let pos = { x: start.x, y: start.y };
  let carried = me.carried;          // pacchi già trasportati
  let totalReward = me.carriedReward; // reward già accumulato
  let totalCost = 0;
  const segments = [];
  let totalContentionPenalty = 0;

  // Segmenti di pickup
  for (const parcel of sequence) {
    const px = Math.round(parcel.x);
    const py = Math.round(parcel.y);
    const segmentDist = g.manhattanDistance(pos.x, pos.y, px, py);
    // Costo del movimento: distanza × loss × pacchi trasportati DURANTE il movimento
    const segmentCost = segmentDist * loss * carried;
    totalCost += segmentCost;
    segments.push({ from: { ...pos }, to: { x: px, y: py }, dist: segmentDist, carried, cost: segmentCost });
    // Accumula penalità contention
    totalContentionPenalty += (parcel.contentionPenalty || 1);
    // Dopo il pickup: incrementa carried e reward
    carried++;
    totalReward += (parcel.reward || 0);
    pos = { x: px, y: py };
  }
  
  const avgContentionPenalty = totalContentionPenalty / sequence.length;

  // Segmento finale: dal ultimo pacco alla delivery zone più vicina
  const { zone: deliveryZone, dist: deliveryDist } = findNearestDelivery(pos.x, pos.y, deliveryZones, g);
  if (!deliveryZone) return { totalReward: 0, totalCost: Infinity, netScore: -Infinity, deliveryZone: null, segments, avgContentionPenalty: 1 };

  const deliveryCost = deliveryDist * loss * carried;
  totalCost += deliveryCost;
  segments.push({ from: { ...pos }, to: { x: deliveryZone.x, y: deliveryZone.y }, dist: deliveryDist, carried, cost: deliveryCost });

  // Applica penalità contention al punteggio finale
  const baseScore = totalReward - totalCost;
  const netScore = baseScore * avgContentionPenalty;
  return { totalReward, totalCost, netScore, deliveryZone, segments, avgContentionPenalty };
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

function optionsGeneration({ me, belief, grid, push, comm }) {
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
  const { zone: nearestDelivery, dist: distToDelivery } = findNearestDelivery(me.x, me.y, deliveryZones, g, belief);

  // Prendi i K pacchi più vicini (con info contention)
  const K = 10;
  const nearbyCandidates = getNearbyFreeParcels(belief, me.x, me.y, g, me.id, K);
  const contestedCount = nearbyCandidates.filter(p => p.contested).length;
  const otherAgents = belief.getOtherAgents(me.id);

  defaultLogger.hot('optionsSummary', 2000, 'options:', `carried=${me.carried}/${capacity}`, `carriedReward=${me.carriedReward}`, `parcels=${nearbyCandidates.length}${contestedCount>0?` (${contestedCount} contested)`:''}`, `agents=${otherAgents.length}`);

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
    
    // Check if friend has a higher-priority claim on this parcel
    const yieldInfo = belief.shouldYieldClaim(firstParcel.id, me.id, bestRouteScore);
    if (yieldInfo) {
      defaultLogger.hot('yieldClaim', 3000, `-> Yielding parcel ${firstParcel.id} to friend (${yieldInfo.reason})`);
      // Skip this parcel and try next best option or fallback
    } else {
      // Register our claim locally and send to friend
      const claim = ['go_pick_up', Math.round(firstParcel.x), Math.round(firstParcel.y), firstParcel.id, bestRouteScore];
      belief.registerClaim(me.id, claim);
      if (comm && comm.isReady()) {
        comm.sendIntention(claim);
      }
      
      defaultLogger.hot('multiPick', 3000, `-> MULTI-PICK route: ${bestRoute.length} parcels, score=${bestRouteScore.toFixed(2)}`);
      defaultLogger.hot('multiPickDetails', 5000, `   parcels: ${bestRoute.map(p => p.id).join(' -> ')} -> deliver@(${bestRouteDelivery?.x},${bestRouteDelivery?.y})`);
      push(['go_pick_up', Math.round(firstParcel.x), Math.round(firstParcel.y), firstParcel.id, bestRouteScore]);
      return;
    }
  }

  // Caso B: consegna ora è meglio (o l'unica opzione positiva)
  if (me.carried > 0 && nearestDelivery && deliverNowScore > 0) {
    defaultLogger.hot('goDeliver', 3000, `-> go_deliver to ${nearestDelivery.x} ${nearestDelivery.y} score=${deliverNowScore.toFixed(2)}`);
    push(['go_deliver', nearestDelivery.x, nearestDelivery.y, 'deliver', deliverNowScore]);
    return;
  }

  // Caso C: ho pacchi ma nessuna opzione positiva -> consegna comunque per non perderli
  if (me.carried > 0 && nearestDelivery) {
    defaultLogger.hot('goDeliverFallback', 5000, '-> go_deliver (fallback, avoid losing parcels)');
    push(['go_deliver', nearestDelivery.x, nearestDelivery.y, 'deliver', 0]);
    return;
  }

  // Caso D: nessun pacco trasportato e nessuna rotta valida -> esplora spawner (evitando altri agenti)
  if (belief.parcelSpawners && belief.parcelSpawners.length > 0) {
    // Evita di riproporre esplorazioni mentre l'explore è in cooldown
    if (belief?.isOnCooldown && belief.isOnCooldown('parcel', 'explore')) {
      defaultLogger.hot('exploreCooldown', 5000, '-> explore target is on cooldown, skipping');
    } else {
      const result = chooseBestSpawner(belief.parcelSpawners, me.x, me.y, otherAgents, g, belief);
      if (result && result.spawner) {
        const escapeMsg = result.escaped ? ' [ESCAPE]' : '';
        const avoidMsg = result.nearbyAgents > 0 ? ` (avoiding ${result.nearbyAgents} agents)` : '';
        defaultLogger.hot('goToSpawner', 3000, `-> go_to spawner ${result.spawner.x} ${result.spawner.y}${escapeMsg}${avoidMsg}`);
        push(['go_pick_up', result.spawner.x, result.spawner.y, 'explore', 0]);
        return;
      }
    }
  }

  // Caso E: fallback totale
  defaultLogger.hot('goRandom', 5000, '-> go_random');
  push(['go_random', me.x ?? 0, me.y ?? 0, 'rnd', 0]);
}

export { optionsGeneration };
