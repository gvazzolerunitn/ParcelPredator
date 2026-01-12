/**
 * Comm - Communication module for multi-agent coordination
 * 
 * Handles:
 * - Handshake protocol to establish friendId
 * - Sending/receiving belief updates (parcels, agents)
 * - Sending/receiving intention claims
 * - Collision protocol messages
 */
import { Msg } from './Msg.js';
import { commLogger } from '../utils/logger.js';

class Comm {
  constructor(adapter, me, belief, config) {
    this.adapter = adapter;
    this.me = me;
    this.belief = belief;
    this.config = config;
    this.friendId = null;
    this.isSecondAgent = false;
    this.handshakeCompleted = false;
    
    // Message handlers registered by external modules
    this._handlers = new Map();

    // Rate limiting: track last send time per message type
    this._lastSendTime = {
      parcels: 0,
      agents: 0
    };
    this._minSendInterval = 1000 / (config.COMM_RATE_LIMIT || 5); // ms between sends

    // Diff-only: snapshots of last sent data for delta computation
    this._lastSentParcels = new Map(); // id -> {x, y, reward, carriedBy}
    this._lastSentAgents = new Map();  // id -> {x, y}
    this._lastFullSendTime = { parcels: 0, agents: 0 };
    this._fullSendInterval = config.COMM_FULL_SYNC_INTERVAL || 30000; // Full sync every 30s
  }

  /**
   * Check if we can send a message of given type (rate limiting)
   * @param {string} type - 'parcels' or 'agents'
   * @returns {boolean} true if allowed to send
   */
  _canSend(type) {
    const now = Date.now();
    if (now - this._lastSendTime[type] >= this._minSendInterval) {
      this._lastSendTime[type] = now;
      return true;
    }
    return false;
  }

  /**
   * Initialize communication - call after connection
   * @param {boolean} isSecondAgent - true if this is agent 2
   */
  async init(isSecondAgent) {
    this.isSecondAgent = isSecondAgent;
    
    // Register message handler
    this.adapter.onMsg((id, name, msg, reply) => this._handleMessage(id, name, msg, reply));
    
    // If second agent, initiate handshake
    if (isSecondAgent) {
      commLogger.info('Agent 2 initiating handshake...');
      await this._sendHandshakeRequest();
    } else {
      commLogger.info('Agent 1 waiting for handshake...');
    }
  }

  /**
   * Register a handler for a specific message type
   * @param {string} header - message header to handle
   * @param {Function} handler - function(senderId, content, reply)
   */
  on(header, handler) {
    if (!this._handlers.has(header)) {
      this._handlers.set(header, []);
    }
    this._handlers.get(header).push(handler);
  }

  /**
   * Internal message handler - routes to registered handlers
   */
  async _handleMessage(senderId, senderName, msg, replyCallback) {
    // Validate message structure
    if (!msg || !msg.header) {
      commLogger.warn('Received invalid message:', msg);
      return;
    }

    const { header, content } = msg;
    
    // Handle handshake internally
    if (header === 'HANDSHAKE') {
      await this._handleHandshake(senderId, content, replyCallback);
      return;
    }

    // Route to registered handlers
    const handlers = this._handlers.get(header) || [];
    for (const handler of handlers) {
      try {
        await handler(senderId, content, replyCallback);
      } catch (err) {
        console.error(`[COMM] Handler error for ${header}:`, err);
      }
    }
  }

  /**
   * Handshake protocol
   */
  async _sendHandshakeRequest() {
    const msg = Msg.handshake('request');
    await this.adapter.shout(msg);
  }

  async _handleHandshake(senderId, phase, replyCallback) {
    if (phase === 'request' && !this.isSecondAgent) {
      // Agent 1 receives request from Agent 2
      commLogger.info(`Received handshake request from ${senderId}`);
      this.friendId = senderId;
      this.me.friendId = senderId;
      
      // Send acknowledgment
      const ackMsg = Msg.handshake('ack');
      await this.adapter.say(senderId, ackMsg);
      
      this.handshakeCompleted = true;
      commLogger.info(`Handshake completed with ${senderId}`);
    } 
    else if (phase === 'ack' && this.isSecondAgent) {
      // Agent 2 receives ack from Agent 1
      this.friendId = senderId;
      this.me.friendId = senderId;
      this.handshakeCompleted = true;
      commLogger.info(`Handshake completed with ${senderId}`);
    }
  }

  /**
   * Check if communication is ready (handshake done)
   */
  isReady() {
    return this.handshakeCompleted && this.friendId !== null;
  }

  // =========================================================================
  // SENDING METHODS (with diff-only optimization)
  // =========================================================================

