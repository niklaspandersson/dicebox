/**
 * Dice Rolling Feature - Public API
 *
 * This module exports everything needed to use the dice rolling feature.
 */

// Base class
export { DiceRollingStrategy } from "./strategies/DiceRollingStrategy.js";

// Strategy registry
export {
  strategies,
  DEFAULT_STRATEGY,
  createStrategy,
} from "./strategies/index.js";

// State
export { DiceStore } from "./state/DiceStore.js";
