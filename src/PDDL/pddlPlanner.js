/**
 * PDDL Problem Generator for Deliveroo grid movement.
 * Generates a PDDL problem string based on current grid state, agent position,
 * target position, and positions of other agents to avoid.
 */

class PddlPlanner {
  /**
   * @param {object} grid - Grid object with width, height, isAccessible(x,y)
   * @param {object} start - {x, y} agent current position
   * @param {object} goal - {x, y} target position
   * @param {array} otherAgents - [{x, y}, ...] positions of other agents to avoid
   */
  constructor(grid, start, goal, otherAgents = []) {
    this.grid = grid;
    this.start = { x: Math.round(start.x), y: Math.round(start.y) };
    this.goal = { x: Math.round(goal.x), y: Math.round(goal.y) };
    this.otherAgents = otherAgents.map(a => ({ x: Math.round(a.x), y: Math.round(a.y) }));
  }

  /**
   * Generate tile name from coordinates
   */
  tileName(x, y) {
    return `tile_${x}_${y}`;
  }

  /**
   * Check if a position is occupied by another agent
   */
  isOccupied(x, y) {
    return this.otherAgents.some(a => a.x === x && a.y === y);
  }

  /**
   * Generate the PDDL problem string
   */
  getProblem() {
    const lines = [];
    const tiles = [];
    const adjacencies = [];
    const walkables = [];
    const frees = [];

    // Collect all accessible tiles and their properties
    for (let x = 0; x < this.grid.width; x++) {
      for (let y = 0; y < this.grid.height; y++) {
        if (!this.grid.isAccessible(x, y)) continue;
        
        const name = this.tileName(x, y);
        tiles.push(name);
        walkables.push(`(walkable ${name})`);
        
        // Mark as free if not occupied by another agent (allow goal even if occupied)
        const isGoal = (x === this.goal.x && y === this.goal.y);
        if (!this.isOccupied(x, y) || isGoal) {
          frees.push(`(free ${name})`);
        }

        // Generate adjacencies (only to accessible tiles)
        // up: y+1
        if (this.grid.isAccessible(x, y + 1)) {
          adjacencies.push(`(adjacent-up ${name} ${this.tileName(x, y + 1)})`);
        }
        // down: y-1
        if (this.grid.isAccessible(x, y - 1)) {
          adjacencies.push(`(adjacent-down ${name} ${this.tileName(x, y - 1)})`);
        }
        // left: x-1
        if (this.grid.isAccessible(x - 1, y)) {
          adjacencies.push(`(adjacent-left ${name} ${this.tileName(x - 1, y)})`);
        }
        // right: x+1
        if (this.grid.isAccessible(x + 1, y)) {
          adjacencies.push(`(adjacent-right ${name} ${this.tileName(x + 1, y)})`);
        }
      }
    }

    const startTile = this.tileName(this.start.x, this.start.y);
    const goalTile = this.tileName(this.goal.x, this.goal.y);

    // Build problem definition
    lines.push('(define (problem deliveroo-move)');
    lines.push('  (:domain deliveroo-movement)');
    lines.push('  (:objects');
    lines.push(`    ${tiles.join(' ')} - tile`);
    lines.push('  )');
    lines.push('  (:init');
    lines.push(`    (at ${startTile})`);
    walkables.forEach(w => lines.push(`    ${w}`));
    frees.forEach(f => lines.push(`    ${f}`));
    adjacencies.forEach(a => lines.push(`    ${a}`));
    lines.push('  )');
    lines.push('  (:goal');
    lines.push(`    (at ${goalTile})`);
    lines.push('  )');
    lines.push(')');

    return lines.join('\n');
  }

  /**
   * Get problem as single-line string (for some solvers)
   */
  getProblemOneLine() {
    return this.getProblem()
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

export { PddlPlanner };
