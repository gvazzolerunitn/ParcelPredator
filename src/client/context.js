import { DeliverooApi } from "@unitn-asa/deliveroo-js-client";
import config from "../config/default.js";

// Inizializza client con host+token; la query name è gestita da token lato server.
const client = new DeliverooApi(config.host, config.token);

export { client };
