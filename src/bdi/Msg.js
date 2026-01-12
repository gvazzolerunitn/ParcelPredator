/**
 * Msg - Simple message structure for agent communication
 * 
 * Used for all inter-agent messages (handshake, belief sharing, intentions, collision)
 */
class Msg {
  constructor(header = undefined, content = undefined) {
    this.header = header;
    this.content = content;
    this.timestamp = Date.now();
  }

  setHeader(header) {
    this.header = header;
    return this;
  }

  setContent(content) {
    this.content = content;
    return this;
  }

  /**
   * Create a HANDSHAKE message
   * @param {string} phase - 'request' or 'ack'
   */
  static handshake(phase) {
    return new Msg('HANDSHAKE', phase);
  }

  /**
   * Create an INFO_PARCELS message
   * @param {Array} parcels - array of parcel objects
   */
  static parcels(parcels) {
    return new Msg('INFO_PARCELS', parcels);
  }

  /**
   * Create an INFO_PARCELS_DELTA message (diff-only)
   * @param {Object} delta - { added: [], updated: [], removed: [] }
   */
  static parcelsDelta(delta) {
    return new Msg('INFO_PARCELS_DELTA', delta);
  }

  /**
   * Create an INFO_AGENTS message
   * @param {Array} agents - array of agent objects
   */
  static agents(agents) {
    return new Msg('INFO_AGENTS', agents);
  }

  /**
   * Create an INFO_AGENTS_DELTA message (diff-only)
   * @param {Object} delta - { added: [], updated: [], removed: [] }
   */
  static agentsDelta(delta) {
    return new Msg('INFO_AGENTS_DELTA', delta);
  }

  /**
   * Create an INTENTION message
   * @param {Array} predicate - intention predicate [action, x, y, id, score]
   */
  static intention(predicate) {
    return new Msg('INTENTION', predicate);
  }

  /**
   * Create a COLLISION message
   * @param {string} type - 'COLLISION', 'MOVE', 'TAKE', 'DROP', 'END'
   */
  static collision(type) {
    return new Msg('COLLISION', type);
  }
}

export { Msg };
