/**
 * DiceStateManager - Manages dice configuration, holders, and roll state
 */
export class DiceStateManager extends EventTarget {
  constructor() {
    super();
    this.diceSettings = {
      diceSets: [{ id: 'set-1', count: 2, color: '#ffffff' }]
    };
    this.holders = new Map(); // setId -> { peerId, username }
    this.pendingRolls = new Set(); // For duplicate prevention
  }

  /**
   * Get current dice settings
   */
  getSettings() {
    return this.diceSettings;
  }

  /**
   * Set dice settings
   */
  setSettings(settings) {
    if (settings && settings.diceSets) {
      this.diceSettings = settings;
    } else {
      // Migrate from old format
      this.diceSettings = {
        diceSets: [{ id: 'set-1', count: settings?.count || 2, color: '#ffffff' }]
      };
    }
    this.dispatchEvent(new CustomEvent('settings-changed', { detail: this.diceSettings }));
  }

  /**
   * Reset dice settings to default
   */
  reset() {
    this.diceSettings = {
      diceSets: [{ id: 'set-1', count: 2, color: '#ffffff' }]
    };
    this.holders.clear();
    this.pendingRolls.clear();
    this.dispatchEvent(new CustomEvent('reset'));
  }

  /**
   * Get all holders
   */
  getHolders() {
    return this.holders;
  }

  /**
   * Get holder for a specific dice set
   */
  getHolder(setId) {
    return this.holders.get(setId) || null;
  }

  /**
   * Set holder for a dice set
   */
  setHolder(setId, peerId, username) {
    this.holders.set(setId, { peerId, username });
    this.dispatchEvent(new CustomEvent('holder-changed', {
      detail: { setId, peerId, username }
    }));
  }

  /**
   * Clear holder for a specific dice set
   */
  clearHolder(setId) {
    this.holders.delete(setId);
    this.dispatchEvent(new CustomEvent('holder-changed', {
      detail: { setId, peerId: null, username: null }
    }));
  }

  /**
   * Clear all holders
   */
  clearAllHolders() {
    this.holders.clear();
    this.dispatchEvent(new CustomEvent('holders-cleared'));
  }

  /**
   * Check if a specific set is held
   */
  isSetHeld(setId) {
    return this.holders.has(setId);
  }

  /**
   * Check if a peer is holding any dice sets
   */
  isPeerHolding(peerId) {
    for (const holder of this.holders.values()) {
      if (holder.peerId === peerId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all sets held by a specific peer
   */
  getSetsHeldByPeer(peerId) {
    const sets = [];
    for (const [setId, holder] of this.holders) {
      if (holder.peerId === peerId) {
        sets.push(setId);
      }
    }
    return sets;
  }

  /**
   * Load holders from an array (for syncing from host)
   */
  loadHolders(holdersArray) {
    this.holders.clear();
    if (holdersArray) {
      for (const [setId, holder] of holdersArray) {
        this.holders.set(setId, holder);
      }
    }
  }

  /**
   * Add a pending roll (for duplicate prevention)
   */
  addPendingRoll(rollId) {
    this.pendingRolls.add(rollId);
    // Auto-cleanup after timeout
    setTimeout(() => {
      this.pendingRolls.delete(rollId);
    }, 10000);
  }

  /**
   * Check if a roll is pending
   */
  isPendingRoll(rollId) {
    return this.pendingRolls.has(rollId);
  }

  /**
   * Remove a pending roll
   */
  removePendingRoll(rollId) {
    this.pendingRolls.delete(rollId);
  }

  /**
   * Generate a unique roll ID
   */
  generateRollId(peerId) {
    return `${peerId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Build set results with holder info for a roll
   */
  buildSetResults(rollResults, peerId, username) {
    const setResults = [];
    for (const set of this.diceSettings.diceSets) {
      const values = rollResults[set.id] || [];
      const holder = this.getHolder(set.id);
      setResults.push({
        setId: set.id,
        color: set.color,
        values,
        holderId: holder?.peerId || peerId,
        holderUsername: holder?.username || username
      });
    }
    return setResults;
  }

  /**
   * Build set results using provided holders snapshot
   */
  buildSetResultsWithHolders(rollResults, holdersSnapshot, peerId, username) {
    const setResults = [];
    for (const set of this.diceSettings.diceSets) {
      const values = rollResults[set.id] || [];
      const holderEntry = holdersSnapshot?.find(([setId]) => setId === set.id);
      const holder = holderEntry ? holderEntry[1] : this.getHolder(set.id);
      setResults.push({
        setId: set.id,
        color: set.color,
        values,
        holderId: holder?.peerId || peerId,
        holderUsername: holder?.username || username
      });
    }
    return setResults;
  }
}
