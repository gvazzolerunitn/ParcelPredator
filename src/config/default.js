export default {
  host: "http://localhost:8080",
  agentName: "parcelpredator",
  token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjM2MWQ2ZiIsIm5hbWUiOiJURVNUIiwicm9sZSI6InVzZXIiLCJpYXQiOjE3Njc4ODg4NTN9.vulm2DreuvoPiiWEO0by8IvCWbKycCPLAlotlQZroT0", // genera dalla UI o API del server
  dual: false,
  usePddl: false,
  solver: "local", // local | online (per futuro PDDL)
  useManhattan: true,
  randomProbability: 0.2,
  tolerance: 5
};
