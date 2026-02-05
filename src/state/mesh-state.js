/**
 * MeshState - Manages local state in mesh topology
 * Each peer maintains their own copy, synchronized via broadcast messages
 */
export class MeshState extends EventTarget {
  constructor() {
    super();
    this.peers = new Map(); // peerId -> { username, connectedAt }
    this.rollHistory = []; // Recent rolls
    this.diceConfig = null; // Immutable, set at room creation
    this.holders = new Map(); // setId -> { peerId, username }
    this.maxHistorySize = 100;
    this.knownRollIds = new Set(); // For deduplication

    this.lastRoller = new Map(); // setId -> { peerId, username } - who last rolled this set
  }

  // === Peer Management ===

  addPeer(peerId, username) {
    if (this.peers.has(peerId)) return false;

    this.peers.set(peerId, {
      username,
      connectedAt: Date.now(),
    });

    this.dispatchEvent(
      new CustomEvent("peer-added", {
        detail: { peerId, username },
      }),
    );
    return true;
  }

  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return false;

    this.peers.delete(peerId);

    // Clear any dice sets held by this peer
    for (const [setId, holder] of this.holders) {
      if (holder.peerId === peerId) {
        this.holders.delete(setId);
      }
    }

    this.dispatchEvent(
      new CustomEvent("peer-removed", {
        detail: { peerId, username: peer.username },
      }),
    );
    return true;
  }

  getPeer(peerId) {
    return this.peers.get(peerId) || null;
  }

  getPeerList() {
    return Array.from(this.peers.entries()).map(([peerId, data]) => ({
      peerId,
      username: data.username,
      connectedAt: data.connectedAt,
    }));
  }

  // === Dice Configuration ===

  setDiceConfig(config) {
    this.diceConfig = config;
  }

  getDiceConfig() {
    return this.diceConfig;
  }

  // === Roll History ===

  addRoll(roll) {
    // Deduplication
    if (this.knownRollIds.has(roll.rollId)) {
      return false;
    }

    this.knownRollIds.add(roll.rollId);
    this.rollHistory.unshift(roll);

    // Trim history
    while (this.rollHistory.length > this.maxHistorySize) {
      const removed = this.rollHistory.pop();
      this.knownRollIds.delete(removed.rollId);
    }

    return true;
  }

  hasRoll(rollId) {
    return this.knownRollIds.has(rollId);
  }

  getRollHistory() {
    return this.rollHistory;
  }

  // === Holder Management ===

  /**
   * Try to grab a dice set. Returns true if successful.
   * First-come-first-served - fails if already held.
   */
  tryGrab(setId, peerId, username) {
    if (this.holders.has(setId)) {
      return false;
    }
    this.holders.set(setId, { peerId, username });
    return true;
  }

  /**
   * Set holder directly (for receiving broadcast)
   */
  setHolder(setId, peerId, username) {
    this.holders.set(setId, { peerId, username });
  }

  /**
   * Drop a dice set. Only the holder can drop.
   */
  drop(setId, peerId) {
    const holder = this.holders.get(setId);
    if (holder?.peerId === peerId) {
      this.holders.delete(setId);
      return true;
    }
    return false;
  }

  /**
   * Clear holder for a set (for receiving broadcast)
   */
  clearHolder(setId) {
    this.holders.delete(setId);
  }

  clearAllHolders() {
    this.holders.clear();
  }

  getHolder(setId) {
    return this.holders.get(setId) || null;
  }

  getHolders() {
    return this.holders;
  }

  isSetHeld(setId) {
    return this.holders.has(setId);
  }

  getSetsHeldByPeer(peerId) {
    const sets = [];
    for (const [setId, holder] of this.holders) {
      if (holder.peerId === peerId) {
        sets.push(setId);
      }
    }
    return sets;
  }

  isPeerHolding(peerId) {
    for (const holder of this.holders.values()) {
      if (holder.peerId === peerId) return true;
    }
    return false;
  }

  /**
   * Set the last roller for a set
   */
  setLastRoller(setId, peerId, username) {
    this.lastRoller.set(setId, { peerId, username });
  }

  /**
   * Get the last roller for a set
   */
  getLastRoller(setId) {
    return this.lastRoller.get(setId) || null;
  }

  /**
   * Clear last roller for a set (when someone else grabs or rolls)
   */
  clearLastRoller(setId) {
    this.lastRoller.delete(setId);
  }

  /**
   * Clear all last rollers
   */
  clearAllLastRollers() {
    this.lastRoller.clear();
  }

  // === State Snapshots ===

  /**
   * Get full state snapshot for syncing to new peers
   */
  getSnapshot() {
    return {
      peers: Array.from(this.peers.entries()).map(([peerId, data]) => ({
        peerId,
        username: data.username,
        connectedAt: data.connectedAt,
      })),
      rollHistory: this.rollHistory.slice(0, 50),
      diceConfig: this.diceConfig,
      holders: Array.from(this.holders.entries()),
      lastRoller: Array.from(this.lastRoller.entries()),
    };
  }

  /**
   * Load state from snapshot (when joining room)
   */
  loadSnapshot(snapshot) {
    // Load peers
    this.peers.clear();
    for (const peer of snapshot.peers || []) {
      this.peers.set(peer.peerId, {
        username: peer.username,
        connectedAt: peer.connectedAt || Date.now(),
      });
    }

    // Load roll history
    this.rollHistory = snapshot.rollHistory || [];
    this.knownRollIds.clear();
    for (const roll of this.rollHistory) {
      this.knownRollIds.add(roll.rollId);
    }

    // Load dice config
    if (snapshot.diceConfig) {
      this.diceConfig = snapshot.diceConfig;
    }

    // Load holders
    this.holders.clear();
    if (snapshot.holders) {
      for (const [setId, holder] of snapshot.holders) {
        this.holders.set(setId, holder);
      }
    }

    // Load last roller state
    this.lastRoller.clear();
    if (snapshot.lastRoller) {
      for (const [setId, roller] of snapshot.lastRoller) {
        this.lastRoller.set(setId, roller);
      }
    }
  }

  // === Reset ===

  clear() {
    this.peers.clear();
    this.rollHistory = [];
    this.knownRollIds.clear();
    this.diceConfig = null;
    this.holders.clear();
    this.lastRoller.clear();
  }
}
