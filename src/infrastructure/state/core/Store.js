/**
 * Base reactive store class.
 * Provides simple state management with subscriptions.
 */
export class Store extends EventTarget {
  #state;

  constructor(initialState) {
    super();
    this.#state = initialState;
  }

  get state() {
    return this.#state;
  }

  /**
   * Update the state. Accepts either a partial state object
   * or an updater function that receives current state.
   * @param {object|function} updater
   */
  update(updater) {
    const oldState = this.#state;
    this.#state =
      typeof updater === 'function'
        ? updater(oldState)
        : { ...oldState, ...updater };

    this.dispatchEvent(
      new CustomEvent('change', {
        detail: { oldState, newState: this.#state },
      })
    );
  }

  /**
   * Subscribe to state changes.
   * @param {function} callback - Called with (newState, oldState)
   * @returns {function} Unsubscribe function
   */
  subscribe(callback) {
    const handler = (e) => callback(e.detail.newState, e.detail.oldState);
    this.addEventListener('change', handler);
    return () => this.removeEventListener('change', handler);
  }

  /**
   * Get a snapshot of the current state for serialization.
   * Override in subclasses if state contains non-serializable values.
   * @returns {object}
   */
  getSnapshot() {
    return structuredClone(this.#state);
  }

  /**
   * Load state from a snapshot.
   * Override in subclasses if state contains non-serializable values.
   * @param {object} snapshot
   */
  loadSnapshot(snapshot) {
    this.#state = structuredClone(snapshot);
    this.dispatchEvent(
      new CustomEvent('change', {
        detail: { oldState: null, newState: this.#state },
      })
    );
  }
}
