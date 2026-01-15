/**
 * latencyLogger.js - Simple latency logging for performance analysis
 * 
 * Logs perception latencies (time between server event and client reception)
 * to a CSV file for later analysis and reporting.
 */

import fs from 'fs';
import path from 'path';

class LatencyLogger {
  constructor() {
    this.runId = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    this.levelId = 'unknown';
    this.stream = null;
    this.filename = null;
    this.eventCount = 0;
    this.latencies = [];  // For in-memory stats
    this.lastEventTime = {};  // Track last event time per type for inter-arrival
    this.interArrivals = [];  // Inter-arrival times
  }

  /**
   * Initialize the logger with level info
   */
  init(levelId = 'unknown') {
    this.levelId = levelId;
    
    const dir = 'logs';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    this.filename = path.join(dir, `latency-${this.runId}.csv`);
    this.stream = fs.createWriteStream(this.filename, { flags: 'a' });
    
    // Write CSV header
    const header = 'run_id,level_id,timestamp_local,event_type,entity_type,entity_id,inter_arrival_ms\n';
    this.stream.write(header);
    
    console.log(`[LATENCY] Logging to: ${this.filename}`);
  }

  /**
   * Record a latency measurement
   * @param {Object} opts - Recording options
   * @param {string} opts.eventType - Type of event (onYou, onParcels, onAgents)
   * @param {string} opts.entityType - Type of entity (agent, parcel)
   * @param {string} opts.entityId - ID of the entity
   */
  record({ eventType, entityType, entityId }) {
    if (!this.stream) return;
    
    const localTime = Date.now();
    
    // Calculate inter-arrival time (time since last event of same type)
    const key = eventType;
    let interArrivalMs = '';
    if (this.lastEventTime[key]) {
      interArrivalMs = localTime - this.lastEventTime[key];
      if (interArrivalMs >= 0 && interArrivalMs < 10000) {  // Sanity check
        this.interArrivals.push(interArrivalMs);
      }
    }
    this.lastEventTime[key] = localTime;
    
    const row = [
      this.runId,
      this.levelId,
      new Date(localTime).toISOString(),
      eventType,
      entityType,
      entityId,
      interArrivalMs
    ].join(',') + '\n';
    
    this.stream.write(row);
    this.eventCount++;
  }

  /**
   * Calculate and return statistics
   */
  getStats() {
    const arr = this.interArrivals;
    if (arr.length === 0) {
      return { count: 0, mean: 0, median: 0, p95: 0, min: 0, max: 0 };
    }
    
    const sorted = [...arr].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);
    const mean = sum / count;
    const median = sorted[Math.floor(count / 2)];
    const p95 = sorted[Math.floor(count * 0.95)];
    const min = sorted[0];
    const max = sorted[count - 1];
    
    return { count, mean, median, p95, min, max };
  }

  /**
   * Close the logger and write summary
   */
  async close() {
    if (!this.stream) return;
    
    const stats = this.getStats();
    
    // Write summary to a separate file
    const summaryFile = this.filename.replace('.csv', '-summary.txt');
    const summary = [
      '='.repeat(60),
      'PARCELPREDATOR - LATENCY SUMMARY',
      '='.repeat(60),
      '',
      `Run ID: ${this.runId}`,
      `Level: ${this.levelId}`,
      `Total Events: ${this.eventCount}`,
      `Inter-Arrival Samples: ${stats.count}`,
      '',
      'INTER-ARRIVAL TIME STATISTICS (ms):',
      `  Min:    ${stats.min.toFixed(2)}`,
      `  Mean:   ${stats.mean.toFixed(2)}`,
      `  Median: ${stats.median.toFixed(2)}`,
      `  P95:    ${stats.p95.toFixed(2)}`,
      `  Max:    ${stats.max.toFixed(2)}`,
      '',
      'Note: Inter-arrival time = time between consecutive events',
      'Lower values indicate more frequent updates (better responsiveness).',
      '',
      `Saved at: ${new Date().toISOString()}`,
      ''
    ].join('\n');
    
    await fs.promises.writeFile(summaryFile, summary, 'utf8');
    
    return new Promise((resolve) => {
      this.stream.end(() => {
        console.log(`\\n[LATENCY] Summary saved to: ${summaryFile}`);
        console.log(`[LATENCY] Events logged: ${this.eventCount}`);
        if (stats.count > 0) {
          console.log(`[LATENCY] Mean inter-arrival: ${stats.mean.toFixed(2)}ms, P95: ${stats.p95.toFixed(2)}ms`);
        }
        resolve();
      });
    });
  }
}

// Singleton instance
export const latencyLogger = new LatencyLogger();
