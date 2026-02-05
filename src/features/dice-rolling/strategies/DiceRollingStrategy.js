/**
 * Abstract base class for dice rolling UX strategies.
 *
 * Each strategy defines both the LOGIC and the VIEW for dice interaction.
 * This follows the "Widget" pattern where controller + view are bundled together,
 * enabling completely different UX paradigms per strategy.
 *
 * @abstract
 */
export class DiceRollingStrategy {
  /**
   * @param {object} context - Shared context
   * @param {object} context.state - DiceStore instance
   * @param {object} context.network - NetworkService instance
   * @param {object} context.localPlayer - Local player info { id, username }
   * @param {object} context.animationService - DiceAnimationService instance
   */
  constructor(context) {
    if (new.target === DiceRollingStrategy) {
      throw new Error(
        "DiceRollingStrategy is abstract and cannot be instantiated directly",
      );
    }
    this.context = context;
  }

  // ─────────────────────────────────────────────────────────────
  // METADATA
  // ─────────────────────────────────────────────────────────────

  /**
   * Human-readable name for this strategy.
   * @returns {string}
   */
  get name() {
    throw new Error("Not implemented: name");
  }

  /**
   * Description for UI (strategy picker).
   * @returns {string}
   */
  get description() {
    throw new Error("Not implemented: description");
  }

  // ─────────────────────────────────────────────────────────────
  // VIEW FACTORY - The key extension point for custom UX
  // ─────────────────────────────────────────────────────────────

  /**
   * Factory method: Creates the view component for this strategy.
   *
   * The returned component is a Web Component that:
   * - Receives this strategy instance as its controller
   * - Handles all user interactions (clicks, drags, gestures, etc.)
   * - Renders the dice UI appropriate for this strategy's UX paradigm
   * - Subscribes to state changes and re-renders as needed
   *
   * @returns {HTMLElement} A Web Component instance
   */
  createView() {
    throw new Error(
      "Not implemented: createView - each strategy must provide its own view",
    );
  }

  /**
   * Returns the custom element tag name for this strategy's view.
   * Used for registering the component if not already registered.
   * @returns {string}
   */
  static get viewTagName() {
    throw new Error("Not implemented: viewTagName");
  }

  /**
   * Returns the view component class for registration.
   * @returns {typeof HTMLElement}
   */
  static get viewComponent() {
    throw new Error("Not implemented: viewComponent");
  }

  // ─────────────────────────────────────────────────────────────
  // CORE LOGIC - Shared interface for all strategies
  // ─────────────────────────────────────────────────────────────

  /**
   * Execute the roll action for given dice.
   * @param {string} playerId - Who is rolling
   * @param {string[]} setIds - Which sets to roll (strategy-dependent)
   * @returns {Promise<object>} Roll result
   */
  async roll(playerId, setIds) {
    throw new Error("Not implemented: roll");
  }

  /**
   * Handle incoming network message related to dice.
   * @param {string} type - Message type (e.g., 'dice:roll')
   * @param {object} payload - Message data
   * @param {string} fromPeerId - Sender's peer ID
   */
  handleMessage(type, payload, fromPeerId) {
    throw new Error("Not implemented: handleMessage");
  }

  /**
   * Get the current state for serialization/sync.
   * Called when a new peer joins and needs current state.
   * @returns {object}
   */
  getState() {
    throw new Error("Not implemented: getState");
  }

  /**
   * Load state from a peer (for sync on join).
   * @param {object} state - State snapshot from another peer
   */
  loadState(state) {
    throw new Error("Not implemented: loadState");
  }

  // ─────────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────────

  /**
   * Called when strategy is activated (view mounted).
   * Use for setting up subscriptions, timers, etc.
   */
  activate() {
    // Optional: override in subclass
  }

  /**
   * Called when strategy is deactivated (view unmounted).
   * Use for cleaning up subscriptions, timers, etc.
   */
  deactivate() {
    // Optional: override in subclass
  }
}
