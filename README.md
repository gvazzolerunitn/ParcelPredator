# ParcelPredator

## Purpose
- Implement BDI agents for the Deliveroo.js simulator to pick up and deliver parcels reliably under dynamic conditions (moving agents, spawners, time-decaying rewards).

## Goals
- Provide a working single-agent prototype (Part 1) and a roadmap to extend it to coordinated multi-agent behavior (Part 2).

## Scope and tasks

### Part 1 — Single-agent prototype (implemented)
- **Belief management**: timestamp-based world model with time-decayed reward estimation; cooldown API (`parcel`/`tile`/`delivery`) for temporary target exclusion; auto-expiry of stale parcels (>2s) and agents (>500ms).
- **PDDL planning**: local fast A* solver (~1-9ms on 60×60 maps) with online fallback; domain.pddl with move actions; `PDDLMove` executor with micro-retry (1 attempt per step) and macro-retry (3 attempts with exponential backoff).
- **Greedy multi-pick routing**: scores routes by (expected reward − movement cost − contention penalty); contention based on other agents' proximity and velocity towards parcels; handles carried state for multi-pick sequences.
- **Opportunistic actions**: during PDDLMove execution, agent performs pickup at any tile with free parcels and putdown at any delivery tile, maximizing throughput without replanning.
- **Anti-loop mechanisms**: stochastic escape (15% probability to jump to distant spawner) breaks local cycles; area backoff (Manhattan radius 2, 3s cooldown) prevents adjacent-tile bouncing; tile cooldown (3s) on empty explores.
- **Robustness**: GoPickUp treats missing parcels as success (already picked); GoDeliver treats `carried==0` as success (opportunistic putdown occurred); macro-retry with exponential backoff on failures; per-target cooldowns prevent infinite loops.
- **Validation**: tested on maps ranging 20×20 (214 spawners) to 60×60 (2609 spawners); confirmed anti-loop mechanisms work, opportunistic actions increase throughput, logs clean and interpretable.

### Part 2 — Multi-agent extension (implemented)
- **Communication scaffold:** handshake-based friend discovery, `INFO_PARCELS` / `INFO_PARCELS_DELTA`, `INFO_AGENTS` / `INFO_AGENTS_DELTA`, `INTENTION` and `COLLISION` message types. Implements diff-only sync with periodic full snapshots.
- **Handshake & readiness:** automatic friendId discovery and handshake protocol; `Comm.isReady()` gating before sending coordination messages.
- **Claim-based coordination:** reservation/claim API (`registerClaim`, `getClaims`, `clearMyClaim`) with 3s TTL; `shouldYieldClaim()` implements priority rules (higher score wins, tie-breaker by lexicographic `agentId`).
- **Intent sharing & negotiation:** agents send intentions (`sendIntention`) before committing to pickup; incoming intentions are registered as claims to avoid contention.
- **Claim-before-pickup:** `optionsGeneration()` checks `shouldYieldClaim()` before claiming a parcel; if proceeding, the agent registers the claim locally and broadcasts it to the friend, then pushes the `go_pick_up` intention.
- **Collision protocol:** simple exchange messages (`COLLISION`, `MOVE`, `TAKE`, `DROP`, `END`) and handlers to coordinate ad-hoc parcel handoffs or temporary moves to resolve deadlocks.
- **Defensive consistency measures:** multiple layers to avoid position overwrites — sender excludes self from agents broadcasts, receiver sanitizes incoming agent lists/deltas, and `belief.syncAgents(..., myId)` skips updating our own entry.
- **Grid-consistent positions:** agent positions are rounded for grid logic (prevents transient fractional-position artefacts) and options generation avoids creating new intentions while the agent is mid-move.
- **Throttled logging & comm summaries:** periodic condensed communication summaries to avoid console flooding.

## Repository layout (key files)
- `src/launcher.js` — agent bootstrap and adapter wiring
- `src/bdi/belief.js` — belief store and aging/expiry logic
- `src/bdi/options.js` — option generation, greedy route, scoring
- `src/bdi/plans/moveBfs.js` — BFS movement and recovery/backoff
- `src/bdi/plans/goPickUp.js` — pickup plan and belief updates
- `src/bdi/plans/goDeliver.js` — delivery plan and belief updates
- `src/utils/grid.js` — `bfsPath` with optional blocked-cells parameter

## Current status
- Implemented (prototype): belief aging, multi-pick scoring, agent-aware BFS, exponential backoff, target cooldown, spawner backoff, `carried_parcels` handling, immediate belief updates after actions.
- Pending (recommended next steps): alternate-route fallback in `moveBfs`, unit tests and benchmark harness, hyperparameter tuning.

## Quick Start

- Install dependencies:

```bash
npm install
```

- (Optional) To use the online PDDL solver instead of the local A* solver, install the client and set the solver in `src/config/default.js`:

```bash
npm install @unitn-asa/pddl-client
```

Then edit `src/config/default.js` and set:

```js
	// PDDL Planning options
	usePddl: true,        // enable PDDL-based movement
	solver: "online"     // "local" = built-in A* | "online" = @unitn-asa/pddl-client
```

- Start the agent:

```bash
npm start
```

- Quick notes:
	- `solver: "local"` uses the lightweight internal A* (`src/PDDL/fastLocalSolver.js`).
	- `solver: "online"` calls `@unitn-asa/pddl-client` at runtime; ensure the package is installed and the host has network access if required.
	- Logs show `PDDLMove: Using online solver...` or `PDDLMove: Using local solver...` depending on selection.
