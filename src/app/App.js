import { Container } from './Container.js';
import { DiceStore } from '../features/dice-rolling/state/DiceStore.js';
import { createStrategy, getAvailableStrategies, DEFAULT_STRATEGY } from '../features/dice-rolling/strategies/index.js';
import { MessageBus } from '../infrastructure/messaging/MessageBus.js';
import { DiceAnimationService } from '../features/dice-rolling/services/DiceAnimationService.js';
import { NetworkAdapter } from '../infrastructure/network/NetworkAdapter.js';
import { LegacyBridge } from '../infrastructure/network/LegacyBridge.js';

// Import UI components to register them
import '../ui/containers/DiceRollerContainer.js';
import '../ui/components/dice/Die.js';

/**
 * Main application class.
 *
 * Responsibilities:
 * - Initialize and wire up all modules via dependency injection
 * - Provide access to core services
 * - Handle strategy switching
 *
 * This is intentionally thin - business logic lives in strategies and services.
 */
export class App {
  #container;
  #currentStrategyId;
  #currentStrategy;
  #rollerContainer;
  #legacyBridge;
  #networkAdapter;

  constructor() {
    this.#container = new Container();
    this.#currentStrategyId = null;
    this.#currentStrategy = null;
    this.#rollerContainer = null;
    this.#legacyBridge = null;
    this.#networkAdapter = null;
  }

  /**
   * Initialize the application.
   *
   * @param {object} options
   * @param {object} options.diceConfig - Dice configuration
   * @param {object} options.localPlayer - Local player { id, username }
   * @param {object} options.network - Network service (or mock)
   * @param {string} options.strategyId - Initial strategy ID
   */
  init(options) {
    const {
      diceConfig,
      localPlayer,
      network,
      strategyId = DEFAULT_STRATEGY,
    } = options;

    // Register core services
    this.#container.registerInstance('localPlayer', localPlayer);
    this.#container.registerInstance('network', network);

    // Create and configure dice store
    const diceStore = new DiceStore();
    diceStore.setConfig(diceConfig);
    this.#container.registerInstance('diceStore', diceStore);

    // Create message bus
    const messageBus = new MessageBus();
    this.#container.registerInstance('messageBus', messageBus);

    // Create animation service
    const animationService = new DiceAnimationService();
    this.#container.registerInstance('animationService', animationService);

    // Set initial strategy
    this.setStrategy(strategyId);

    return this;
  }

