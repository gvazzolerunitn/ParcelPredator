# ParcelPredator 🦁

**Advanced BDI Multi-Agent for Dynamic Parcel Delivery**  

[![Node.js](https://img.shields.io/badge/Node.js-1B5E20?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![JavaScript](https://img.shields.io/badge/JavaScript-1565C0?style=flat-square&logo=javascript&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![BDI Agent](https://img.shields.io/badge/BDI%20Agent-283593?style=flat-square&logoColor=white)](https://en.wikipedia.org/wiki/Belief%E2%80%93desire%E2%80%93intention_software_model)
[![Deliveroo.js](https://img.shields.io/badge/Deliveroo.js-6A1B9A?style=flat-square&logoColor=white)](https://deliveroo.js-simulator.com/)
[![DeliverooAgent.js](https://img.shields.io/badge/DeliverooAgent.js-AD1457?style=flat-square&logoColor=white)](https://deliveroo.js-simulator.com/)

> **Author:** G. Vazzoler  
> **Course:** Autonomous Software Agents  
> **Institution:** University of Trento  
> **Academic Year:** 2025-2026

ParcelPredator deploys intelligent BDI-style agents (single or dual-mode) in the Deliveroo.js grid world, built on top of the DeliverooAgent.js client template, to handle dynamic challenges like moving rivals, parcel spawners, and time-decaying rewards through rapid local planning and smart coordination to dominate deliveries.​

## What you get

### Single-agent mode
- Belief store with aging/expiry and simple cooldowns (avoid bad targets / empty tiles).
- Fast movement planning (PDDL-based with a local A* solver by default, or BFS fallback).
- Greedy parcel selection and opportunistic pickup/putdown to maximize throughput.

### Dual-agent mode
- Lightweight communication layer (handshake + periodic delta sync).
- Claim/intent-based coordination to reduce conflicts (TTL claims + tie-break rules).
- Simple collision/deadlock resolution protocol (move / take / drop / end).

**Note:** this project requires Node.js (I used version 22). Ensure `node` and `npm` are installed before following the quick test.

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
cd backend
npm start
```

### 2) Get one (or two) tokens
Open the Deliveroo UI and log in to generate tokens, or use the tokens already stored locally in the repository.

Tokens: generate or reuse
- Generate via UI: open the Deliveroo web UI, log in, then copy tokens from the browser's Local Storage (`myTokens`). In Chrome/Edge: DevTools → Application → Local Storage → select site → `myTokens` entry. Tokens are plain JWT strings you can paste into `src/config/default.js`.
- Reuse from `default.js`: for quick local testing you can keep the tokens already present in `src/config/default.js` (the repo includes `token` and `token2`).

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

## Prerequisiti

- **Node.js**: è necessario avere Node.js installato. Si raccomanda una versione LTS moderna (ad es. **Node.js >= 16**). Versioni più vecchie (>=14) possono funzionare ma non sono consigliate.
- **npm**: incluso con Node.js, necessario per installare le dipendenze (`npm install`).

Per verificare le versioni installate:
```bash
node -v
npm -v
```
