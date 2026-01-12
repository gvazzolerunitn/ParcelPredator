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

### Part 2 — Multi-agent extension (planned steps)
- 1. Shared/observable state and coordination primitives
	- refine belief sharing (what is safe to broadcast) or implement decentralized heuristics
- 2. Contention resolution strategies
	- contention-aware scoring, auctions, or soft-reservations for spawners/parcels
- 3. Communication & negotiation (optional)
	- basic message types to announce intent, reserve parcels, or request handoffs
- 4. Multi-agent experiments
	- benchmarks comparing centralized vs decentralized strategies and tuning contention penalties

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
