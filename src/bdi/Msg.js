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

  /** Create a REQUEST message (FIPA-compliant) */
  static request(parcel) {
    return new Msg('REQUEST', {
      id: parcel.id,
      x: parcel.x,
      y: parcel.y,
      reward: parcel.reward
    });
  }

  /** Create an AGREE message (FIPA-compliant) */
  static agree(requestId = null) {
    return new Msg('AGREE', requestId);
  }

  /** Create a REFUSE message (FIPA-compliant) */
  static refuse(requestId = null, reason = 'cannot_perform') {
    return new Msg('REFUSE', { requestId, reason });
  }
}

export { Msg };
