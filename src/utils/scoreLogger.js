/**
 * scoreLogger.js - Simple score logger for final game results
 * 
 * Tracks the final score and saves it with run configuration to a file.
 */

import fs from 'fs';
import path from 'path';

export function createScoreLogger(config = {}) {
  const runId = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  let lastScore = 0;
  let agentId = null;
  let agentName = null;
  let mapName = 'unknown';
  let randomAgents = '0';
  
  // Extract config info
  const mode = config.DUAL ? 'DUAL' : 'SINGLE';
  const usePddl = config.usePddl !== false;
  
  // Try to get map and random agents from command line args
  const argv = process.argv;
  const levelIndex = argv.findIndex(arg => arg === '-l' || arg === '--level');
  if (levelIndex !== -1 && argv[levelIndex + 1]) {
    mapName = argv[levelIndex + 1].split('/').pop();
  }
  const zIndex = argv.findIndex(arg => arg === '-z');
  if (zIndex !== -1 && argv[zIndex + 1]) {
    randomAgents = argv[zIndex + 1];
  }
  
  function update({ id, name, score }) {
    agentId = id;
    agentName = name;
    lastScore = score;
  }
  
  function setMap(name) {
    if (name) mapName = name;
  }

  function setRandomAgents(n) {
    if (typeof n !== 'undefined' && n !== null) randomAgents = String(n);
  }
  
  async function save() {
    const dir = 'logs';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const filename = path.join(dir, `score-${runId}.txt`);
    const content = [
      '='.repeat(60),
      'PARCELPREDATOR - FINAL SCORE',
      '='.repeat(60),
      '',
      `Run ID: ${runId}`,
      `Agent: ${agentName} (${agentId})`,
      '',
      'CONFIGURATION:',
      `  Mode: ${mode}`,
      `  PDDL: ${usePddl ? 'enabled' : 'disabled'}`,
      `  Map: ${mapName}`,
      `  Random Moving Agents: ${randomAgents}`,
      '',
      '─'.repeat(60),
      `FINAL SCORE: ${lastScore}`,
      '─'.repeat(60),
      '',
      `Saved at: ${new Date().toISOString()}`,
      ''
    ].join('\n');
    
    await fs.promises.writeFile(filename, content, 'utf8');
    console.log(`\n[SCORE] Final score saved to: ${filename}`);
    console.log(`[SCORE] Final score: ${lastScore}`);
  }
  
  return { update, save, setMap, setRandomAgents };
}