  /**
   * Mount the dice roller UI to a container element.
   *
   * @param {HTMLElement|string} container - Element or selector
   */
  mount(container) {
    const el = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    if (!el) {
      throw new Error(`Mount container not found: ${container}`);
    }

    // Create roller container if not exists
    this.#rollerContainer = document.createElement('dice-roller-container');
    el.appendChild(this.#rollerContainer);

    // Mount current strategy
    if (this.#currentStrategy) {
      this.#rollerContainer.setStrategy(this.#currentStrategy);
    }

    return this;
  }

  /**
   * Switch to a different strategy.
   *
   * @param {string} strategyId - Strategy identifier
   */
  setStrategy(strategyId) {
    if (strategyId === this.#currentStrategyId) {
      return this;
    }

    // Create strategy context
    const context = {
      state: this.#container.get('diceStore'),
      network: this.#container.get('network'),
      localPlayer: this.#container.get('localPlayer'),
      animationService: this.#container.get('animationService'),
    };

    // Create new strategy
    this.#currentStrategy = createStrategy(strategyId, context);
    this.#currentStrategyId = strategyId;

    // Update UI if mounted
    if (this.#rollerContainer) {
      this.#rollerContainer.setStrategy(this.#currentStrategy);
    }

    return this;
  }

  /**
   * Get the current strategy ID.
   * @returns {string}
   */
  get currentStrategyId() {
    return this.#currentStrategyId;
  }

  /**
   * Get the current strategy instance.
   * @returns {DiceRollingStrategy}
   */
  get strategy() {
    return this.#currentStrategy;
  }

  /**
   * Get the DI container.
   * @returns {Container}
   */
  get container() {
    return this.#container;
  }

  /**
   * Get the dice store.
   * @returns {DiceStore}
   */
  get diceStore() {
    return this.#container.get('diceStore');
  }

  /**
   * Get the message bus.
   * @returns {MessageBus}
   */
  get messageBus() {
    return this.#container.get('messageBus');
  }

  /**
   * Get available strategies for UI.
   * @returns {Array<{id: string, name: string, description: string}>}
   */
  getAvailableStrategies() {
    return getAvailableStrategies();
  }

  /**
   * Handle incoming network message.
   * Delegates to current strategy.
   *
   * @param {string} type - Message type
   * @param {object} payload - Message data
   * @param {string} fromPeerId - Sender's peer ID
   */
  handleMessage(type, payload, fromPeerId) {
    this.#currentStrategy?.handleMessage(type, payload, fromPeerId);
  }

  /**
   * Get current state for syncing to new peers.
   * @returns {object}
   */
  getState() {
    return {
      strategyId: this.#currentStrategyId,
      strategyState: this.#currentStrategy?.getState(),
    };
  }

  /**
   * Load state from a peer.
   * @param {object} state
   */
  loadState(state) {
    if (state.strategyId && state.strategyId !== this.#currentStrategyId) {
      this.setStrategy(state.strategyId);
    }
    if (state.strategyState) {
      this.#currentStrategy?.loadState(state.strategyState);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // LEGACY INTEGRATION
  // ─────────────────────────────────────────────────────────────

  /**
   * Connect to the legacy network layer.
   * Creates a NetworkAdapter wrapping the existing webrtcManager.
   *
   * @param {object} webrtcManager - Legacy WebRTC manager instance
   * @param {object} messageRouter - Legacy message router instance (optional)
   * @returns {App} this for chaining
   */
  connectToLegacyNetwork(webrtcManager, messageRouter = null) {
    this.#networkAdapter = new NetworkAdapter(webrtcManager, messageRouter);
    this.#container.registerInstance('network', this.#networkAdapter);

    // Re-create strategy with new network
    if (this.#currentStrategyId) {
      this.setStrategy(this.#currentStrategyId);
    }

    return this;
  }

  /**
   * Create a bridge to sync with legacy MeshState.
   *
   * @param {MeshState} meshState - Legacy mesh state instance
   * @param {object} options - Bridge options
   * @param {boolean} options.syncFromLegacy - Initial sync from legacy (default: true)
   * @param {boolean} options.enableTwoWaySync - Enable continuous sync (default: false)
   * @returns {App} this for chaining
   */
  bridgeToLegacyState(meshState, options = {}) {
    const { syncFromLegacy = true, enableTwoWaySync = false } = options;

    this.#legacyBridge = new LegacyBridge(meshState, this.diceStore);

    if (syncFromLegacy) {
      this.#legacyBridge.syncFromLegacy();
    }

    if (enableTwoWaySync) {
      this.#legacyBridge.enableTwoWaySync();
    }

    return this;
  }

  /**
   * Get the legacy bridge instance.
   * @returns {LegacyBridge|null}
   */
  get legacyBridge() {
    return this.#legacyBridge;
  }

  /**
   * Get the network adapter instance.
   * @returns {NetworkAdapter|null}
   */
  get networkAdapter() {
    return this.#networkAdapter;
  }

  /**
   * Setup message handlers to route legacy messages to the current strategy.
   * Call this after connecting to legacy network.
   *
   * @returns {App} this for chaining
   */
  setupLegacyMessageHandling() {
    if (!this.#networkAdapter) {
      console.warn('No network adapter connected. Call connectToLegacyNetwork first.');
      return this;
    }

    // Route dice messages to current strategy
    const diceMessageTypes = [
      'dice:roll',
      'dice:grab',
      'dice:drop',
      'dice:lock',
    ];

    for (const type of diceMessageTypes) {
      this.#networkAdapter.onMessage(type, (payload, context) => {
        this.handleMessage(type, payload, context.fromPeerId);
      });
    }

    return this;
  }

  /**
   * Cleanup and disconnect from legacy systems.
   */
  disconnectLegacy() {
    if (this.#legacyBridge) {
      this.#legacyBridge.disableSync();
      this.#legacyBridge = null;
    }

    if (this.#networkAdapter) {
      this.#networkAdapter.clear();
      this.#networkAdapter = null;
    }
  }
}

/**
 * Create and initialize an App instance.
 * Convenience function for common setup.
 *
 * @param {object} options - Same as App.init()
 * @returns {App}
 */
export function createApp(options) {
  return new App().init(options);
}
