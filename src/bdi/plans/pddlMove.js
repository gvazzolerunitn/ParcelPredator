/**
 * PDDLMove Plan
 * 
 * Movement plan that uses PDDL planning to find optimal path.
 * Generates a PDDL problem from current state, calls the solver,
 * and executes the returned plan step by step.
 * 
 * Falls back gracefully if planning fails or path is obstructed.
 */

import { adapter } from "../../client/adapter.js";
import { grid } from "../../utils/grid.js";
import { PddlPlanner } from "../../PDDL/pddlPlanner.js";
import { fastLocalSolver, onlineSolverFallback } from "../../PDDL/fastLocalSolver.js";
import config from "../../config/default.js";
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";

// Get directory of current module for domain.pddl path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DOMAIN_PATH = path.join(__dirname, "../../PDDL/domain.pddl");

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
      console.error("PDDLMove: Cannot read domain.pddl:", err.message);
      throw new Error("domain not found");
    }

    // Call solver
    const startTime = Date.now();
    let plan;

    if (config.solver === "online") {
      console.log("PDDLMove: Using online solver...");
      plan = await onlineSolverFallback(domain, problem);
    } else {
      console.log("PDDLMove: Using local solver...");
      plan = await fastLocalSolver(domain, problem);
    }

    const elapsed = Date.now() - startTime;
    console.log(`PDDLMove: Solver completed in ${elapsed}ms, plan length: ${plan?.length || 0}`);

    // Empty plan but not at goal = no solution
    if (!plan || plan.length === 0) {
      if (sx === tx && sy === ty) {
        return true; // Already there
      }
      console.log("PDDLMove: No plan found");
      throw new Error("no plan found");
    }

    // Execute plan steps
    console.log(`PDDLMove: Executing plan: ${plan.map(s => s.action).join(", ")}`);

    for (const step of plan) {
      if (this.stopped) {
        console.log("PDDLMove: Plan stopped during execution");
        throw new Error("stopped");
      }

      // Extract action (handle both {action: 'up'} and 'move-up' formats)
      let action = step.action || step;
      if (typeof action === "string") {
        // Convert PDDL action names to simple directions
        action = action.replace("move-", "").toLowerCase();
      }

      const result = await adapter.move(action);

      if (!result) {
        console.log(`PDDLMove: Move '${action}' failed, path obstructed`);
        return "obstructed";
      }
    }

    // Verify we reached destination
    const finalX = Math.round(this.parent.x);
    const finalY = Math.round(this.parent.y);
    if (finalX === tx && finalY === ty) {
      console.log(`PDDLMove: Successfully reached (${tx}, ${ty})`);
      return true;
    }

    console.log(`PDDLMove: Ended at (${finalX}, ${finalY}), expected (${tx}, ${ty})`);
    return "obstructed";
  }
}

export { PDDLMove };
