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
import { grid } from '../utils/grid.js';

// Coordination protocol phases (renamed from MOVE/TAKE/DROP)
const PROTOCOL_YIELD = 'PROTOCOL_YIELD';   // Ask partner to step into a pocket
const PROTOCOL_RELEASE = 'PROTOCOL_RELEASE'; // Ask partner to drop parcels and retreat
const PROTOCOL_ACQUIRE = 'PROTOCOL_ACQUIRE'; // Ask partner to collect dropped parcels
const PROTOCOL_END = 'PROTOCOL_END';         // Coordination finished
const PROTOCOL_STUCK = 'PROTOCOL_STUCK';     // Cannot yield; signal failure

const DIR_TO_DELTA = {
  up: { dx: 0, dy: 1 },
  down: { dx: 0, dy: -1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 }
};

const INVERSE_DIR = { up: 'down', down: 'up', left: 'right', right: 'left' };

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

    // Coordination protocol runtime flag
    this._protocolActive = false;
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

    if (header === 'HANDOFF') {
      await this._handleHandoff(senderId, content);
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
   * Start the coordination protocol (initiator side)
   */
  async initiateHandoff() {
    return this.beginCoordinationProtocol();
  }

  /**
   * Entry point used by movement plans when a friend blocks the path
   */
  async beginCoordinationProtocol() {
    if (!this.isReady()) return false;
    if (this.me.isInHandoff && this.me.isInHandoff()) return true;

    this._protocolActive = true;
    (this.me.setCoordinationState || this.me.setHandoffState).call(this.me, true);

    // Stop current intention to avoid competing moves
    if (this.me.intentions?.length > 0) {
      this.me.intentions[0]?.stop?.();
      this.me.intentions = [];
    }

    commLogger.info('[PROTOCOL] Initiating corridor coordination with ' + this.friendId);

    const carrying = this.me.carried && this.me.carried > 0;

    if (!carrying) {
      commLogger.info('[PROTOCOL] I am empty, yielding locally');
      await this._handleYieldPhase();
      return true;
    }

    commLogger.info('[PROTOCOL] I am carrying, requesting partner to yield');
    await this._sendProtocol(PROTOCOL_YIELD);
    return true;
  }

  /**
   * Handle coordination messages (translated from ASAPlanners handleMsg MOVE/TAKE/DROP)
   */
  async _handleHandoff(senderId, payload) {
    if (!this.isReady()) return;
    const phase = payload?.phase || payload;
    if (!phase) return;

    // Keep deterministic friend binding
    if (!this.friendId) {
      this.friendId = senderId;
      this.me.friendId = senderId;
    }

    this._protocolActive = true;
    (this.me.setCoordinationState || this.me.setHandoffState).call(this.me, true);

    try {
      switch (phase) {
        case PROTOCOL_YIELD:
          await this._handleYieldPhase();
          break;
        case PROTOCOL_RELEASE:
          await this._handleReleasePhase();
          break;
        case PROTOCOL_ACQUIRE:
          await this._handleAcquirePhase();
          break;
        case PROTOCOL_STUCK:
          commLogger.warn('[PROTOCOL] Partner is stuck, resetting coordination');
          this._resetCoordination();
          break;
        case PROTOCOL_END:
          this._resetCoordination();
          break;
        default:
          commLogger.warn('[PROTOCOL] Unknown phase ' + phase);
          break;
      }
    } catch (err) {
      commLogger.error('[PROTOCOL] Error in phase ' + phase + ': ' + err.message);
      this._resetCoordination();
      await this._sendProtocol(PROTOCOL_END);
    }
  }

  async _handleYieldPhase() {
    const { x, y } = this._myPosition();
    const friend = this._friendAgent();
    const fx = friend ? Math.round(friend.x) : null;
    const fy = friend ? Math.round(friend.y) : null;

    const candidates = this._adjacentAccessible(x, y)
      .filter(c => !this._isOccupiedByAgent(c.x, c.y))
      .filter(c => !(friend && Math.round(c.x) === fx && Math.round(c.y) === fy));

    const target = candidates[0];

    if (target) {
      const dir = grid.getDirection(x, y, target.x, target.y);
      const ok = await this.adapter.move(dir);
      if (!ok) {
        commLogger.warn('[PROTOCOL] Yield move failed into ' + target.x + ',' + target.y + ' sending STUCK');
        await this._sendProtocol(PROTOCOL_STUCK);
        this._resetCoordination();
        return;
      }
      // After yielding, ask partner to release parcels
      await this._sendProtocol(PROTOCOL_RELEASE);
      return;
    }

    commLogger.warn('[PROTOCOL] No free adjacent cell to yield, sending STUCK');
    await this._sendProtocol(PROTOCOL_STUCK);
    this._resetCoordination();
  }

  async _handleAcquirePhase() {
    const { x, y } = this._myPosition();
    const parcelCell = this._findAdjacentParcelCell(x, y);

    if (!parcelCell) {
      commLogger.warn('[PROTOCOL] No adjacent parcel to acquire');
      this._resetCoordination();
      await this._sendProtocol(PROTOCOL_END);
      return;
    }

    const dir = grid.getDirection(x, y, parcelCell.x, parcelCell.y);
    await this.adapter.move(dir);
    const pickupResult = await this.adapter.pickup();

    // Stop any current intention and clear queue
    if (this.me.intentions?.length > 0) {
      this.me.intentions[0]?.stop?.();
      this.me.intentions = [];
    }

    const picked = Array.isArray(pickupResult) ? pickupResult.length : (pickupResult ? 1 : 0);
    this.me.carried = picked || this.me.carried;

    this._resetCoordination();
    await this._sendProtocol(PROTOCOL_END);
  }

  async _handleReleasePhase() {
    const { x, y } = this._myPosition();
    const friend = this._friendAgent();
    if (!friend) {
      commLogger.warn('[PROTOCOL] Friend not in belief, aborting release');
      this._resetCoordination();
      await this._sendProtocol(PROTOCOL_END);
      return;
    }

    const fx = Math.round(friend.x);
    const fy = Math.round(friend.y);
    const dirToFriend = grid.getDirection(x, y, fx, fy);

    const adjacent = this._adjacentAccessible(x, y)
      .filter(c => !this._isOccupiedByAgent(c.x, c.y))
      .filter(c => !(Math.round(c.x) === fx && Math.round(c.y) === fy));

    // Attempt 1: lateral pocket (not towards friend)
    const lateral = adjacent.find(c => grid.getDirection(x, y, c.x, c.y) !== dirToFriend);

    if (lateral) {
      const dir = grid.getDirection(x, y, lateral.x, lateral.y);
      const moved = await this.adapter.move(dir);
      if (moved) {
        await this.adapter.putdown();
        this.me.carried = 0;
        this.me.carriedReward = 0;
        const inverse = INVERSE_DIR[dir];
        if (inverse) {
          await this.adapter.move(inverse);
        }
        await this._sendProtocol(PROTOCOL_ACQUIRE);
        return;
      }
      commLogger.warn('[PROTOCOL] Lateral release move failed, trying fallback');
    }

    // Attempt 2: forward toward friend (corridor fallback)
    if (dirToFriend) {
      const forward = this._adjacentAccessible(x, y)
        .find(c => grid.getDirection(x, y, c.x, c.y) === dirToFriend && !this._isOccupiedByAgent(c.x, c.y));

      if (forward) {
        const moved = await this.adapter.move(dirToFriend);
        if (moved) {
          await this.adapter.putdown();
          this.me.carried = 0;
          this.me.carriedReward = 0;
          const inverse = INVERSE_DIR[dirToFriend];
          if (inverse) {
            await this.adapter.move(inverse);
          }
          await this._sendProtocol(PROTOCOL_ACQUIRE);
          return;
        }
      }
    }

    commLogger.warn('[PROTOCOL] Release failed: no viable move, sending STUCK');
    await this._sendProtocol(PROTOCOL_STUCK);
    this._resetCoordination();
  }

  _adjacentAccessible(x, y) {
    const cells = [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 }
    ];
    return cells.filter(c => grid.isAccessible(c.x, c.y));
  }

  _isOccupiedByAgent(x, y) {
    const agents = this.belief.getAgentsArray ? this.belief.getAgentsArray() : [];
    return agents.some(a => Math.round(a.x) === Math.round(x) && Math.round(a.y) === Math.round(y));
  }

  _findPocket(x, y) {
    return this._adjacentAccessible(x, y).find(c => !this._isOccupiedByAgent(c.x, c.y));
  }

  _findPocketTowardsFriend(x, y, friend) {
    const fx = Math.round(friend.x);
    const fy = Math.round(friend.y);
    const currentDist = grid.manhattanDistance(x, y, fx, fy);
    return this._adjacentAccessible(x, y).find(c => !this._isOccupiedByAgent(c.x, c.y) && grid.manhattanDistance(c.x, c.y, fx, fy) < currentDist);
  }

  _findAdjacentParcelCell(x, y) {
    const parcels = this.belief.getParcelsArray ? this.belief.getParcelsArray() : [];
    const adjacent = this._adjacentAccessible(x, y);
    return adjacent.find(cell => parcels.some(p => Math.round(p.x) === cell.x && Math.round(p.y) === cell.y && !p.carriedBy) && !this._isOccupiedByAgent(cell.x, cell.y));
  }

  _myPosition() {
    return { x: Math.round(this.me.x), y: Math.round(this.me.y) };
  }

  _friendAgent() {
    if (!this.friendId || !this.belief.getAgent) return null;
    return this.belief.getAgent(this.friendId);
  }

  _resetCoordination() {
    this._protocolActive = false;
    (this.me.setCoordinationState || this.me.setHandoffState).call(this.me, false);
  }

  async _sendProtocol(phase) {
    if (!this.isReady()) return;
    const msg = Msg.handoff(phase, null);
    await this.adapter.say(this.friendId, msg);
    commLogger.info('[PROTOCOL] Sent ' + phase + ' to ' + this.friendId);
  }

  /**
   * Compatibility shim for legacy callers
   */
  async sendHandoff(phase) {
    if (!this.isReady()) return;
    if (phase === 'START') return this._sendProtocol(PROTOCOL_YIELD);
    if (phase === 'DROPPED') return this._sendProtocol(PROTOCOL_RELEASE);
    if (phase === 'RETREATED') return this._sendProtocol(PROTOCOL_RELEASE);
    if (phase === 'DONE') return this._sendProtocol(PROTOCOL_END);
    if (phase === 'ACK_START') return; // no-op in new protocol
    return this._sendProtocol(phase);
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
