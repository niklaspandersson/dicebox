/**
 * Dice Rolling Feature - Public API
 *
 * This module exports everything needed to use the dice rolling feature.
 */

// Base class
export { DiceRollingStrategy } from './strategies/DiceRollingStrategy.js';

// Strategy registry
export {
  strategies,
  DEFAULT_STRATEGY,
  createStrategy,
  getAvailableStrategies,
} from './strategies/index.js';

// Concrete strategies
export { GrabAndRollStrategy } from './strategies/grab-and-roll/GrabAndRollStrategy.js';
export { DragSelectStrategy } from './strategies/drag-select/DragSelectStrategy.js';

// State
export { DiceStore } from './state/DiceStore.js';
