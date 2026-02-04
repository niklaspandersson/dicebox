/**
 * DiceRollerIntegration - Integrates the new strategy-based dice roller
 * with the existing DiceBoxApp.
 *
 * This module replaces the legacy <dice-roller> component with the new
 * strategy-based <dice-roller-container> while maintaining compatibility
 * with the existing app infrastructure.
 */

import { createApp } from '../app/App.js';
import { LegacyBridge } from '../infrastructure/network/LegacyBridge.js';

/**
 * Create an integrated dice roller that works with the existing app.
 *
 * @param {object} options
 * @param {object} options.meshState - Legacy mesh state instance
 * @param {object} options.webrtcManager - Legacy WebRTC manager
 * @param {object} options.messageRouter - Legacy message router
 * @param {function} options.getLocalPlayer - Function returning { id, username }
 * @param {string} options.strategyId - Strategy to use (default: 'grab-and-roll')
 * @returns {object} Integration controller
 */
export function createDiceRollerIntegration(options) {
  const {
    meshState,
    webrtcManager,
    messageRouter,
    getLocalPlayer,
    strategyId = 'grab-and-roll',
  } = options;

  let app = null;
  let mountedContainer = null;
  let unsubscribers = [];

  const integration = {
    /**
     * Initialize and mount the new dice roller.
     *
     * @param {HTMLElement|string} container - Mount target
     */
    mount(container) {
      const el = typeof container === 'string'
        ? document.querySelector(container)
        : container;

      if (!el) {
        throw new Error(`Mount container not found: ${container}`);
      }

      // Get initial config from mesh state
      const diceConfig = meshState.getDiceConfig() || {
        diceSets: [{ id: 'default', count: 2, color: '#ffffff' }],
        allowLocking: false,
      };

      const localPlayer = getLocalPlayer();

      // Create the new app
      app = createApp({
        diceConfig,
        localPlayer,
        network: {
          // Network adapter that broadcasts through the existing infrastructure
          broadcast: (type, payload) => {
            const legacyMsg = this._convertToLegacyMessage(type, payload);
            if (legacyMsg && messageRouter) {
              messageRouter.broadcast(legacyMsg);
            }
          },
        },
        strategyId,
      });

      // Mount to container
      app.mount(el);
      mountedContainer = el;

      // Bridge to legacy state
      app.bridgeToLegacyState(meshState, {
        syncFromLegacy: true,
        enableTwoWaySync: false, // We'll handle sync manually via events
      });

      // Set up message handling from legacy
      this._setupLegacyMessageHandlers();

      return this;
    },

    /**
     * Unmount and cleanup.
     */
    unmount() {
      if (mountedContainer) {
        mountedContainer.innerHTML = '';
        mountedContainer = null;
      }

      for (const unsub of unsubscribers) {
        unsub();
      }
      unsubscribers = [];

      if (app) {
        app.disconnectLegacy();
        app = null;
      }
    },

    /**
     * Update the dice roller state from legacy.
     * Call this when the legacy app needs to push state changes.
     */
    updateFromLegacy() {
      if (app && app.legacyBridge) {
        app.legacyBridge.syncFromLegacy();
      }
    },

    /**
     * Update local player (when switching players).
     */
    setLocalPlayer(player) {
      if (app) {
        app.container.registerInstance('localPlayer', player);
        // Recreate strategy with new player
        app.setStrategy(app.currentStrategyId);
      }
    },

    /**
     * Switch strategy.
     */
    setStrategy(strategyId) {
      if (app) {
        app.setStrategy(strategyId);
      }
    },

    /**
     * Get available strategies.
     */
    getAvailableStrategies() {
      return app ? app.getAvailableStrategies() : [];
    },

    /**
     * Get current strategy ID.
     */
    get currentStrategyId() {
      return app ? app.currentStrategyId : null;
    },

    /**
     * Handle a dice roll message from legacy.
     */
    handleDiceRoll(roll) {
      if (!app) return;
      const converted = LegacyBridge.convertRollMessage(roll);
      for (const sr of converted.setResults) {
        app.diceStore.applyRoll({
          setId: sr.setId,
          values: sr.values,
          playerId: sr.playerId,
          username: sr.username,
        });
      }
    },

    /**
     * Handle a dice grab message from legacy.
     */
    handleDiceGrab(grab) {
      if (!app) return;
      const converted = LegacyBridge.convertGrabMessage(grab);
      app.diceStore.setHolder(converted.setId, converted.playerId, converted.username);
    },

    /**
     * Handle a dice drop message from legacy.
     */
    handleDiceDrop(drop) {
      if (!app) return;
      if (drop.setId) {
        app.diceStore.clearHolder(drop.setId);
      }
    },

    /**
     * Handle a dice lock message from legacy.
     */
    handleDiceLock(lock) {
      if (!app) return;
      app.diceStore.setLock(lock.setId, lock.dieIndex, lock.locked);
    },

    /**
     * Convert new message type to legacy format.
     * @private
     */
    _convertToLegacyMessage(type, payload) {
      switch (type) {
        case 'dice:roll':
          return {
            type: 'dice-roll',
            ...LegacyBridge.convertToLegacyRoll(payload),
          };
        case 'dice:grab':
          return {
            type: 'dice-grab',
            ...LegacyBridge.convertToLegacyGrab(payload),
          };
        case 'dice:drop':
          return {
            type: 'dice-drop',
            setId: payload.setId,
          };
        case 'dice:lock':
          return {
            type: 'dice-lock',
            setId: payload.setId,
            dieIndex: payload.dieIndex,
            locked: payload.locked,
            value: payload.value,
          };
        default:
          return null;
      }
    },

    /**
     * Set up handlers for legacy message types.
     * @private
     */
    _setupLegacyMessageHandlers() {
      // The legacy app handles messages and calls our handler methods
      // This is set up in the legacy app.js
    },
  };

  return integration;
}

/**
 * Replace an existing <dice-roller> element with the new system.
 *
 * @param {HTMLElement} oldElement - The <dice-roller> element to replace
 * @param {object} options - Same as createDiceRollerIntegration
 * @returns {object} Integration controller
 */
export function replaceDiceRoller(oldElement, options) {
  // Create a container div to replace the old element
  const container = document.createElement('div');
  container.className = 'dice-roller-integration';

  // Replace the old element
  oldElement.parentNode.replaceChild(container, oldElement);

  // Create and mount the integration
  const integration = createDiceRollerIntegration(options);
  integration.mount(container);

  return integration;
}
