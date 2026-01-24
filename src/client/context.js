import { DeliverooApi } from "@unitn-asa/deliveroo-js-client";
import config from "../config/default.js";
import { defaultLogger } from '../utils/logger.js';

// Parse CLI arguments to determine which agent we are
const args = process.argv.slice(2);
const isSecondAgent = args.includes('--agent') && args[args.indexOf('--agent') + 1] === '2';

// Select token based on agent number
const token = isSecondAgent ? config.token2 : config.token;
const agentLabel = isSecondAgent ? 'Agent2' : 'Agent1';

defaultLogger.info(`[CONTEXT] Starting as ${agentLabel}`);

// MODIFICA: Usiamo direttamente config.host e il token.
// Nessun parametro "?name=" viene aggiunto.
// Il server identificherà l'agente ESCLUSIVAMENTE tramite il token passato.
const client = new DeliverooApi(config.host, token);

export { client, isSecondAgent, agentLabel };