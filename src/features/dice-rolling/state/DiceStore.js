import { Store } from "../../../infrastructure/state/core/Store.js";

/**
 * Initial state for the dice store.
 */
const initialState = {
  // Dice configuration (set at room creation)
  config: {
    diceSets: [], // [{ id, count, color }]
  },

  // Current dice values: Map<setId, number[]>
  values: new Map(),

  // Who holds each set: Map<setId, { playerId, username }>
  holders: new Map(),

  // Who rolled each set last: Map<setId, { playerId, username }>
  lastRoller: new Map(),

  // Whether the current holder has rolled: Map<setId, boolean>
  holderHasRolled: new Map(),
};

/**
 * Store for dice-related state.
 * Manages dice configuration, values, and holders.
 */
export class DiceStore extends Store {
  constructor() {
    super(structuredClone(initialState));
  }

  // ─────────────────────────────────────────────────────────────
  // CONFIG
  // ─────────────────────────────────────────────────────────────

  get diceConfig() {
    return this.state.config;
  }

  setConfig(config) {
    this.update({ config });
  }

  // ─────────────────────────────────────────────────────────────
  // VALUES
  // ─────────────────────────────────────────────────────────────

  get diceValues() {
    return this.state.values;
  }

  setValues(setId, values) {
    this.update((state) => ({
      ...state,
      values: new Map(state.values).set(setId, values),
    }));
  }

  // ─────────────────────────────────────────────────────────────
  // HOLDERS
  // ─────────────────────────────────────────────────────────────

  get holders() {
    return this.state.holders;
  }

  /**
   * Try to grab a dice set. Returns true if successful.
   * First-come-first-served: fails if already held.
   */
  tryGrab(setId, playerId, username) {
    if (this.state.holders.has(setId)) {
      return false;
    }
    this.setHolder(setId, playerId, username);
    return true;
  }

  setHolder(setId, playerId, username) {
    this.update((state) => ({
      ...state,
      holders: new Map(state.holders).set(setId, { playerId, username }),
      holderHasRolled: new Map(state.holderHasRolled).set(setId, false),
    }));
  }

  clearHolder(setId) {
    this.update((state) => {
      const holders = new Map(state.holders);
      holders.delete(setId);
      const holderHasRolled = new Map(state.holderHasRolled);
      holderHasRolled.delete(setId);
      return { ...state, holders, holderHasRolled };
    });
  }

  // ─────────────────────────────────────────────────────────────
  // ROLLING
  // ─────────────────────────────────────────────────────────────

  get lastRoller() {
    return this.state.lastRoller;
  }

  get holderHasRolled() {
    return this.state.holderHasRolled;
  }

  /**
   * Apply a roll result to the state.
   * @param {object} rollResult - { setId, values, playerId, username }
   */
  applyRoll(rollResult) {
    const { setId, values, playerId, username } = rollResult;
    this.update((state) => ({
      ...state,
      values: new Map(state.values).set(setId, values),
      lastRoller: new Map(state.lastRoller).set(setId, { playerId, username }),
      holderHasRolled: new Map(state.holderHasRolled).set(setId, true),
    }));
  }

  /**
   * Apply multiple roll results at once.
   * @param {object[]} rollResults - Array of roll results
   */
  applyRolls(rollResults) {
    this.update((state) => {
      const values = new Map(state.values);
      const lastRoller = new Map(state.lastRoller);
      const holderHasRolled = new Map(state.holderHasRolled);

      for (const result of rollResults) {
        values.set(result.setId, result.values);
        lastRoller.set(result.setId, {
          playerId: result.playerId,
          username: result.username,
        });
        holderHasRolled.set(result.setId, true);
      }

      return { ...state, values, lastRoller, holderHasRolled };
    });
  }

  // ─────────────────────────────────────────────────────────────
  // SERIALIZATION (for P2P sync)
  // ─────────────────────────────────────────────────────────────

  getSnapshot() {
    const state = this.state;
    return {
      config: state.config,
      values: Object.fromEntries(state.values),
      holders: Object.fromEntries(state.holders),
      lastRoller: Object.fromEntries(state.lastRoller),
      holderHasRolled: Object.fromEntries(state.holderHasRolled),
    };
  }

  loadSnapshot(snapshot) {
    this.update({
      config: snapshot.config,
      values: new Map(Object.entries(snapshot.values || {})),
      holders: new Map(Object.entries(snapshot.holders || {})),
      lastRoller: new Map(Object.entries(snapshot.lastRoller || {})),
      holderHasRolled: new Map(Object.entries(snapshot.holderHasRolled || {})),
    });
  }

  /**
   * Reset to initial state.
   */
  reset() {
    this.update(structuredClone(initialState));
  }
}
