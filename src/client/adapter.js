// Adapter per uniformare le chiamate al client DeliverooApi.
// Il client ufficiale espone emitMove/emitPickup/emitPutdown/emitShout.
// Fallback a nomi senza prefisso per eventuali versioni alternative.
import { client } from "./context.js";

const adapter = {
  // Azioni - preferisce emit* (standard), fallback a nomi senza prefisso
  move: (...args) => (client.emitMove || client.move).call(client, ...args),
  pickup: (...args) => (client.emitPickup || client.pickup).call(client, ...args),
  putdown: (...args) => (client.emitPutdown || client.putdown).call(client, ...args),
  shout: (...args) => (client.emitShout || client.shout).call(client, ...args),
  say: (...args) => (client.emitSay || client.say).call(client, ...args),
  ask: (...args) => (client.emitAsk || client.ask).call(client, ...args),
  
  // Eventi - nomi ufficiali del client
  onYou: (cb) => client.onYou(cb),
  onMap: (cb) => client.onMap(cb),
  onParcels: (cb) => client.onParcelsSensing(cb),
  onAgents: (cb) => client.onAgentsSensing(cb),
  onConfig: (cb) => client.onConfig(cb),
  onMsg: (cb) => client.onMsg(cb),
  onDisconnect: (cb) => client.onDisconnect(cb),
  onConnect: (cb) => client.onConnect(cb),
};

export { adapter };
