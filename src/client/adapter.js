// Adapter per uniformare le chiamate: se usi DeliverooApi moderno hai move/pickup/putdown.
// Se usi emitMove/emitPickup/emitPutdown, adatta qui.
import { client } from "./context.js";

const adapter = {
  move: (...args) => client.move ? client.move(...args) : client.emitMove(...args),
  pickup: (...args) => client.pickup ? client.pickup(...args) : client.emitPickup(...args),
  putdown: (...args) => client.putdown ? client.putdown(...args) : client.emitPutdown(...args),
  shout: (...args) => client.shout ? client.shout(...args) : client.emitShout(...args),
  onYou: (cb) => client.onYou(cb),
  onMap: (cb) => client.onMap(cb),
  onParcels: (cb) => client.onParcelsSensing(cb),
  onAgents: (cb) => client.onAgentsSensing(cb),
  onConfig: (cb) => client.onConfig(cb),
  onDisconnect: (cb) => client.onDisconnect(cb),
  onConnect: (cb) => client.onConnect(cb),
};

export { adapter };
