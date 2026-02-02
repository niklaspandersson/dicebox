/**
 * MessageRouter - Routes P2P messages to appropriate handlers
 * Mesh topology: all peers are equal, no host/client distinction
 */
import { webrtcManager } from "./webrtc-manager.js";

// Message types for P2P communication (mesh topology)
export const MSG = {
  // Peer discovery & sync
  HELLO: "hello", // New peer announces itself with username
  WELCOME: "welcome", // Existing peer responds with current state
  REQUEST_STATE: "request-state", // Peer requests state snapshot

  // Peer lifecycle (broadcast to all)
  PEER_JOINED: "peer-joined", // Notify all peers of new peer
  PEER_LEFT: "peer-left", // Notify all peers of departed peer

  // Dice actions (broadcast to all)
  DICE_ROLL: "dice-roll", // Broadcast dice roll result
  DICE_GRAB: "dice-grab", // Peer grabbed a dice set
  DICE_DROP: "dice-drop", // Peer dropped a dice set
  DICE_LOCK: "dice-lock", // Peer locked/unlocked a die
};

export class MessageRouter extends EventTarget {
  constructor() {
    super();
    this.handlers = new Map();
  }

  /**
   * Register a handler for a message type
   */
  onMessage(type, handler) {
    this.handlers.set(type, handler);
    return this;
  }

  /**
   * Route an incoming message to the appropriate handler
   */
  route(fromPeerId, message) {
    console.log(`Message from ${fromPeerId}:`, message.type);

    if (this.handlers.has(message.type)) {
      this.handlers.get(message.type)(fromPeerId, message);
      return;
    }

    console.log("Unknown or unhandled message type:", message.type);
  }

  /**
   * Send a message to a specific peer
   */
  sendToPeer(peerId, message) {
    webrtcManager.sendToPeer(peerId, message);
  }

  /**
   * Broadcast a message to all connected peers
   */
  broadcast(message, excludePeerId = null) {
    webrtcManager.broadcast(message, excludePeerId);
  }
}
