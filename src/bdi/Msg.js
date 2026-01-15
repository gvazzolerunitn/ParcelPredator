/**
 * Msg.js - Message Structure for Agent Communication
 * 
 * Simple message format for inter-agent communication.
 */

class Msg {
  constructor(header = undefined, content = undefined) {
    this.header = header;
    this.content = content;
    this.timestamp = Date.now();
  }

  /** Create a HANDSHAKE message */
  static handshake(phase) {
    return new Msg('HANDSHAKE', phase);
  }

  /** Create an INFO_PARCELS message */
  static parcels(parcels) {
    return new Msg('INFO_PARCELS', parcels);
  }

  /** Create an INFO_AGENTS message */
  static agents(agents) {
    return new Msg('INFO_AGENTS', agents);
  }

  /** Create an INTENTION message */
  static intention(predicate) {
    return new Msg('INTENTION', predicate);
  }
}

export { Msg };
