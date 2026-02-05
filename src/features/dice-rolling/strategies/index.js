/**
 * Strategy registry - maps strategy IDs to strategy classes.
 */

import { DragPickupStrategy } from "./drag-pickup/DragPickupStrategy.js";

/**
 * Available dice rolling strategies.
 * Add new strategies here to make them available in the app.
 */
export const strategies = {
  "drag-pickup": DragPickupStrategy,
};

/**
 * Default strategy ID.
 */
export const DEFAULT_STRATEGY = "drag-pickup";

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
    throw new Error(
      `Unknown strategy: ${strategyId}. Available: ${Object.keys(strategies).join(", ")}`,
    );
  }
  return new Strategy(context);
}
