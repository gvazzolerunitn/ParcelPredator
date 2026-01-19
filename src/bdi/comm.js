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
    
    // Pending requests tracking (parcelId -> {resolve, reject, timer})
    this._pendingRequests = new Map();
    this._requestTimeout = 5000; // 5s default timeout
    
    // Handoff tracking (for ACK/retry)
    this._handoffPending = null; // { resolve, reject, timer, attempt }
    this._handoffTimeout = 3000; // 3s per attempt
    this._handoffMaxAttempts = 2; // Max retry attempts
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
    
    // Register internal REQUEST handler
    this.on('REQUEST', (senderId, content) => this._handleRequest(senderId, content));
    
    // Register internal AGREE/REFUSE handlers for pending requests
    this.on('AGREE', (senderId, parcelId) => this._handleAgree(senderId, parcelId));
    this.on('REFUSE', (senderId, data) => this._handleRefuse(senderId, data));
    
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
   * Handle incoming REQUEST messages (FIPA protocol)
   */
  async _handleRequest(senderId, parcelData) {
    if (!this.isReady() || senderId !== this.friendId) {
      commLogger.warn('Ignoring REQUEST from non-friend or before handshake');
      return;
    }

    // Defensive validation: check parcel data structure
    if (!parcelData || typeof parcelData !== 'object') {
      commLogger.warn('Invalid REQUEST: missing or invalid parcel data');
      await this.adapter.say(senderId, Msg.refuse(parcelData?.id, 'invalid_data'));
      return;
    }

    const { id, x, y, reward } = parcelData;
    
    // Validate required fields
    if (id === undefined || x === undefined || y === undefined) {
      commLogger.warn('Invalid REQUEST: missing required fields (id, x, y)');
      await this.adapter.say(senderId, Msg.refuse(id, 'missing_fields'));
      return;
    }

    // Check if coordinates are valid numbers
    const px = Math.round(x);
    const py = Math.round(y);
    if (isNaN(px) || isNaN(py)) {
      commLogger.warn('Invalid REQUEST: invalid coordinates');
      await this.adapter.say(senderId, Msg.refuse(id, 'invalid_coords'));
      return;
    }

    // Check capacity
    const capacity = this.me.capacity || 4;
    const carried = this.me.carried || 0;
    
    if (carried >= capacity) {
      commLogger.info('REFUSE REQUEST ' + id + ': capacity full (' + carried + '/' + capacity + ')');
      await this.adapter.say(senderId, Msg.refuse(id, 'capacity_full'));
      return;
    }

    // Check if not too many intentions queued (max 2)
    const intentionCount = this.me.intentions?.length || 0;
    if (intentionCount >= 2) {
      commLogger.info('REFUSE REQUEST ' + id + ': too busy (' + intentionCount + ' intentions)');
      await this.adapter.say(senderId, Msg.refuse(id, 'too_busy'));
      return;
    }

    // ACCEPT: Send AGREE and add intention
    commLogger.info('AGREE REQUEST ' + id + ' at (' + px + ',' + py + ') reward=' + (reward || '?'));
    
    try {
      // Send AGREE response
      await this.adapter.say(senderId, Msg.agree(id));
      
      // Add go_pick_up intention to my queue
      // Format: ['go_pick_up', x, y, parcelId, score]
      const score = reward || 1; // Use reward as approximate score
      const intention = ['go_pick_up', px, py, id, score];
      
      // Push intention to agent's queue (replace=false to not interrupt current intention)
      if (this.me.push && typeof this.me.push === 'function') {
        this.me.push(intention, false); // Queue without interrupting
        commLogger.info('Added intention: go_pick_up ' + id);
      } else {
        commLogger.warn('Cannot add intention: me.push not available');
      }
    } catch (err) {
      commLogger.error('Error handling REQUEST:', err);
      // Try to send REFUSE as fallback
      await this.adapter.say(senderId, Msg.refuse(id, 'internal_error')).catch(() => {});
    }
  }

  /**
   * Check if communication is ready
   */
  isReady() {
    return this.handshakeCompleted && this.friendId !== null;
  }

  /**
   * Handle AGREE response
   */
  _handleAgree(senderId, parcelId) {
    if (senderId !== this.friendId) return;
    
    const pending = this._pendingRequests.get(parcelId);
    if (pending) {
      clearTimeout(pending.timer);
      this._pendingRequests.delete(parcelId);
      commLogger.info('Received AGREE for parcel ' + parcelId);
      pending.resolve({ accepted: true, parcelId });
    }
  }

  /**
   * Handle REFUSE response
   */
  _handleRefuse(senderId, data) {
    if (senderId !== this.friendId) return;
    
    const { requestId, reason } = data;
    const pending = this._pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this._pendingRequests.delete(requestId);
      commLogger.info('Received REFUSE for parcel ' + requestId + ' reason: ' + reason);
      pending.resolve({ accepted: false, parcelId: requestId, reason });
    }
  }

  /**
   * Send REQUEST and wait for AGREE/REFUSE response (Promise-based)
   * @param {Object} parcel - Parcel to request
   * @param {Number} timeout - Timeout in ms (default: 5000)
   * @returns {Promise<{accepted: boolean, parcelId: string, reason?: string}>}
   */
  async sendRequest(parcel, timeout = this._requestTimeout) {
    if (!this.isReady()) {
      return Promise.reject(new Error('Communication not ready'));
    }

    const parcelId = parcel.id;
    
    // Check if already pending
    if (this._pendingRequests.has(parcelId)) {
      commLogger.warn('Request already pending for parcel ' + parcelId);
      return Promise.reject(new Error('Request already pending'));
    }

    return new Promise((resolve, reject) => {
      // Setup timeout
      const timer = setTimeout(() => {
        this._pendingRequests.delete(parcelId);
        commLogger.warn('Request timeout for parcel ' + parcelId);
        resolve({ accepted: false, parcelId, reason: 'timeout' });
      }, timeout);

      // Store pending request
      this._pendingRequests.set(parcelId, { resolve, reject, timer });

      // Send REQUEST message
      const requestMsg = Msg.request(parcel);
      this.adapter.say(this.friendId, requestMsg).catch(err => {
        clearTimeout(timer);
        this._pendingRequests.delete(parcelId);
        commLogger.error('Failed to send REQUEST:', err);
        reject(err);
      });

      commLogger.info('Sent REQUEST for parcel ' + parcelId);
    });
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

  /**
   * Initiate handoff protocol with ACK and retry (called when deadlock detected)
   */
  async initiateHandoff(escapeCell) {
    if (!this.isReady()) return false;
    
    // Set local handoff state
    this.me.setHandoffState(true);
    
    // Stop current intention
    if (this.me.intentions?.length > 0) {
      this.me.intentions[0]?.stop?.();
      this.me.intentions = [];
    }
    
    commLogger.info('[HANDOFF] Initiating protocol with retry -> sending START to ' + this.friendId);
    
    // Try up to maxAttempts to get ACK
    for (let attempt = 1; attempt <= this._handoffMaxAttempts; attempt++) {
      try {
        const ackReceived = await this._sendHandoffStartWithAck(escapeCell, attempt);
        if (ackReceived) {
          commLogger.info('[HANDOFF] START acknowledged by partner on attempt ' + attempt);
          return true;
        }
      } catch (err) {
        commLogger.warn('[HANDOFF] START attempt ' + attempt + ' failed: ' + err.message);
      }
      
      // Wait a bit before retry
      if (attempt < this._handoffMaxAttempts) {
        await new Promise(res => setTimeout(res, 500));
      }
    }
    
    commLogger.error('[HANDOFF] Failed to initiate after ' + this._handoffMaxAttempts + ' attempts - ABORTING');
    this.me.setHandoffState(false);
    return false;
  }
  
  /**
   * Send START and wait for ACK
   */
  async _sendHandoffStartWithAck(escapeCell, attempt) {
    return new Promise((resolve, reject) => {
      // Setup timeout
      const timer = setTimeout(() => {
        this._handoffPending = null;
        commLogger.warn('[HANDOFF] Timeout waiting for ACK_START (attempt ' + attempt + ')');
        resolve(false); // Timeout = no ACK
      }, this._handoffTimeout);
      
      // Store pending
      this._handoffPending = { resolve, reject, timer, attempt };
      
      // Send START
      const msg = Msg.handoff('START', escapeCell);
      this.adapter.say(this.friendId, msg).catch(err => {
        clearTimeout(timer);
        this._handoffPending = null;
        reject(err);
      });
      
      commLogger.info('[HANDOFF] START sent (attempt ' + attempt + '), waiting for ACK...');
    });
  }
  
  /**
   * Handle ACK_START (called by message handler)
   */
  _handleHandoffAck() {
    if (this._handoffPending) {
      clearTimeout(this._handoffPending.timer);
      const pending = this._handoffPending;
      this._handoffPending = null;
      pending.resolve(true); // ACK received
    }
  }

  /**
   * Send handoff protocol message
   */
  async sendHandoff(phase, escapeCell) {
    if (!this.isReady()) return;
    commLogger.info('Sending HANDOFF ' + phase + ' to ' + this.friendId + ' data=' + JSON.stringify(escapeCell));
    const msg = Msg.handoff(phase, escapeCell);
    await this.adapter.say(this.friendId, msg);
    commLogger.info('HANDOFF ' + phase + ' sent');
  }

  /**
   * Send completion notification after successful pickup
   */
  async sendComplete(parcelId, success = true) {
    if (!this.isReady()) return;
    const msg = Msg.complete(parcelId, success);
    await this.adapter.say(this.friendId, msg);
    commLogger.info('Sent COMPLETE for parcel ' + parcelId + ' success=' + success);
  }
}

export { Comm };
