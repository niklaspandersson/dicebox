import { DiceRollingStrategy } from "../DiceRollingStrategy.js";
import { DragPickupView } from "./DragPickupView.js";

/**
 * "Drag to Pick Up" strategy - touch/mouse friendly dice rolling.
 *
 * Users drag across dice to pick them up, then release to roll.
 * Only the picked-up dice are rolled; others keep their values.
 * Any player can roll any dice at any time (no grabbing/holding).
 */
export class DragPickupStrategy extends DiceRollingStrategy {
  get name() {
    return "Drag to Pick Up";
  }

  get description() {
    return "Drag across dice to pick them up, release to roll. Touch-friendly.";
  }

  // ─────────────────────────────────────────────────────────────
  // VIEW FACTORY
  // ─────────────────────────────────────────────────────────────

  static get viewTagName() {
    return "dice-drag-pickup";
  }

  static get viewComponent() {
    return DragPickupView;
  }

  createView() {
    const view = document.createElement("dice-drag-pickup");
    view.setStrategy(this);
    return view;
  }

  // ─────────────────────────────────────────────────────────────
  // STRATEGY-SPECIFIC LOGIC
  // ─────────────────────────────────────────────────────────────

  /**
   * Get all dice as a flat array with their set info.
   * @returns {Array<{setId: string, dieIndex: number, color: string, value: number|null}>}
   */
  getAllDice() {
    const { state } = this.context;
    const dice = [];

    for (const set of state.diceConfig.diceSets) {
      const values = state.diceValues.get(set.id) || [];
      for (let i = 0; i < set.count; i++) {
        dice.push({
          setId: set.id,
          dieIndex: i,
          color: set.color,
          value: values[i] ?? null,
        });
      }
    }

    return dice;
  }

  /**
   * Roll specific dice (identified by global index in the flat array).
   * Called by the view when user releases after picking up dice.
   *
   * @param {Set<number>} pickedIndices - Global indices of dice to roll
   */
  async rollPickedDice(pickedIndices) {
    if (pickedIndices.size === 0) return;

    const { state, network, localPlayer } = this.context;
    const allDice = this.getAllDice();

    // Group picked dice by set
    const setUpdates = new Map(); // setId -> { indices: number[], newValues: number[] }

    for (const globalIndex of pickedIndices) {
      const die = allDice[globalIndex];
      if (!die) continue;

      if (!setUpdates.has(die.setId)) {
        // Get current values for this set
        const currentValues = state.diceValues.get(die.setId) || [];
        setUpdates.set(die.setId, {
          indices: [],
          currentValues: [...currentValues],
        });
      }

      setUpdates.get(die.setId).indices.push(die.dieIndex);
    }

    // Generate new values and apply rolls
    const results = [];

    for (const [setId, update] of setUpdates) {
      const setConfig = state.diceConfig.diceSets.find((s) => s.id === setId);
      if (!setConfig) continue;

      // Ensure we have an array of the right size
      const newValues =
        update.currentValues.length === setConfig.count
          ? [...update.currentValues]
          : Array(setConfig.count).fill(1);

      // Roll only the picked dice in this set
      for (const dieIndex of update.indices) {
        newValues[dieIndex] = Math.floor(Math.random() * 6) + 1;
      }

      const result = {
        setId,
        values: newValues,
        playerId: localPlayer.id,
        username: localPlayer.username,
        rolledIndices: update.indices, // Track which dice were actually rolled
      };

      results.push(result);
      state.applyRoll(result);
    }

    // Broadcast all results
    for (const result of results) {
      network.broadcast("dice:roll", result);
    }

    return results;
  }

  // ─────────────────────────────────────────────────────────────
  // CORE INTERFACE IMPLEMENTATION
  // ─────────────────────────────────────────────────────────────

  async roll(playerId, setIds) {
    // This strategy doesn't use set-based rolling
    // Instead, use rollPickedDice() with specific dice indices
    throw new Error(
      "DragPickupStrategy uses rollPickedDice() instead of roll()",
    );
  }

  handleMessage(type, payload, fromPeerId) {
    const { state } = this.context;

    if (type === "dice:roll") {
      state.applyRoll(payload);
    }
  }

  getState() {
    return this.context.state.getSnapshot();
  }

  loadState(snapshot) {
    this.context.state.loadSnapshot(snapshot);
  }
}
