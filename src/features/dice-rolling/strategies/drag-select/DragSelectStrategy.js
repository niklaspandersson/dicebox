import { DiceRollingStrategy } from '../DiceRollingStrategy.js';
import { DragSelectView } from './DragSelectView.js';

/**
 * "Drag to Select" strategy - an alternative UX paradigm.
 *
 * All dice are displayed in a flat pool. Users drag to select
 * individual dice, then release to roll the selection.
 * Any player can roll any dice at any time - no grabbing/holding.
 *
 * This demonstrates how the View Factory pattern enables
 * completely different interaction models.
 */
export class DragSelectStrategy extends DiceRollingStrategy {
  #selectedDice = new Set(); // Set of dieId strings like "red-0", "red-1", etc.
  #selectionListeners = new Set();

  get name() {
    return 'Drag to Select';
  }

  get description() {
    return 'Drag to select dice, then release to roll your selection. Anyone can roll anytime.';
  }

  // ─────────────────────────────────────────────────────────────
  // VIEW FACTORY
  // ─────────────────────────────────────────────────────────────

  static get viewTagName() {
    return 'dice-drag-select';
  }

  static get viewComponent() {
    return DragSelectView;
  }

  createView() {
    const view = document.createElement('dice-drag-select');
    view.setStrategy(this);
    return view;
  }

  // ─────────────────────────────────────────────────────────────
  // SELECTION LOGIC (strategy-specific)
  // ─────────────────────────────────────────────────────────────

  /**
   * Update the current selection.
   * Called by view during drag operations.
   * @param {string[]} diceIds - Array of die IDs like ["red-0", "blue-2"]
   */
  updateSelection(diceIds) {
    this.#selectedDice = new Set(diceIds);
    this.#notifySelectionChange();
  }

  /**
   * Add a die to selection.
   * @param {string} dieId
   */
  addToSelection(dieId) {
    this.#selectedDice.add(dieId);
    this.#notifySelectionChange();
  }

  /**
   * Remove a die from selection.
   * @param {string} dieId
   */
  removeFromSelection(dieId) {
    this.#selectedDice.delete(dieId);
    this.#notifySelectionChange();
  }

  /**
   * Toggle a die in selection (for click-to-select).
   * @param {string} dieId
   */
  toggleSelection(dieId) {
    if (this.#selectedDice.has(dieId)) {
      this.#selectedDice.delete(dieId);
    } else {
      this.#selectedDice.add(dieId);
    }
    this.#notifySelectionChange();
  }

  /**
   * Get current selection.
   * @returns {Set<string>}
   */
  getSelection() {
    return new Set(this.#selectedDice);
  }

  /**
   * Clear all selection.
   */
  clearSelection() {
    this.#selectedDice.clear();
    this.#notifySelectionChange();
  }

  /**
   * Check if a die is selected.
   * @param {string} dieId
   * @returns {boolean}
   */
  isSelected(dieId) {
    return this.#selectedDice.has(dieId);
  }

  /**
   * Subscribe to selection changes.
   * @param {function} callback
   * @returns {function} Unsubscribe function
   */
  onSelectionChange(callback) {
    this.#selectionListeners.add(callback);
    return () => this.#selectionListeners.delete(callback);
  }

  #notifySelectionChange() {
    const selection = this.getSelection();
    for (const callback of this.#selectionListeners) {
      callback(selection);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // ROLLING
  // ─────────────────────────────────────────────────────────────

  /**
   * Roll the currently selected dice.
   */
  async rollSelection() {
    if (this.#selectedDice.size === 0) return null;

    const { localPlayer } = this.context;
    const diceToRoll = [...this.#selectedDice];

    const result = await this.roll(localPlayer.id, diceToRoll);
    this.clearSelection();

    return result;
  }

  /**
   * Roll all dice (convenience method).
   */
  async rollAll() {
    const { state, localPlayer } = this.context;
    const allDiceIds = this.#getAllDiceIds();

    // Select all, then roll
    this.updateSelection(allDiceIds);
    return this.rollSelection();
  }

  async roll(playerId, diceIds) {
    const { state, network, localPlayer } = this.context;

    // Group dice by set
    const diceBySet = new Map();
    for (const dieId of diceIds) {
      const [setId, indexStr] = dieId.split('-');
      const index = parseInt(indexStr);
      if (!diceBySet.has(setId)) {
        diceBySet.set(setId, []);
      }
      diceBySet.get(setId).push(index);
    }

    const results = [];

    // Roll each set
    for (const [setId, indices] of diceBySet) {
      const setConfig = state.diceConfig.diceSets.find((s) => s.id === setId);
      if (!setConfig) continue;

      const currentValues = state.diceValues.get(setId) || [];
      const newValues = [...currentValues];

      // Only roll the selected indices
      for (const index of indices) {
        if (index < setConfig.count) {
          newValues[index] = Math.floor(Math.random() * 6) + 1;
        }
      }

      // Ensure array has correct length
      while (newValues.length < setConfig.count) {
        newValues.push(Math.floor(Math.random() * 6) + 1);
      }

      const result = {
        setId,
        values: newValues,
        playerId,
        username: localPlayer.username,
        rolledIndices: indices, // Track which dice were actually rolled
      };

      results.push(result);
      state.applyRoll(result);
      network.broadcast('dice:roll', result);
    }

    return results;
  }

  // ─────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────

  /**
   * Get all dice as a flat array with IDs.
   * @returns {Array<{id: string, setId: string, index: number, color: string}>}
   */
  getAllDice() {
    const { state } = this.context;
    const dice = [];

    for (const set of state.diceConfig.diceSets) {
      const values = state.diceValues.get(set.id) || [];
      for (let i = 0; i < set.count; i++) {
        dice.push({
          id: `${set.id}-${i}`,
          setId: set.id,
          index: i,
          value: values[i],
          color: set.color,
        });
      }
    }

    return dice;
  }

  #getAllDiceIds() {
    return this.getAllDice().map((d) => d.id);
  }

  // ─────────────────────────────────────────────────────────────
  // CORE INTERFACE IMPLEMENTATION
  // ─────────────────────────────────────────────────────────────

  handleMessage(type, payload, fromPeerId) {
    const { state } = this.context;

    if (type === 'dice:roll') {
      state.applyRoll(payload);
    }
    // Note: No grab/drop messages in this strategy
  }

  getState() {
    const { state } = this.context;
    return {
      values: Object.fromEntries(state.diceValues),
    };
  }

  loadState(snapshot) {
    const { state } = this.context;
    if (snapshot.values) {
      for (const [setId, values] of Object.entries(snapshot.values)) {
        state.setValues(setId, values);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────────

  activate() {
    this.clearSelection();
  }

  deactivate() {
    this.clearSelection();
    this.#selectionListeners.clear();
  }
}
