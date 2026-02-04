import { DiceRollingStrategy } from '../DiceRollingStrategy.js';
import { GrabAndRollView } from './GrabAndRollView.js';

/**
 * "Grab and Roll" strategy - the original DiceBox UX.
 *
 * Players grab dice sets by clicking on them. When all sets are held,
 * any holder can click their set to roll. Supports dice locking.
 */
export class GrabAndRollStrategy extends DiceRollingStrategy {
  get name() {
    return 'Grab and Roll';
  }

  get description() {
    return 'Players grab dice sets, then roll together when all sets are held.';
  }

  // ─────────────────────────────────────────────────────────────
  // VIEW FACTORY
  // ─────────────────────────────────────────────────────────────

  static get viewTagName() {
    return 'dice-grab-and-roll';
  }

  static get viewComponent() {
    return GrabAndRollView;
  }

  createView() {
    const view = document.createElement('dice-grab-and-roll');
    view.setStrategy(this);
    return view;
  }

  // ─────────────────────────────────────────────────────────────
  // STRATEGY-SPECIFIC LOGIC
  // ─────────────────────────────────────────────────────────────

  /**
   * Called by view when user clicks a dice set.
   */
  async handleSetClick(setId) {
    const { state, network, localPlayer } = this.context;
    const holder = state.holders.get(setId);

    if (!holder) {
      // Try to grab the set
      if (state.tryGrab(setId, localPlayer.id, localPlayer.username)) {
        network.broadcast('dice:grab', {
          setId,
          playerId: localPlayer.id,
          username: localPlayer.username,
        });
      }
    } else if (holder.playerId === localPlayer.id) {
      if (this.canRoll()) {
        // All sets held and I'm a holder - roll!
        await this.rollMySets();
      } else {
        // Drop the set
        state.clearHolder(setId);
        network.broadcast('dice:drop', { setId });
      }
    }
  }

  /**
   * Called by view when user clicks a die to toggle lock.
   */
  handleDieLockClick(setId, dieIndex) {
    const { state, network, localPlayer } = this.context;

    if (!this.canLock(setId)) {
      return;
    }

    state.toggleLock(setId, dieIndex);

    const isLocked = state.lockedDice.get(setId)?.has(dieIndex) ?? false;
    network.broadcast('dice:lock', {
      setId,
      dieIndex,
      locked: isLocked,
    });
  }

  /**
   * Check if current player can roll.
   */
  canRoll() {
    const { state, localPlayer } = this.context;
    const diceSets = state.diceConfig.diceSets;

    // All sets must be held
    const allSetsHeld = diceSets.every((set) => state.holders.has(set.id));
    if (!allSetsHeld) return false;

    // Player must hold at least one set
    const playerHoldsAny = [...state.holders.values()].some(
      (h) => h.playerId === localPlayer.id
    );
    return playerHoldsAny;
  }

  /**
   * Check if current player can lock dice in a set.
   */
  canLock(setId) {
    const { state, localPlayer } = this.context;

    if (!state.diceConfig.allowLocking) return false;

    const holder = state.holders.get(setId);
    const lastRoller = state.lastRoller.get(setId);
    const holderHasRolled = state.holderHasRolled.get(setId);
    const hasValues = state.diceValues.has(setId);

    // Can lock if: I'm the holder and have rolled
    if (holder?.playerId === localPlayer.id && holderHasRolled) {
      return true;
    }

    // Can lock if: Not held, but I was the last roller
    if (!holder && lastRoller?.playerId === localPlayer.id && hasValues) {
      return true;
    }

    return false;
  }

  /**
   * Get the set IDs that the current player holds.
   */
  getMySetIds() {
    const { state, localPlayer } = this.context;
    return [...state.holders.entries()]
      .filter(([_, h]) => h.playerId === localPlayer.id)
      .map(([setId]) => setId);
  }

  /**
   * Roll all sets that the current player holds.
   */
  async rollMySets() {
    const setIds = this.getMySetIds();
    if (setIds.length === 0) return;

    const { localPlayer } = this.context;
    await this.roll(localPlayer.id, setIds);
  }

  // ─────────────────────────────────────────────────────────────
  // CORE INTERFACE IMPLEMENTATION
  // ─────────────────────────────────────────────────────────────

  async roll(playerId, setIds) {
    const { state, network, localPlayer } = this.context;

    const results = [];

    for (const setId of setIds) {
      const setConfig = state.diceConfig.diceSets.find((s) => s.id === setId);
      if (!setConfig) continue;

      const lockedIndices = state.lockedDice.get(setId) || new Set();
      const currentValues = state.diceValues.get(setId) || [];

      // Generate new values, keeping locked dice
      const values = [];
      for (let i = 0; i < setConfig.count; i++) {
        if (lockedIndices.has(i) && currentValues[i]) {
          values.push(currentValues[i]);
        } else {
          values.push(Math.floor(Math.random() * 6) + 1);
        }
      }

      const result = {
        setId,
        values,
        playerId,
        username: localPlayer.username,
      };

      results.push(result);
      state.applyRoll(result);
    }

    // Broadcast all results
    for (const result of results) {
      network.broadcast('dice:roll', result);
    }

    return results;
  }

  handleMessage(type, payload, fromPeerId) {
    const { state } = this.context;

    switch (type) {
      case 'dice:grab':
        state.setHolder(payload.setId, payload.playerId, payload.username);
        break;

      case 'dice:drop':
        state.clearHolder(payload.setId);
        break;

      case 'dice:roll':
        state.applyRoll(payload);
        break;

      case 'dice:lock':
        state.setLock(payload.setId, payload.dieIndex, payload.locked);
        break;
    }
  }

  getState() {
    return this.context.state.getSnapshot();
  }

  loadState(snapshot) {
    this.context.state.loadSnapshot(snapshot);
  }
}
