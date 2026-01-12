export default {
  host: "http://localhost:8080",
  agentName: "parcelpredator",
  
  // ===== DEBUG & LOGGING =====
  DEBUG: false,                  // Enable verbose logging (solver, plan steps, etc.)
  COMM_RATE_LIMIT: 5,            // Max messages per second per type (parcels, agents)
  COMM_SUMMARY_INTERVAL: 5000,   // Interval (ms) for comm statistics summary log
  COMM_FULL_SYNC_INTERVAL: 30000, // Interval (ms) for full sync fallback (diff-only otherwise)
  
  // Token per Agent 1 (genera dalla UI o API del server)
  token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjM2MWQ2ZiIsIm5hbWUiOiJURVNUIiwicm9sZSI6InVzZXIiLCJpYXQiOjE3Njc4ODg4NTN9.vulm2DreuvoPiiWEO0by8IvCWbKycCPLAlotlQZroT0",
  
  // Token per Agent 2 (genera un secondo token dalla UI con nome diverso)
  token2: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImVhMDlkMyIsIm5hbWUiOiJURVNUMiIsInJvbGUiOiJ1c2VyIiwiaWF0IjoxNzY4MjA5OTY2fQ.DmWyDpMsUtJKMm3TzjZ1jscqME1tjeV4urkUmDD0RyM",
  
  // DUAL mode: true per abilitare comunicazione tra due agenti
  DUAL: true,
  
  // PDDL Planning options
  usePddl: false,        // Set to true to enable PDDL-based movement planning
  solver: "local",       // "local" = fast A* solver | "online" = @unitn-asa/pddl-client
  
  // Retry/Backoff settings
  moveMicroRetries: 1,           // Additional retries for each adapter.move() call
  microRetryDelayMs: 100,        // Delay between micro-retries
  planMaxAttempts: 3,            // Max replan attempts when path is obstructed
  planBackoffBaseMs: 200,        // Base backoff delay between plan attempts (exponential: 200, 400, 800...)
  planBackoffJitterMs: 100,      // Max random jitter added to backoff
  targetCooldownMs: 3000,        // Cooldown duration for targets after all retries fail
  
  useManhattan: true,
  randomProbability: 0.2,
  tolerance: 5
};
