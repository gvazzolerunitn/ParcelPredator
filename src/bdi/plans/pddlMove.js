/**
 * PDDLMove Plan
 * 
 * Movement plan that uses PDDL planning to find optimal path.
 * Generates a PDDL problem from current state, calls the solver,
 * and executes the returned plan step by step.
 * 
 * Includes micro-retry logic for individual moves.
 * Falls back gracefully if planning fails or path is obstructed.
 */

import { adapter } from "../../client/adapter.js";
import { grid } from "../../utils/grid.js";
import { PddlPlanner } from "../../PDDL/pddlPlanner.js";
import { fastLocalSolver, onlineSolverFallback, getLastCacheHit } from "../../PDDL/fastLocalSolver.js";
import config from "../../config/default.js";
import { agentLogger } from '../../utils/logger.js';
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";

// Get directory of current module for domain.pddl path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DOMAIN_PATH = path.join(__dirname, "../../PDDL/domain.pddl");

// Retry settings from config
const MICRO_RETRIES = config.moveMicroRetries ?? 1;
const MICRO_RETRY_DELAY = config.microRetryDelayMs ?? 100;

/**
 * Helper: sleep for ms milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class PDDLMove {
  static isApplicableTo(desire) {
    // Only apply if PDDL is enabled in config
    return desire === 'go_to' && config.usePddl === true;
  }

  constructor(parent) {
    this.parent = parent;
    this.stopped = false;
  }

  stop() {
    this.stopped = true;
  }

  /**
   * Execute a single move with micro-retry logic
   * @param {string} action - direction to move ('up', 'down', 'left', 'right')
   * @returns {Promise<boolean>} true if move succeeded, false if all retries failed
   */
  async moveWithRetry(action) {
    for (let attempt = 0; attempt <= MICRO_RETRIES; attempt++) {
      const result = await adapter.move(action);
      if (result) {
        return true;
      }
      
      if (attempt < MICRO_RETRIES) {
        agentLogger.hot('moveRetry', 2000, `PDDLMove: Move '${action}' failed, micro-retry ${attempt + 1}/${MICRO_RETRIES}`);
        await sleep(MICRO_RETRY_DELAY);
      }
    }
    return false;
  }

  /**
   * Execute PDDL-based movement to target (x, y)
   * @param {string} _desire - 'go_to'
   * @param {number} x - target x
   * @param {number} y - target y
   * @param {object} belief - optional belief for agent positions
   */
  async execute(_desire, x, y, belief = null) {
    const tx = Math.round(x);
    const ty = Math.round(y);
    const sx = Math.round(this.parent.x);
    const sy = Math.round(this.parent.y);

    // Already at destination
    if (sx === tx && sy === ty) {
      return true;
    }

    if (this.stopped) throw new Error("stopped");

    // Collect other agents' positions to avoid
    let otherAgents = [];
    if (belief && belief.getOtherAgents) {
      otherAgents = belief.getOtherAgents(this.parent.id).map(a => ({
        x: Math.round(a.x),
        y: Math.round(a.y)
      }));
    }

    // Generate PDDL problem
    const planner = new PddlPlanner(
      grid,
      { x: sx, y: sy },
      { x: tx, y: ty },
      otherAgents
    );
    const problem = planner.getProblem();

    // Read domain file
    let domain;
    try {
      domain = fs.readFileSync(DOMAIN_PATH, "utf8");
    } catch (err) {
      agentLogger.error('PDDLMove: Cannot read domain.pddl:', err.message);
      throw new Error("domain not found");
    }

    // Call solver (measure latency with high resolution and log to CSV)
    const start = process.hrtime.bigint();
    let plan;
    const solverType = (config.solver === "online") ? 'online' : 'local';

    if (solverType === "online") {
      if (config.DEBUG) agentLogger.debug('PDDLMove: Using online solver...');
      plan = await onlineSolverFallback(domain, problem);
    } else {
      if (config.DEBUG) agentLogger.debug('PDDLMove: Using local solver...');
      plan = await fastLocalSolver(domain, problem);
    }

    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1e6;
    const durationStr = durationMs.toFixed(3);
    if (config.DEBUG) agentLogger.debug(`PDDLMove: Solver completed in ${durationStr}ms, plan length: ${plan?.length || 0}`);

    // Append latency to CSV (create file with header if needed)
    try {
      const csvPath = path.join(__dirname, '../../PDDL/solver_latency.csv');
      const now = new Date().toISOString();
      const startTile = `tile_${sx}_${sy}`;
      const goalTile = `tile_${tx}_${ty}`;
      const planLen = plan ? (Array.isArray(plan) ? plan.length : 0) : 0;
      // Determine cache hit (only meaningful for local solver)
      const cacheHit = (solverType === 'local') ? (getLastCacheHit() ? 1 : 0) : 0;
      const line = `${now},${solverType},${durationStr},${startTile},${goalTile},${planLen},${cacheHit}\n`;
      let needHeader = true;
      if (fs.existsSync(csvPath)) {
        try { needHeader = fs.statSync(csvPath).size === 0; } catch (e) { needHeader = true; }
      }
      if (needHeader) {
        fs.writeFileSync(csvPath, 'timestamp,solver_type,duration_ms,start,goal,plan_length,cache_hit\n', 'utf8');
      }
      fs.appendFileSync(csvPath, line, 'utf8');
    } catch (e) {
      agentLogger.error('PDDLMove: Failed to log solver latency:', e.message);
    }

    // Empty plan but not at goal = no solution
    if (!plan || plan.length === 0) {
      if (sx === tx && sy === ty) {
        return true; // Already there
      }
      agentLogger.warn('PDDLMove: No plan found');
      throw new Error("no plan found");
    }

    // Execute plan steps with micro-retry
    if (config.DEBUG) agentLogger.debug(`PDDLMove: Executing plan: ${plan.map(s => s.action).join(", ")}`);

    for (const step of plan) {
        if (this.stopped) {
        agentLogger.hot('planStopped', 5000, 'PDDLMove: Plan stopped during execution');
        throw new Error("stopped");
      }

      // Extract action (handle both {action: 'up'} and 'MOVE-UP' formats)
      let action = step.action || step;
      if (typeof action === "string") {
        // Convert PDDL action names to simple directions (handle uppercase and lowercase)
        action = action.toLowerCase().replace('move-', '').replace('move_', '');
      }

      const moveOk = await this.moveWithRetry(action);

        if (!moveOk) {
        agentLogger.hot('moveObstructed', 5000, `PDDLMove: Move '${action}' failed after ${MICRO_RETRIES + 1} attempts, path obstructed`);
        return "obstructed";
      }

      // Opportunistic pickup: if after this move there are free parcels on our tile,
      // attempt to pick them up immediately to avoid passing them and coming back.
      try {
        if (belief && typeof belief.getFreeParcels === 'function') {
          const cx = Math.round(this.parent.x);
          const cy = Math.round(this.parent.y);
          const freeHere = belief.getFreeParcels().filter(p => Math.round(p.x) === cx && Math.round(p.y) === cy);
          if (freeHere.length > 0) {
            // Attempt pickup via adapter; adapter.pickup() returns collected parcels or []
            const picked = await adapter.pickup();
              if (picked && picked.length > 0) {
              // Update belief and parent state consistently
              for (const p of picked) {
                try { belief.removeParcel(p.id); } catch (e) { /* ignore */ }
                this.parent.carried_parcels = this.parent.carried_parcels || [];
                if (!this.parent.carried_parcels.some(cp => cp.id === p.id)) {
                  this.parent.carried_parcels.push({ id: p.id, reward: p.reward || 0 });
                }
              }
              this.parent.carried = (this.parent.carried_parcels || []).length;
              this.parent.carriedReward = (this.parent.carried_parcels || []).reduce((s, p) => s + (p.reward || 0), 0);
              agentLogger.hot('pickup', 2000, `PDDLMove: Opportunistic pickup at (${cx},${cy}) -> picked ${picked.map(p=>p.id).join(',')}`);
            }
          }
        }
      } catch (e) {
        // Non-fatal: pickup failed or adapter not available, continue execution
      }

      // Opportunistic putdown: if carrying parcels and standing on a delivery tile,
      // deliver immediately to avoid passing delivery zones without depositing.
      try {
        if (belief && belief.deliveryZones && this.parent.carried > 0) {
          const cx = Math.round(this.parent.x);
          const cy = Math.round(this.parent.y);
          const onDelivery = belief.deliveryZones.some(d => d.x === cx && d.y === cy);
          if (onDelivery) {
            const deliveredIds = (this.parent.carried_parcels || []).map(p => p.id);
            const putResult = await adapter.putdown();
              if (putResult) {
              // Clear carried state
              for (const pid of deliveredIds) {
                try { belief.removeParcel(pid); } catch (e) { /* ignore */ }
              }
              agentLogger.hot('putdown', 2000, `PDDLMove: Opportunistic putdown at (${cx},${cy}) -> delivered ${deliveredIds.join(',')}`);
              this.parent.carried = 0;
              this.parent.carriedReward = 0;
              this.parent.carried_parcels = [];
            }
          }
        }
      } catch (e) {
        // Non-fatal: putdown failed, continue execution
      }
    }

    // Verify we reached destination
    const finalX = Math.round(this.parent.x);
    const finalY = Math.round(this.parent.y);
    if (finalX === tx && finalY === ty) {
      if (config.DEBUG) console.log(`PDDLMove: Successfully reached (${tx}, ${ty})`);
      return true;
    }

    console.log(`PDDLMove: Ended at (${finalX}, ${finalY}), expected (${tx}, ${ty})`);
    return "obstructed";
  }
}

export { PDDLMove };
