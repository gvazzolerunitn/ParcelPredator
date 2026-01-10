/**
 * Fast Local PDDL Solver
 * 
 * Provides a lightweight local solver for simple grid movement problems.
 * Falls back to online solver if local solution fails or for complex problems.
 * 
 * The local solver uses A* search on the grid to find a path, then converts
 * it to PDDL-style action format. This is much faster than calling an external
 * PDDL solver for simple navigation problems.
 */

/**
 * Parse PDDL problem to extract start, goal, and grid info
 * @param {string} problem - PDDL problem string
 * @returns {object} { start: {x,y}, goal: {x,y}, blocked: Set<"x,y">, tiles: Set<"x,y"> }
 */
function parseProblem(problem) {
  const result = {
    start: null,
    goal: null,
    blocked: new Set(),
    tiles: new Set(),
    adjacencies: new Map() // tile -> { up, down, left, right }
  };

  // Extract start position: (at tile_X_Y)
  const atMatch = problem.match(/\(at (tile_(\d+)_(\d+))\)/);
  if (atMatch) {
    result.start = { x: parseInt(atMatch[2]), y: parseInt(atMatch[3]) };
  }

  // Extract goal: (:goal (at tile_X_Y))
  const goalMatch = problem.match(/:goal\s*\(\s*at (tile_(\d+)_(\d+))\s*\)/);
  if (goalMatch) {
    result.goal = { x: parseInt(goalMatch[2]), y: parseInt(goalMatch[3]) };
  }

  // Extract all walkable tiles
  const walkableRegex = /\(walkable (tile_(\d+)_(\d+))\)/g;
  let match;
  while ((match = walkableRegex.exec(problem)) !== null) {
    result.tiles.add(`${match[2]},${match[3]}`);
  }

  // Extract free tiles (not occupied)
  const freeSet = new Set();
  const freeRegex = /\(free (tile_(\d+)_(\d+))\)/g;
  while ((match = freeRegex.exec(problem)) !== null) {
    freeSet.add(`${match[2]},${match[3]}`);
  }

  // Blocked = walkable but not free
  for (const tile of result.tiles) {
    if (!freeSet.has(tile)) {
      result.blocked.add(tile);
    }
  }

  // Parse adjacencies
  const adjPatterns = [
    { regex: /\(adjacent-up (tile_(\d+)_(\d+)) (tile_(\d+)_(\d+))\)/g, dir: 'up' },
    { regex: /\(adjacent-down (tile_(\d+)_(\d+)) (tile_(\d+)_(\d+))\)/g, dir: 'down' },
    { regex: /\(adjacent-left (tile_(\d+)_(\d+)) (tile_(\d+)_(\d+))\)/g, dir: 'left' },
    { regex: /\(adjacent-right (tile_(\d+)_(\d+)) (tile_(\d+)_(\d+))\)/g, dir: 'right' }
  ];

  for (const { regex, dir } of adjPatterns) {
    let m;
    while ((m = regex.exec(problem)) !== null) {
      const fromKey = `${m[2]},${m[3]}`;
      const toKey = `${m[5]},${m[6]}`;
      if (!result.adjacencies.has(fromKey)) {
        result.adjacencies.set(fromKey, {});
      }
      result.adjacencies.get(fromKey)[dir] = toKey;
    }
  }

  return result;
}

/**
 * A* search on parsed problem
 * @param {object} parsed - Output from parseProblem
 * @returns {array} Array of actions [{action: 'up'}, ...] or null if no path
 */
function aStarSearch(parsed) {
  const { start, goal, blocked, tiles, adjacencies } = parsed;
  
  if (!start || !goal) return null;
  
  const startKey = `${start.x},${start.y}`;
  const goalKey = `${goal.x},${goal.y}`;
  
  // Already at goal
  if (startKey === goalKey) return [];
  
  // A* data structures
  const openSet = new Set([startKey]);
  const cameFrom = new Map();
  const gScore = new Map([[startKey, 0]]);
  const fScore = new Map([[startKey, heuristic(start, goal)]]);
  
  function heuristic(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }
  
  function getLowestFScore() {
    let lowest = null;
    let lowestScore = Infinity;
    for (const key of openSet) {
      const score = fScore.get(key) ?? Infinity;
      if (score < lowestScore) {
        lowestScore = score;
        lowest = key;
      }
    }
    return lowest;
  }
  
  function parseKey(key) {
    const [x, y] = key.split(',').map(Number);
    return { x, y };
  }
  
  while (openSet.size > 0) {
    const currentKey = getLowestFScore();
    if (currentKey === goalKey) {
      // Reconstruct path
      const path = [];
      let curr = currentKey;
      while (cameFrom.has(curr)) {
        const { from, action } = cameFrom.get(curr);
        path.unshift({ action });
        curr = from;
      }
      return path;
    }
    
    openSet.delete(currentKey);
    const current = parseKey(currentKey);
    const neighbors = adjacencies.get(currentKey) || {};
    
    for (const [dir, neighborKey] of Object.entries(neighbors)) {
      // Skip blocked tiles (unless it's the goal)
      if (blocked.has(neighborKey) && neighborKey !== goalKey) continue;
      
      const tentativeG = (gScore.get(currentKey) ?? Infinity) + 1;
      
      if (tentativeG < (gScore.get(neighborKey) ?? Infinity)) {
        cameFrom.set(neighborKey, { from: currentKey, action: dir });
        gScore.set(neighborKey, tentativeG);
        const neighbor = parseKey(neighborKey);
        fScore.set(neighborKey, tentativeG + heuristic(neighbor, goal));
        openSet.add(neighborKey);
      }
    }
  }
  
  // No path found
  return null;
}

/**
 * Solve PDDL problem locally using A* search
 * @param {string} domain - PDDL domain string (not used for local solver, kept for API compat)
 * @param {string} problem - PDDL problem string
 * @returns {Promise<array>} Array of actions [{action: 'up'}, ...] or empty array if no solution
 */
async function fastLocalSolver(domain, problem) {
  try {
    const parsed = parseProblem(problem);
    const plan = aStarSearch(parsed);
    
    if (plan === null) {
      console.log('fastLocalSolver: No path found');
      return [];
    }
    
    return plan;
  } catch (err) {
    console.error('fastLocalSolver error:', err.message);
    return [];
  }
}

/**
 * Try online solver as fallback
 * Requires @unitn-asa/pddl-client to be installed
 * @param {string} domain - PDDL domain string
 * @param {string} problem - PDDL problem string
 * @returns {Promise<array>} Array of actions or empty array
 */
async function onlineSolverFallback(domain, problem) {
  try {
    const { onlineSolver } = await import('@unitn-asa/pddl-client');
    const plan = await onlineSolver(domain, problem);
    return plan || [];
  } catch (err) {
    console.error('onlineSolver not available or failed:', err.message);
    return [];
  }
}

export { fastLocalSolver, onlineSolverFallback, parseProblem, aStarSearch };
