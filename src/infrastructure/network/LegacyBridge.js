/**
 * LegacyBridge - Bridges the legacy MeshState with the new DiceStore.
 *
 * This enables gradual migration by syncing state between old and new systems.
 * During transition, changes in either system are reflected in the other.
 *
 * @example
 * const bridge = new LegacyBridge(meshState, diceStore);
 * bridge.syncFromLegacy(); // One-time sync from MeshState to DiceStore
 * bridge.enableTwoWaySync(); // Enable continuous sync
 */
export class LegacyBridge {
  #meshState = null;
  #diceStore = null;
  #unsubscribers = [];
  #isSyncing = false;

  /**
   * Create a LegacyBridge.
   *
   * @param {MeshState} meshState - Legacy mesh state instance
   * @param {DiceStore} diceStore - New dice store instance
   */
  constructor(meshState, diceStore) {
    this.#meshState = meshState;
    this.#diceStore = diceStore;
  }

  /**
   * One-time sync from legacy MeshState to new DiceStore.
   * Useful when initializing the new system from existing state.
   */
  syncFromLegacy() {
    if (!this.#meshState || !this.#diceStore) return;

    this.#isSyncing = true;
    try {
      const snapshot = this.#meshState.getSnapshot();
      this.#applyLegacySnapshot(snapshot);
    } finally {
      this.#isSyncing = false;
    }
  }

  /**
   * One-time sync from new DiceStore to legacy MeshState.
   * Useful when the new system has authoritative state.
   */
  syncToLegacy() {
    if (!this.#meshState || !this.#diceStore) return;

    this.#isSyncing = true;
    try {
      this.#applyNewStateToLegacy();
    } finally {
      this.#isSyncing = false;
    }
  }

  /**
   * Apply a legacy snapshot to the new DiceStore.
   *
   * @param {object} snapshot - Snapshot from MeshState.getSnapshot()
   */
  #applyLegacySnapshot(snapshot) {
    // Apply dice config
    if (snapshot.diceConfig) {
      this.#diceStore.setConfig(snapshot.diceConfig);
    }

    // Apply holders
    for (const [setId, holder] of snapshot.holders || []) {
      this.#diceStore.setHolder(setId, holder.peerId, holder.username);
    }

    // Apply dice values from roll history
    if (snapshot.rollHistory && snapshot.rollHistory.length > 0) {
      const latestRoll = snapshot.rollHistory[0];
      if (latestRoll.setResults) {
        for (const sr of latestRoll.setResults) {
          // Use applyRoll which sets values and lastRoller together
          this.#diceStore.applyRoll({
            setId: sr.setId,
            values: sr.values,
            playerId: sr.holderId,
            username: sr.holderUsername,
          });
        }
      }
    }

    // Apply locks (note: DiceStore stores Set of indices, not Map of index -> value)
    if (snapshot.lockedDice) {
      for (const lock of snapshot.lockedDice) {
        for (const index of lock.lockedIndices) {
          this.#diceStore.setLock(lock.setId, index, true);
        }
      }
    }
  }

  /**
   * Apply new DiceStore state to legacy MeshState.
   */
  #applyNewStateToLegacy() {
    // Apply dice config
    const config = this.#diceStore.diceConfig;
    if (config) {
      this.#meshState.setDiceConfig(config);
    }

    // Apply holders
    this.#meshState.clearAllHolders();
    for (const [setId, holder] of this.#diceStore.holders) {
      this.#meshState.setHolder(setId, holder.playerId, holder.username);
    }

    // Apply last roller
    for (const [setId, roller] of this.#diceStore.lastRoller) {
      this.#meshState.setLastRoller(setId, roller.playerId, roller.username);
    }

    // Apply locks (DiceStore stores Set of indices, need to get values from diceValues)
    for (const [setId, lockedIndices] of this.#diceStore.lockedDice) {
      this.#meshState.clearLocksForSet(setId);
      const values = this.#diceStore.diceValues.get(setId) || [];
      for (const index of lockedIndices) {
        const value = values[index] || 1;
        this.#meshState.lockDie(setId, index, value);
      }
    }
  }

  /**
   * Enable two-way sync between legacy and new systems.
   * Changes in either system are reflected in the other.
   */
  enableTwoWaySync() {
    // Listen to new DiceStore changes
    const storeUnsub = this.#diceStore.subscribe(() => {
      if (this.#isSyncing) return;
      this.#isSyncing = true;
      try {
        this.#applyNewStateToLegacy();
      } finally {
        this.#isSyncing = false;
      }
    });
    this.#unsubscribers.push(storeUnsub);

    // Listen to legacy MeshState events
    const peerAddedHandler = (e) => {
      if (this.#isSyncing) return;
      // Peer events don't directly affect dice state
    };

    this.#meshState.addEventListener('peer-added', peerAddedHandler);
    this.#unsubscribers.push(() =>
      this.#meshState.removeEventListener('peer-added', peerAddedHandler)
    );
  }

  /**
   * Disable two-way sync.
   */
  disableSync() {
    for (const unsub of this.#unsubscribers) {
      unsub();
    }
    this.#unsubscribers = [];
  }

  /**
   * Convert a legacy roll message to new format.
   *
   * @param {object} legacyRoll - Legacy roll message
   * @returns {object} New format roll result
   */
  static convertRollMessage(legacyRoll) {
    const result = {
      rollId: legacyRoll.rollId,
      timestamp: legacyRoll.timestamp,
      total: legacyRoll.total,
      setResults: [],
    };

    for (const sr of legacyRoll.setResults || []) {
      result.setResults.push({
        setId: sr.setId,
        values: sr.values,
        playerId: sr.holderId,
        username: sr.holderUsername,
        color: sr.color,
      });
    }

    return result;
  }

  /**
   * Convert a new roll result to legacy format.
   *
   * @param {object} newRoll - New format roll result
   * @returns {object} Legacy roll message
   */
  static convertToLegacyRoll(newRoll) {
    const result = {
      rollId: newRoll.rollId || `roll-${Date.now()}`,
      timestamp: newRoll.timestamp || Date.now(),
      total: newRoll.total || 0,
      setResults: [],
      lockedDice: newRoll.lockedDice || [],
    };

    // Handle single set result
    if (newRoll.setId && newRoll.values) {
      result.setResults.push({
        setId: newRoll.setId,
        values: newRoll.values,
        holderId: newRoll.playerId,
        holderUsername: newRoll.username,
      });
      result.total = newRoll.values.reduce((a, b) => a + b, 0);
    }

    // Handle multiple set results
    for (const sr of newRoll.setResults || []) {
      result.setResults.push({
        setId: sr.setId,
        values: sr.values,
        holderId: sr.playerId,
        holderUsername: sr.username,
        color: sr.color,
      });
    }

    return result;
  }

  /**
   * Convert a legacy grab message to new format.
   *
   * @param {object} legacyGrab - Legacy grab message
   * @returns {object} New format grab
   */
  static convertGrabMessage(legacyGrab) {
    return {
      setId: legacyGrab.setId,
      playerId: legacyGrab.peerId,
      username: legacyGrab.username,
    };
  }

  /**
   * Convert a new grab to legacy format.
   *
   * @param {object} newGrab - New format grab
   * @returns {object} Legacy grab message
   */
  static convertToLegacyGrab(newGrab) {
    return {
      setId: newGrab.setId,
      peerId: newGrab.playerId,
      username: newGrab.username,
    };
  }
}
