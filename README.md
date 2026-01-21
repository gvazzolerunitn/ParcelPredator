# ParcelPredator

ParcelPredator is a BDI-style autonomous agent (single or dual) for the Deliveroo.js simulator. The goal is to reliably pick up and deliver parcels in a dynamic grid world (moving agents, spawners, time-decaying rewards), using fast local planning plus coordination to reduce contention.

## What you get

### Single-agent mode
- Belief store with aging/expiry and simple cooldowns (avoid bad targets / empty tiles).
- Fast movement planning (PDDL-based with a local A* solver by default, or BFS fallback).
- Greedy parcel selection and opportunistic pickup/putdown to maximize throughput.

### Dual-agent mode
- Lightweight communication layer (handshake + periodic delta sync).
- Claim/intent-based coordination to reduce conflicts (TTL claims + tie-break rules).
- Simple collision/deadlock resolution protocol (move / take / drop / end).

## Quick test (end-to-end)

### 1) Run the Deliveroo.js server
If you don't have it yet:
```bash
git clone https://github.com/unitn-ASA/Deliveroo.js.git
```
Then start the server:
```bash
cd Deliveroo.js
npm install
npm start
```

### 2) Get one (or two) tokens
Open the Deliveroo UI and log in. Tokens are stored by the frontend in the browser (Local Storage key `myTokens`) and can be copied from there.

### 3) Configure ParcelPredator
Edit `src/config/default.js`:
- `host`: server URL (default `http://localhost:8080`)
- `token`: agent 1 token
- `token2`: agent 2 token (only for dual mode)
- `DUAL`: `false` for single-agent, `true` for dual-agent

### 4) Run the agent(s)
Install dependencies:
```bash
cd ParcelPredator
npm install
```

Run single-agent:
```bash
npm start
```

Run dual-agent (two terminals):
```bash
npm run start:agent1
```
```bash
npm run start:agent2
```

## Planner selection (optional)
- Default is local PDDL movement (`usePddl: true`, `solver: "local"`).
- To use the online PDDL solver, install the optional dependency and set `solver: "online"` in `src/config/default.js`:
```bash
npm install @unitn-asa/pddl-client
```

## Repo map (entry points)
- `src/launcher.js` — process entry point (agent1/agent2 via CLI)
- `src/config/default.js` — host/tokens + single vs dual switch
- `src/bdi/` — beliefs, options, intentions, plans
- `src/PDDL/` — local planning utilities
