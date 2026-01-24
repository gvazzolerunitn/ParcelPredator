// Adapter to normalize DeliverooApi client calls.
// The official client exposes emitMove/emitPickup/emitPutdown/emitShout.
// Fallback to unprefixed names for alternative client versions.
import { client } from "./context.js";

const adapter = {
  // Actions: prefer emit* (standard), fallback to unprefixed names
  move: (...args) => (client.emitMove || client.move).call(client, ...args),
  pickup: (...args) => (client.emitPickup || client.pickup).call(client, ...args),
  putdown: (...args) => (client.emitPutdown || client.putdown).call(client, ...args),
  shout: (...args) => (client.emitShout || client.shout).call(client, ...args),
  say: (...args) => (client.emitSay || client.say).call(client, ...args),
  ask: (...args) => (client.emitAsk || client.ask).call(client, ...args),
  
  // Events: official client names
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
