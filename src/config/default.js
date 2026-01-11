export default {
  host: "http://localhost:8080",
  agentName: "parcelpredator",
  token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjM2MWQ2ZiIsIm5hbWUiOiJURVNUIiwicm9sZSI6InVzZXIiLCJpYXQiOjE3Njc4ODg4NTN9.vulm2DreuvoPiiWEO0by8IvCWbKycCPLAlotlQZroT0", // genera dalla UI o API del server
  dual: false,
  
  // PDDL Planning options
  usePddl: true,        // Set to true to enable PDDL-based movement planning
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
