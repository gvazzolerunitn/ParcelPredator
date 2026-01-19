/**
 * runLogger.js - Unified Run Logger
 * 
 * Combines all logging into a single clean report file per run:
 * - Configuration (mode, PDDL, map, random agents)
 * - Final score
 * - Latency statistics (inter-arrival times)
 * - PDDL solver statistics (if available)
 */

import fs from 'fs';
import path from 'path';

class RunLogger {
  constructor(config = {}) {
    this.runId = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    this.config = config;
    
    // Score tracking
    this.agentId = null;
    this.agentName = null;
    this.lastScore = 0;
    
    // Config tracking (set from server)
    this.mapName = 'unknown';
    this.randomAgents = 0;
    
    // Latency tracking
    this.lastEventTime = {};
    this.interArrivals = { onYou: [], onParcels: [], onAgents: [] };
    this.eventCounts = { onYou: 0, onParcels: 0, onAgents: 0 };
    
    // PDDL solver tracking
    this.solverCalls = [];
    
    this.initialized = false;
  }

  /**
   * Initialize with server config
   */
  init(mapName, randomAgents = 0) {
    this.mapName = mapName || 'unknown';
    this.randomAgents = randomAgents;
    this.initialized = true;
    console.log(`[RUN] Logging run: ${this.runId} | Map: ${this.mapName}`);
  }

  /**
   * Update score from onYou event
   */
  updateScore({ id, name, score }) {
    this.agentId = id;
    this.agentName = name;
    this.lastScore = score;
  }

  /**
   * Record an event for latency tracking
   */
  recordEvent(eventType) {
    if (!this.eventCounts[eventType]) {
      this.eventCounts[eventType] = 0;
      this.interArrivals[eventType] = [];
    }
    
    const now = Date.now();
    this.eventCounts[eventType]++;
    
    // Calculate inter-arrival time
    if (this.lastEventTime[eventType]) {
      const interArrival = now - this.lastEventTime[eventType];
      if (interArrival >= 0 && interArrival < 10000) {
        this.interArrivals[eventType].push(interArrival);
      }
    }
    this.lastEventTime[eventType] = now;
  }

  /**
   * Record a PDDL solver call
   */
  recordSolverCall({ durationMs, planLength, cacheHit, start, goal }) {
    this.solverCalls.push({
      timestamp: Date.now(),
      durationMs,
      planLength: planLength || 0,
      cacheHit: cacheHit ? 1 : 0,
      start: start || '',
      goal: goal || ''
    });
  }

