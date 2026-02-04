/**
 * Container that mounts the appropriate strategy view.
 *
 * This is the ONLY place that knows about strategy views.
 * The rest of the app just knows about strategies.
 *
 * Usage:
 *   const container = document.querySelector('dice-roller-container');
 *   container.setStrategy(myStrategy);
 */
export class DiceRollerContainer extends HTMLElement {
  #strategy = null;
  #currentView = null;

  /**
   * Set the active strategy. Can be called to switch strategies at runtime.
   * @param {DiceRollingStrategy} strategy
   */
  setStrategy(strategy) {
    // Deactivate old strategy
    if (this.#strategy) {
      this.#strategy.deactivate();
    }

    // Remove old view
    if (this.#currentView) {
      this.#currentView.remove();
      this.#currentView = null;
    }

    this.#strategy = strategy;

    if (strategy) {
      // Register view component if needed
      this.#ensureViewRegistered(strategy);

      // Create and mount new view
      this.#currentView = strategy.createView();
      this.appendChild(this.#currentView);

      // Activate new strategy
      strategy.activate();
    }
  }

  /**
   * Get the current strategy.
   * @returns {DiceRollingStrategy|null}
   */
  getStrategy() {
    return this.#strategy;
  }

  #ensureViewRegistered(strategy) {
    const tagName = strategy.constructor.viewTagName;
    const viewComponent = strategy.constructor.viewComponent;

    if (tagName && viewComponent && !customElements.get(tagName)) {
      customElements.define(tagName, viewComponent);
    }
  }

  disconnectedCallback() {
    if (this.#strategy) {
      this.#strategy.deactivate();
    }
  }
}

// Register the component
if (!customElements.get('dice-roller-container')) {
  customElements.define('dice-roller-container', DiceRollerContainer);
}
