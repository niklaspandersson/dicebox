/**
 * Centralized message bus for routing messages between components.
 *
 * Features:
 * - Type-based message routing
 * - Middleware support (logging, validation, etc.)
 * - Async handler support
 * - Unsubscribe capability
 *
 * @example
 * const bus = new MessageBus();
 *
 * // Subscribe to messages
 * const unsubscribe = bus.on('dice:roll', (payload, context) => {
 *   console.log('Roll received:', payload);
 * });
 *
 * // Add middleware
 * bus.use(async (message, context) => {
 *   console.log('Message:', message.type);
 *   return message; // Return message to continue, or null to halt
 * });
 *
 * // Dispatch message
 * await bus.dispatch({ type: 'dice:roll', payload: { values: [1,2,3] } });
 *
 * // Unsubscribe
 * unsubscribe();
 */
export class MessageBus {
  #handlers = new Map();
  #middlewares = [];

  /**
   * Register a handler for a message type.
   *
   * @param {string} type - Message type to handle
   * @param {function} handler - Handler function (payload, context) => void
   * @returns {function} Unsubscribe function
   */
  on(type, handler) {
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
   * Register a one-time handler that automatically unsubscribes after first call.
   *
   * @param {string} type - Message type to handle
   * @param {function} handler - Handler function
   * @returns {function} Unsubscribe function
   */
  once(type, handler) {
    const unsubscribe = this.on(type, (payload, context) => {
      unsubscribe();
      handler(payload, context);
    });
    return unsubscribe;
  }

  /**
   * Add middleware that processes all messages.
   * Middlewares are called in order before handlers.
   * Middleware can modify messages or halt dispatch by returning null.
   *
   * @param {function} middleware - (message, context) => message | null
   */
  use(middleware) {
    this.#middlewares.push(middleware);
  }

  /**
   * Dispatch a message to all registered handlers.
   *
   * @param {object} message - Message with type and payload
   * @param {string} message.type - Message type
   * @param {*} message.payload - Message payload
   * @param {object} context - Optional context (e.g., { fromPeerId })
   * @returns {Promise<void>}
   */
  async dispatch(message, context = {}) {
    // Run through middlewares
    let processedMessage = message;
    for (const middleware of this.#middlewares) {
      processedMessage = await middleware(processedMessage, context);
      if (!processedMessage) {
        return; // Middleware halted dispatch
      }
    }

    // Get handlers for this message type
    const handlers = this.#handlers.get(processedMessage.type);
    if (!handlers || handlers.size === 0) {
      return;
    }

    // Call all handlers (in parallel)
    const promises = [...handlers].map((handler) =>
      Promise.resolve(handler(processedMessage.payload, context))
    );
    await Promise.all(promises);
  }

  /**
   * Check if there are any handlers for a message type.
   *
   * @param {string} type - Message type
   * @returns {boolean}
   */
  hasHandlers(type) {
    const handlers = this.#handlers.get(type);
    return handlers ? handlers.size > 0 : false;
  }

  /**
   * Get count of handlers for a message type.
   *
   * @param {string} type - Message type
   * @returns {number}
   */
  handlerCount(type) {
    const handlers = this.#handlers.get(type);
    return handlers ? handlers.size : 0;
  }

  /**
   * Remove all handlers for a message type.
   *
   * @param {string} type - Message type
   */
  off(type) {
    this.#handlers.delete(type);
  }

  /**
   * Remove all handlers and middlewares.
   */
  clear() {
    this.#handlers.clear();
    this.#middlewares = [];
  }
}
