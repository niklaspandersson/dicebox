/**
 * MessageRouter - Routes P2P messages to appropriate handlers
 */
import { webrtcManager } from './webrtc-manager.js';

// Message types for P2P communication
export const MSG = {
  // Host -> Peer
  WELCOME: 'welcome',           // Initial state sync when peer joins
  PEER_JOINED: 'peer-joined',   // Notify all peers of new peer
  PEER_LEFT: 'peer-left',       // Notify all peers of departed peer
  DICE_ROLL: 'dice-roll',       // Broadcast dice roll
  DICE_CONFIG: 'dice-config',   // Broadcast dice configuration change
  DICE_HELD: 'dice-held',       // Broadcast that someone grabbed the dice
  HOST_LEAVING: 'host-leaving', // Host is leaving, includes migration info

  // Peer -> Host
  INTRODUCE: 'introduce',       // Peer sends username to host
  ROLL_DICE: 'roll-dice',       // Peer requests dice roll broadcast
  GRAB_DICE: 'grab-dice',       // Peer wants to hold the dice
  DROP_DICE: 'drop-dice',       // Host forces holder to drop dice
};

export class MessageRouter extends EventTarget {
  constructor() {
    super();
    this.handlers = {
      host: new Map(),
      client: new Map(),
      all: new Map()
    };
  }

  /**
   * Register a handler for messages to host
   */
  onHostMessage(type, handler) {
    this.handlers.host.set(type, handler);
    return this;
  }

  /**
   * Register a handler for messages from host (to clients)
   */
  onClientMessage(type, handler) {
    this.handlers.client.set(type, handler);
    return this;
  }

  /**
   * Register a handler for messages to all peers
   */
  onMessage(type, handler) {
    this.handlers.all.set(type, handler);
    return this;
  }

  /**
   * Route an incoming message to the appropriate handler
   */
  route(fromPeerId, message, isHost) {
    console.log(`Message from ${fromPeerId}:`, message.type);

    // First check message-type-specific handlers
    if (isHost && this.handlers.host.has(message.type)) {
      this.handlers.host.get(message.type)(fromPeerId, message);
      return;
    }

    if (!isHost && this.handlers.client.has(message.type)) {
      this.handlers.client.get(message.type)(fromPeerId, message);
      return;
    }

    // Check handlers for all peers
    if (this.handlers.all.has(message.type)) {
      this.handlers.all.get(message.type)(fromPeerId, message);
      return;
    }

    console.log('Unknown or unhandled message type:', message.type);
  }

  /**
   * Send a message to a specific peer
   */
  sendToPeer(peerId, message) {
    webrtcManager.sendToPeer(peerId, message);
  }

  /**
   * Send a message to the host
   */
  sendToHost(hostPeerId, message) {
    if (hostPeerId) {
      webrtcManager.sendToPeer(hostPeerId, message);
    }
  }

  /**
   * Clear all handlers
   */
  clearHandlers() {
    this.handlers.host.clear();
    this.handlers.client.clear();
    this.handlers.all.clear();
  }
}
