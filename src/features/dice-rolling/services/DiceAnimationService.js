/**
 * Service for handling dice roll animations.
 *
 * Provides methods for:
 * - Animating dice rolls with configurable duration
 * - Generating random intermediate values during animation
 * - Coordinating animation state across dice sets
 *
 * @example
 * const animationService = new DiceAnimationService();
 *
 * // Animate a roll and get final values
 * const result = await animationService.animateRoll({
 *   setIds: ['red', 'blue'],
 *   diceConfig: { diceSets: [...] },
 *   onFrame: (frameValues) => updateUI(frameValues),
 * });
 */
export class DiceAnimationService {
  #defaultDuration = 500; // ms
  #frameInterval = 50; // ms between animation frames

  /**
   * @param {object} options
   * @param {number} options.duration - Animation duration in ms
   * @param {number} options.frameInterval - Interval between animation frames
   */
  constructor(options = {}) {
    this.#defaultDuration = options.duration ?? 500;
    this.#frameInterval = options.frameInterval ?? 50;
  }

  /**
   * Animate a dice roll.
   *
   * @param {object} options
   * @param {string[]} options.setIds - IDs of sets to roll
   * @param {object} options.diceConfig - Dice configuration
   * @param {function} options.onFrame - Callback for animation frames (optional)
   * @param {number} options.duration - Animation duration in ms (optional)
   * @returns {Promise<Map<string, number[]>>} Final values for each set
   */
  async animateRoll(options) {
    const {
      setIds,
      diceConfig,
      onFrame,
      duration = this.#defaultDuration,
    } = options;

    const startTime = Date.now();
    const endTime = startTime + duration;

    // Generate final values upfront
    const finalValues = this.#generateFinalValues(setIds, diceConfig);

    // If no animation callback, just return final values
    if (!onFrame) {
      return finalValues;
    }

    // Animation loop
    return new Promise((resolve) => {
      const animate = () => {
        const now = Date.now();

        if (now >= endTime) {
          // Animation complete - show final values
          onFrame(finalValues, true);
          resolve(finalValues);
          return;
        }

        // Generate random intermediate values
        const frameValues = this.#generateFrameValues(setIds, diceConfig);
        onFrame(frameValues, false);

        // Schedule next frame
        setTimeout(animate, this.#frameInterval);
      };

      // Start animation
      animate();
    });
  }

  /**
   * Generate final roll values.
   */
  #generateFinalValues(setIds, diceConfig) {
    const result = new Map();

    for (const setId of setIds) {
      const setConfig = diceConfig.diceSets.find((s) => s.id === setId);
      if (!setConfig) continue;

      const values = [];
      for (let i = 0; i < setConfig.count; i++) {
        values.push(this.#randomDieValue());
      }

      result.set(setId, values);
    }

    return result;
  }

  /**
   * Generate random intermediate frame values for animation.
   */
  #generateFrameValues(setIds, diceConfig) {
    const result = new Map();

    for (const setId of setIds) {
      const setConfig = diceConfig.diceSets.find((s) => s.id === setId);
      if (!setConfig) continue;

      const values = [];
      for (let i = 0; i < setConfig.count; i++) {
        values.push(this.#randomDieValue());
      }

      result.set(setId, values);
    }

    return result;
  }

  /**
   * Generate a random die value (1-6).
   */
  #randomDieValue() {
    return Math.floor(Math.random() * 6) + 1;
  }

  /**
   * Show a roll result (for incoming network rolls).
   * This animates the display of values that were rolled by another peer.
   *
   * @param {object} options
   * @param {Map<string, number[]>} options.values - Final values to show
   * @param {object} options.diceConfig - Dice configuration
   * @param {function} options.onFrame - Callback for animation frames
   * @param {number} options.duration - Animation duration in ms (optional)
   * @returns {Promise<void>}
   */
  async showRoll(options) {
    const {
      values,
      diceConfig,
      onFrame,
      duration = this.#defaultDuration,
    } = options;

    if (!onFrame) return;

    const startTime = Date.now();
    const endTime = startTime + duration;
    const setIds = [...values.keys()];

    return new Promise((resolve) => {
      const animate = () => {
        const now = Date.now();

        if (now >= endTime) {
          // Animation complete - show final values
          onFrame(values, true);
          resolve();
          return;
        }

        // Generate random intermediate values
        const frameValues = new Map();
        for (const setId of setIds) {
          const setConfig = diceConfig.diceSets.find((s) => s.id === setId);
          if (!setConfig) continue;

          const finalVals = values.get(setId);
          const frameVals = finalVals.map(() => this.#randomDieValue());
          frameValues.set(setId, frameVals);
        }
        onFrame(frameValues, false);

        setTimeout(animate, this.#frameInterval);
      };

      animate();
    });
  }

  /**
   * Get animation settings.
   */
  getSettings() {
    return {
      duration: this.#defaultDuration,
      frameInterval: this.#frameInterval,
    };
  }

  /**
   * Update animation settings.
   */
  setSettings(settings) {
    if (settings.duration !== undefined) {
      this.#defaultDuration = settings.duration;
    }
    if (settings.frameInterval !== undefined) {
      this.#frameInterval = settings.frameInterval;
    }
  }
}