  /**
   * Check if we should send full sync (periodic fallback)
   */
  _shouldFullSync(type) {
    const now = Date.now();
    return now - this._lastFullSendTime[type] >= this._fullSendInterval;
  }

  /**
   * Compute delta for parcels: added, updated, removed
   */
  _computeParcelsDelta(parcels) {
    const current = new Map();
    for (const p of parcels) {
      current.set(p.id, { x: Math.round(p.x), y: Math.round(p.y), reward: p.reward, carriedBy: p.carriedBy || null });
    }

    const added = [];
    const updated = [];
    const removed = [];

    // Find added or updated
    for (const [id, data] of current) {
      const prev = this._lastSentParcels.get(id);
      if (!prev) {
        added.push({ id, ...data });
      } else if (prev.x !== data.x || prev.y !== data.y || prev.reward !== data.reward || prev.carriedBy !== data.carriedBy) {
        updated.push({ id, ...data });
      }
    }

    // Find removed
    for (const id of this._lastSentParcels.keys()) {
      if (!current.has(id)) {
        removed.push(id);
      }
    }

    // Update snapshot
    this._lastSentParcels = current;

    return { added, updated, removed };
  }

  /**
   * Compute delta for agents: added, updated, removed
   */
  _computeAgentsDelta(agents) {
    const current = new Map();
    for (const a of agents) {
      current.set(a.id, { x: Math.round(a.x), y: Math.round(a.y) });
    }

    const added = [];
    const updated = [];
    const removed = [];

    for (const [id, data] of current) {
      const prev = this._lastSentAgents.get(id);
      if (!prev) {
        added.push({ id, ...data });
      } else if (prev.x !== data.x || prev.y !== data.y) {
        updated.push({ id, ...data });
      }
    }

    for (const id of this._lastSentAgents.keys()) {
      if (!current.has(id)) {
        removed.push(id);
      }
    }

    this._lastSentAgents = current;

    return { added, updated, removed };
  }

  /**
   * Send parcels info to friend agent (rate-limited, diff-only with periodic full sync)
   * @param {Array} parcels - array of parcel objects
   */
  async sendParcels(parcels) {
    if (!this.isReady()) return;
    if (!this._canSend('parcels')) return;

    const forceFullSync = this._shouldFullSync('parcels');

    if (forceFullSync) {
      // Full sync: send entire array
      this._lastFullSendTime.parcels = Date.now();
      // Update snapshot
      this._lastSentParcels = new Map();
      for (const p of parcels) {
        this._lastSentParcels.set(p.id, { x: Math.round(p.x), y: Math.round(p.y), reward: p.reward, carriedBy: p.carriedBy || null });
      }
      const msg = Msg.parcels(parcels);
      await this.adapter.say(this.friendId, msg);
    } else {
      // Delta sync
      const delta = this._computeParcelsDelta(parcels);
      const hasChanges = delta.added.length > 0 || delta.updated.length > 0 || delta.removed.length > 0;
      if (hasChanges) {
        const msg = Msg.parcelsDelta(delta);
        await this.adapter.say(this.friendId, msg);
      }
      // If no changes, skip sending entirely
    }
  }

  /**
   * Send agents info to friend agent (rate-limited, diff-only with periodic full sync)
   * @param {Array} agents - array of agent objects (include self)
   */
  async sendAgents(agents) {
    if (!this.isReady()) return;
    if (!this._canSend('agents')) return;

    const forceFullSync = this._shouldFullSync('agents');

    if (forceFullSync) {
      this._lastFullSendTime.agents = Date.now();
      this._lastSentAgents = new Map();
      for (const a of agents) {
        this._lastSentAgents.set(a.id, { x: Math.round(a.x), y: Math.round(a.y) });
      }
      const msg = Msg.agents(agents);
      await this.adapter.say(this.friendId, msg);
    } else {
      const delta = this._computeAgentsDelta(agents);
      const hasChanges = delta.added.length > 0 || delta.updated.length > 0 || delta.removed.length > 0;
      if (hasChanges) {
        const msg = Msg.agentsDelta(delta);
        await this.adapter.say(this.friendId, msg);
      }
    }
  }

  /**
   * Send current intention to friend agent
   * @param {Array} predicate - intention predicate [action, x, y, id, score]
   */
  async sendIntention(predicate) {
    if (!this.isReady()) return;
    const msg = Msg.intention(predicate);
    await this.adapter.say(this.friendId, msg);
  }

  /**
   * Send collision protocol message
   * @param {string} type - 'COLLISION', 'MOVE', 'TAKE', 'DROP', 'END'
   */
  async sendCollision(type) {
    if (!this.isReady()) return;
    const msg = Msg.collision(type);
    await this.adapter.say(this.friendId, msg);
  }
}

export { Comm };
