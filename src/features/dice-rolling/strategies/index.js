/**
 * Strategy registry - maps strategy IDs to strategy classes.
 */

import { GrabAndRollStrategy } from './grab-and-roll/GrabAndRollStrategy.js';

/**
 * Available dice rolling strategies.
 * Add new strategies here to make them available in the app.
 */
export const strategies = {
  'grab-and-roll': GrabAndRollStrategy,
  // Future strategies:
  // 'drag-select': DragSelectStrategy,
  // 'sequential': SequentialStrategy,
  // 'dice-pool': DicePoolStrategy,
};

/**
 * Default strategy ID.
 */
export const DEFAULT_STRATEGY = 'grab-and-roll';

/**
 * Create a strategy instance by ID.
 *
 * @param {string} strategyId - Strategy identifier
 * @param {object} context - Strategy context { state, network, localPlayer, animationService }
 * @returns {DiceRollingStrategy}
 * @throws {Error} If strategy ID is unknown
 */
export function createStrategy(strategyId, context) {
  const Strategy = strategies[strategyId];
  if (!Strategy) {
    throw new Error(`Unknown strategy: ${strategyId}. Available: ${Object.keys(strategies).join(', ')}`);
  }
  return new Strategy(context);
}

/**
 * Get metadata for all available strategies.
 * Useful for building strategy picker UI.
 *
 * @returns {Array<{id: string, name: string, description: string}>}
 */
export function getAvailableStrategies() {
  return Object.entries(strategies).map(([id, Strategy]) => {
    // Create a temporary instance to get name/description
    // This is a bit wasteful but strategies are lightweight
    const instance = new Strategy({
      state: null,
      network: null,
      localPlayer: null,
    });
    return {
      id,
      name: instance.name,
      description: instance.description,
    };
  });
}
