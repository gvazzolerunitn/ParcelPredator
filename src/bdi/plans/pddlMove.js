/**
 * pddlMove.js - PDDL-based Movement Plan
 * 
 * Uses PDDL planning to find optimal path to target position.
 * Generates problem, calls solver, executes plan step by step.
 */

import { adapter } from "../../client/adapter.js";
import { grid } from "../../utils/grid.js";
import { PddlPlanner } from "../../PDDL/pddlPlanner.js";
import { fastLocalSolver, onlineSolverFallback, getLastCacheHit } from "../../PDDL/fastLocalSolver.js";
import config from "../../config/default.js";
import { agentLogger } from '../../utils/logger.js';
import { runLogger } from '../../utils/runLogger.js';
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";

// Get directory of current module for domain.pddl path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DOMAIN_PATH = path.join(__dirname, "../../PDDL/domain.pddl");

class PDDLMove {
  static isApplicableTo(desire) {
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
   * Execute PDDL-based movement to target (x, y)
   */
  async execute(_desire, x, y, belief = null) {
    const tx = Math.round(x);
    const ty = Math.round(y);
    const sx = Math.round(this.parent.x);
    const sy = Math.round(this.parent.y);

    // Already at destination
    if (sx === tx && sy === ty) return true;
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

    // Call solver with timing
    let plan;
    const solverType = (config.solver === "online") ? 'online' : 'local';
    const solverStart = Date.now();

    if (solverType === "online") {
      plan = await onlineSolverFallback(domain, problem);
    } else {
      plan = await fastLocalSolver(domain, problem);
    }
    
    const solverDuration = Date.now() - solverStart;
    const wasCacheHit = getLastCacheHit();
    
    // Log solver call to runLogger
    runLogger.recordSolverCall({
      durationMs: solverDuration,
      planLength: plan ? plan.length : 0,
      cacheHit: wasCacheHit,
      start: `tile_${sx}_${sy}`,
      goal: `tile_${tx}_${ty}`
    });

    // Empty plan but not at goal = no solution
    if (!plan || plan.length === 0) {
      if (sx === tx && sy === ty) return true;
      agentLogger.warn('PDDLMove: No plan found');
      throw new Error("no plan found");
    }

    // Execute plan steps
    if (config.DEBUG) {
      agentLogger.debug('PDDLMove: Executing plan: ' + plan.map(s => s.action).join(", "));
    }

    for (const step of plan) {
      if (this.stopped) {
        agentLogger.hot('planStopped', 5000, 'PDDLMove: Plan stopped');
        throw new Error("stopped");
      }

      // Extract action (handle both {action: 'up'} and 'MOVE-UP' formats)
      let action = step.action || step;
      if (typeof action === "string") {
        action = action.toLowerCase().replace('move-', '').replace('move_', '');
      }

      const moveOk = await adapter.move(action);
      if (!moveOk) {
        agentLogger.hot('moveObstructed', 5000, 'PDDLMove: Move failed, path obstructed');
        return "obstructed";
      }
    }

    // Verify we reached destination
    const finalX = Math.round(this.parent.x);
    const finalY = Math.round(this.parent.y);
    if (finalX === tx && finalY === ty) {
      return true;
    }

    return "obstructed";
  }
}

export { PDDLMove };
