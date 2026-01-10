# ParcelPredator

## Purpose
- Implement BDI agents for the Deliveroo.js simulator to pick up and deliver parcels reliably under dynamic conditions (moving agents, spawners, time-decaying rewards).

## Goals
- Provide a working single-agent prototype (Part 1) and a roadmap to extend it to coordinated multi-agent behavior (Part 2).

## Scope and tasks

### Part 1 — Single-agent prototype (required steps)
- 1. Belief management
	- store parcels, agents, spawners and delivery zones with timestamps
	- compute time-decayed expected reward per parcel
	- remove/expire stale parcels and agents
- 2. Option generation & scoring
	- implement greedy multi-pick route builder that scores routes by (expected reward − movement cost)
	- include contention penalty for parcels likely to be taken by others
- 3. Execution primitives and plans
	- `moveBfs`: agent-aware BFS that treats occupied cells as blocked (destination exception)
	- `goPickUp` / `goDeliver`: robust pickup/putdown that capture IDs and update beliefs immediately
	- track `carried_parcels` to support multi-pick routes
- 4. Robustness and recovery
	- exponential backoff and per-target cooldown on repeated move failures
	- spawner backoff when choosing where to collect new parcels
	- on-move failure: retry, replan, and finally register cooldown instead of infinite loop
- 5. Validation and telemetry
	- add simple logging/telemetry for pickups, deliveries, failures, and cooldown events
	- unit tests for core utilities (`bfsPath`, route evaluation) and an integration benchmark harness

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
