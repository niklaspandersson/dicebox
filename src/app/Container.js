/**
 * Simple dependency injection container.
 * Supports lazy instantiation via factories.
 */
export class Container {
  #services = new Map();
  #factories = new Map();

  /**
   * Register a factory function for lazy instantiation.
   * @param {string} name - Service name
   * @param {function} factory - Factory function, receives container as argument
   */
  register(name, factory) {
    this.#factories.set(name, factory);
  }

  /**
   * Register an already-instantiated service.
   * @param {string} name - Service name
   * @param {*} instance - Service instance
   */
  registerInstance(name, instance) {
    this.#services.set(name, instance);
  }

  /**
   * Get a service by name. Lazily instantiates if needed.
   * @param {string} name - Service name
   * @returns {*} Service instance
   */
  get(name) {
    if (!this.#services.has(name)) {
      const factory = this.#factories.get(name);
      if (!factory) {
        throw new Error(`Service not found: ${name}`);
      }
      this.#services.set(name, factory(this));
    }
    return this.#services.get(name);
  }

  /**
   * Check if a service is registered.
   * @param {string} name - Service name
   * @returns {boolean}
   */
  has(name) {
    return this.#services.has(name) || this.#factories.has(name);
  }

  /**
   * Remove a service (useful for testing).
   * @param {string} name - Service name
   */
  remove(name) {
    this.#services.delete(name);
    this.#factories.delete(name);
  }

  /**
   * Clear all services (useful for testing).
   */
  clear() {
    this.#services.clear();
    this.#factories.clear();
  }
}
