/**
 * comm.js - Communication Module for Multi-Agent Coordination
 * 
 * Handles:
 * - Handshake protocol to establish friendId
 * - Sending/receiving belief updates (parcels, agents)
 * - Sending/receiving intention claims
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
    
    // Simple rate limiting
    this._lastSendTime = { parcels: 0, agents: 0 };
    this._minSendInterval = 200; // 5 messages/sec max
  }

  /**
   * Check if we can send a message (rate limiting)
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
   * Initialize communication
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
   */
  on(header, handler) {
    if (!this._handlers.has(header)) {
      this._handlers.set(header, []);
    }
    this._handlers.get(header).push(handler);
  }

  /**
   * Internal message handler
   */
  async _handleMessage(senderId, senderName, msg, replyCallback) {
    if (!msg || !msg.header) {
      commLogger.warn('Received invalid message:', msg);
      return;
    }

    let { header, content } = msg;
    
    // Filter out our own id from agent lists
    if (header === 'INFO_AGENTS' && Array.isArray(content) && this.me) {
      content = content.filter(a => a && a.id !== this.me.id);
    }
    
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
        console.error('[COMM] Handler error:', err);
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
      commLogger.info('Received handshake request from ' + senderId);
      this.friendId = senderId;
      this.me.friendId = senderId;
      
      const ackMsg = Msg.handshake('ack');
      await this.adapter.say(senderId, ackMsg);
      
      this.handshakeCompleted = true;
      commLogger.info('Handshake completed with ' + senderId);
    } 
    else if (phase === 'ack' && this.isSecondAgent) {
      // Agent 2 receives ack from Agent 1
      this.friendId = senderId;
      this.me.friendId = senderId;
      this.handshakeCompleted = true;
      commLogger.info('Handshake completed with ' + senderId);
    }
  }

  /**
   * Check if communication is ready
   */
  isReady() {
    return this.handshakeCompleted && this.friendId !== null;
  }

  // =========================================================================
  // SENDING METHODS
  // =========================================================================

  /**
   * Send parcels info to friend agent
   */
  async sendParcels(parcels) {
    if (!this.isReady()) return;
    if (!this._canSend('parcels')) return;
    
    const msg = Msg.parcels(parcels);
    await this.adapter.say(this.friendId, msg);
  }

  /**
   * Send agents info to friend agent
   */
  async sendAgents(agents) {
    if (!this.isReady()) return;
    if (!this._canSend('agents')) return;
    
    const msg = Msg.agents(agents);
    await this.adapter.say(this.friendId, msg);
  }

  /**
   * Send current intention to friend agent
   */
  async sendIntention(predicate) {
    if (!this.isReady()) return;
    const msg = Msg.intention(predicate);
    await this.adapter.say(this.friendId, msg);
  }
}

export { Comm };
