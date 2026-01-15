/**
 * default.js - Agent Configuration
 * 
 * Main configuration file for the ParcelPredator agent.
 */

export default {
  // Server connection
  host: "http://localhost:8080",
  agentName: "parcelpredator",
  
  // Agent tokens (generate from server UI)
  token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjM2MWQ2ZiIsIm5hbWUiOiJURVNUIiwicm9sZSI6InVzZXIiLCJpYXQiOjE3Njc4ODg4NTN9.vulm2DreuvoPiiWEO0by8IvCWbKycCPLAlotlQZroT0",
  token2: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImVhMDlkMyIsIm5hbWUiOiJURVNUMiIsInJvbGUiOiJ1c2VyIiwiaWF0IjoxNzY4MjA5OTY2fQ.DmWyDpMsUtJKMm3TzjZ1jscqME1tjeV4urkUmDD0RyM",
  
  // Multi-agent mode
  DUAL: false,           // Set to true to enable two-agent coordination
  
  // Planning
  usePddl: true,         // true = PDDL planning, false = BFS movement
  solver: "local",       // "local" = fast A* solver, "online" = pddl-client
  
  // Debug
  DEBUG: false           // Enable verbose logging
};