  /**
   * Calculate statistics for an array of numbers
   */
  calcStats(arr) {
    if (!arr || arr.length === 0) {
      return { count: 0, mean: 0, median: 0, p95: 0, min: 0, max: 0 };
    }
    const sorted = [...arr].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);
    return {
      count,
      mean: sum / count,
      median: sorted[Math.floor(count / 2)],
      p95: sorted[Math.floor(count * 0.95)] || sorted[count - 1],
      min: sorted[0],
      max: sorted[count - 1]
    };
  }

  /**
   * Save the unified run report
   */
  async save() {
    const dir = 'logs';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Include agent name in filename to separate dual agent logs
    const agentSuffix = this.agentName ? `-${this.agentName}` : '';
    const filename = path.join(dir, `run-${this.runId}${agentSuffix}.txt`);
    
    // Get config info
    const mode = this.config.DUAL ? 'DUAL' : 'SINGLE';
    const usePddl = this.config.usePddl !== false;
    
    // Calculate latency stats
    const youStats = this.calcStats(this.interArrivals.onYou);
    const parcelsStats = this.calcStats(this.interArrivals.onParcels);
    const agentsStats = this.calcStats(this.interArrivals.onAgents);
    
    // Calculate solver stats
    const solverDurations = this.solverCalls.map(c => c.durationMs);
    const solverStats = this.calcStats(solverDurations);
    const cacheHits = this.solverCalls.filter(c => c.cacheHit).length;
    const cacheRate = this.solverCalls.length > 0 
      ? ((cacheHits / this.solverCalls.length) * 100).toFixed(1) 
      : 0;

    // Build report
    const lines = [
      '═'.repeat(60),
      '                PARCELPREDATOR - RUN REPORT',
      '═'.repeat(60),
      '',
      `Run ID:     ${this.runId}`,
      `Agent:      ${this.agentName} (${this.agentId})`,
      `Saved at:   ${new Date().toISOString()}`,
      '',
      '─'.repeat(60),
      '                      CONFIGURATION',
      '─'.repeat(60),
      `  Mode:                 ${mode}`,
      `  PDDL Planner:         ${usePddl ? 'enabled' : 'disabled'}`,
      `  Map:                  ${this.mapName}`,
      `  Random Moving Agents: ${this.randomAgents}`,
      '',
      '─'.repeat(60),
      '                       FINAL SCORE',
      '─'.repeat(60),
      '',
      `                         ${this.lastScore}`,
      '',
      '─'.repeat(60),
      '                   LATENCY STATISTICS',
      '─'.repeat(60),
      '',
      '  Event Type       Count     Mean(ms)  Median(ms)  P95(ms)',
      '  ─────────────────────────────────────────────────────────',
      `  onYou            ${String(this.eventCounts.onYou).padStart(5)}     ${youStats.mean.toFixed(1).padStart(8)}    ${youStats.median.toFixed(1).padStart(8)}   ${youStats.p95.toFixed(1).padStart(7)}`,
      `  onParcels        ${String(this.eventCounts.onParcels).padStart(5)}     ${parcelsStats.mean.toFixed(1).padStart(8)}    ${parcelsStats.median.toFixed(1).padStart(8)}   ${parcelsStats.p95.toFixed(1).padStart(7)}`,
      `  onAgents         ${String(this.eventCounts.onAgents).padStart(5)}     ${agentsStats.mean.toFixed(1).padStart(8)}    ${agentsStats.median.toFixed(1).padStart(8)}   ${agentsStats.p95.toFixed(1).padStart(7)}`,
      '',
      '  Note: Values show inter-arrival time between consecutive events.',
      '        Lower values = more frequent updates = better responsiveness.',
    ];

    // Add PDDL section only if PDDL was used
    if (usePddl && this.solverCalls.length > 0) {
      lines.push(
        '',
        '─'.repeat(60),
        '                 PDDL SOLVER STATISTICS',
        '─'.repeat(60),
        '',
        `  Total Calls:      ${this.solverCalls.length}`,
        `  Cache Hits:       ${cacheHits} (${cacheRate}%)`,
        '',
        `  Duration (ms):    Min: ${solverStats.min.toFixed(2)}`,
        `                    Mean: ${solverStats.mean.toFixed(2)}`,
        `                    Median: ${solverStats.median.toFixed(2)}`,
        `                    P95: ${solverStats.p95.toFixed(2)}`,
        `                    Max: ${solverStats.max.toFixed(2)}`,
        ''
      );
    } else if (usePddl) {
      lines.push(
        '',
        '─'.repeat(60),
        '                 PDDL SOLVER STATISTICS',
        '─'.repeat(60),
        '',
        '  No PDDL solver calls recorded this run.',
        ''
      );
    }

    lines.push(
      '═'.repeat(60),
      ''
    );

    const content = lines.join('\n');
    await fs.promises.writeFile(filename, content, 'utf8');
    
    console.log(`\n[RUN] Report saved: ${filename}`);
    console.log(`[RUN] Final score: ${this.lastScore}`);
    if (youStats.count > 0) {
      console.log(`[RUN] Latency (onYou): mean=${youStats.mean.toFixed(1)}ms, p95=${youStats.p95.toFixed(1)}ms`);
    }
    if (this.solverCalls.length > 0) {
      console.log(`[RUN] PDDL: ${this.solverCalls.length} calls, mean=${solverStats.mean.toFixed(2)}ms, cache=${cacheRate}%`);
    }
  }
}

// Singleton instance
export const runLogger = new RunLogger();

// Factory function for external initialization with config
export function initRunLogger(config) {
  runLogger.config = config;
  return runLogger;
}
