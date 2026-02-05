/**
 * NetworkAdapter - Wraps the existing webrtcManager to provide a clean interface.
 *
 * This adapter allows the new architecture to work with the existing network
 * layer without requiring immediate refactoring of the WebRTC code.
 *
 * @example
 * // Create adapter wrapping legacy network
 * const network = new NetworkAdapter(webrtcManager, messageRouter);
 *
 * // Use clean interface
 * network.broadcast('dice:roll', { values: [1, 2, 3] });
 * network.onMessage('dice:roll', (payload, context) => { ... });
 */
export class NetworkAdapter {
  #webrtcManager = null;
  #messageRouter = null;
  #handlers = new Map();
  #middlewares = [];

  /**
   * Create a NetworkAdapter.
   *
   * @param {object} webrtcManager - Legacy WebRTC manager instance
   * @param {object} messageRouter - Legacy message router instance (optional)
   */
  constructor(webrtcManager, messageRouter = null) {
    this.#webrtcManager = webrtcManager;
    this.#messageRouter = messageRouter;

    // If we have a webrtcManager, listen for messages
    if (webrtcManager) {
      this.#setupMessageListener();
    }
  }

  #setupMessageListener() {
    // Listen for messages from webrtcManager
    this.#webrtcManager.addEventListener("message", (e) => {
      const { peerId, message } = e.detail;
      this.#handleIncomingMessage(peerId, message);
    });
  }

  #handleIncomingMessage(fromPeerId, message) {
    // Convert legacy message format to new format
    const type = this.#legacyTypeToNewType(message.type);
    const payload = { ...message };
    delete payload.type;

    // Run through middlewares
    let processedMessage = { type, payload };
    for (const middleware of this.#middlewares) {
      processedMessage = middleware(processedMessage, { fromPeerId });
      if (!processedMessage) return;
    }

    // Call registered handlers
    const handlers = this.#handlers.get(processedMessage.type);
    if (handlers) {
      for (const handler of handlers) {
        handler(processedMessage.payload, { fromPeerId });
      }
    }
  }

  /**
   * Map legacy message types to new namespaced types.
   * @param {string} legacyType - Legacy message type (e.g., 'dice-roll')
   * @returns {string} New message type (e.g., 'dice:roll')
   */
  #legacyTypeToNewType(legacyType) {
    const mappings = {
      "dice-roll": "dice:roll",
      hello: "peer:hello",
      welcome: "peer:welcome",
      "request-state": "peer:request-state",
      "peer-joined": "peer:joined",
      "peer-left": "peer:left",
    };
    return mappings[legacyType] || legacyType;
  }

  /**
   * Map new message types to legacy message types.
   * @param {string} newType - New message type (e.g., 'dice:roll')
   * @returns {string} Legacy message type (e.g., 'dice-roll')
   */
  #newTypeToLegacyType(newType) {
    const mappings = {
      "dice:roll": "dice-roll",
      "peer:hello": "hello",
      "peer:welcome": "welcome",
      "peer:request-state": "request-state",
      "peer:joined": "peer-joined",
      "peer:left": "peer-left",
    };
    return mappings[newType] || newType;
  }

  /**
   * Broadcast a message to all connected peers.
   *
   * @param {string} type - Message type (e.g., 'dice:roll')
   * @param {object} payload - Message payload
   * @param {string} excludePeerId - Optional peer ID to exclude
   */
  broadcast(type, payload, excludePeerId = null) {
    const legacyType = this.#newTypeToLegacyType(type);
    const message = { type: legacyType, ...payload };

    if (this.#webrtcManager) {
      this.#webrtcManager.broadcast(message, excludePeerId);
    }
  }

  /**
   * Send a message to a specific peer.
   *
   * @param {string} peerId - Target peer ID
   * @param {string} type - Message type
   * @param {object} payload - Message payload
   */
  send(peerId, type, payload) {
    const legacyType = this.#newTypeToLegacyType(type);
    const message = { type: legacyType, ...payload };

    if (this.#webrtcManager) {
      this.#webrtcManager.sendToPeer(peerId, message);
    }
  }

  /**
   * Register a handler for a message type.
   *
   * @param {string} type - Message type to handle
   * @param {function} handler - Handler function (payload, context) => void
   * @returns {function} Unsubscribe function
   */
  onMessage(type, handler) {
    if (!this.#handlers.has(type)) {
      this.#handlers.set(type, new Set());
    }
    this.#handlers.get(type).add(handler);

    return () => {
      const handlers = this.#handlers.get(type);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.#handlers.delete(type);
        }
      }
    };
  }

  /**
   * Add middleware for processing messages.
   *
   * @param {function} middleware - (message, context) => message | null
   */
  use(middleware) {
    this.#middlewares.push(middleware);
  }

  /**
   * Check if connected to the network.
   *
   * @returns {boolean}
   */
  isConnected() {
    // For legacy integration, check if webrtcManager has connections
    if (
      this.#webrtcManager &&
      typeof this.#webrtcManager.getConnectedPeers === "function"
    ) {
      return this.#webrtcManager.getConnectedPeers().length > 0;
    }
    return false;
  }

  /**
   * Get list of connected peer IDs.
   *
   * @returns {string[]}
   */
  getConnectedPeers() {
    if (
      this.#webrtcManager &&
      typeof this.#webrtcManager.getConnectedPeers === "function"
    ) {
      return this.#webrtcManager.getConnectedPeers();
    }
    return [];
  }

  /**
   * Clear all handlers and middlewares.
   */
  clear() {
    this.#handlers.clear();
    this.#middlewares = [];
  }
}

/**
 * Create a mock network adapter for testing or standalone demos.
 * Logs messages instead of sending them over the network.
 *
 * @param {object} options - Options
 * @param {function} options.onBroadcast - Callback for broadcast messages
 * @returns {NetworkAdapter}
 */
export function createMockNetwork(options = {}) {
  const adapter = {
    broadcast(type, payload) {
      if (options.onBroadcast) {
        options.onBroadcast(type, payload);
      } else {
        console.log(`[MockNetwork] broadcast: ${type}`, payload);
      }
    },
    send(peerId, type, payload) {
      console.log(`[MockNetwork] send to ${peerId}: ${type}`, payload);
    },
    onMessage() {
      return () => {};
    },
    use() {},
    isConnected() {
      return true;
    },
    getConnectedPeers() {
      return [];
    },
    clear() {},
  };
  return adapter;
}
