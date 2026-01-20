/**
 * RoomHost - Manages room state when this client is the host
 * Handles peer management, state sync, and broadcasts
 */
export class RoomHost extends EventTarget {
  constructor() {
    super();
    // Room state - authoritative when we're the host
    this.peers = new Map(); // peerId -> { username, joinOrder, dataChannel }
    this.rollHistory = [];
    this.joinCounter = 0;
    this.maxHistorySize = 100;

    // Dice configuration (host-controlled) - multiple dice sets with colors
    this.diceConfig = {
      diceSets: [
        { id: 'set-1', count: 2, color: '#6366f1' }  // Default: 2 purple dice
      ]
    };

    // Who is holding each dice set: setId -> { peerId, username }
    this.holders = new Map();
  }

  // Add a peer to the room
  addPeer(peerId, username, dataChannel = null) {
    this.peers.set(peerId, {
      username,
      joinOrder: this.joinCounter++,
      dataChannel
    });

    this.dispatchEvent(new CustomEvent('peer-added', {
      detail: { peerId, username }
    }));
  }

  // Update peer's data channel
  setPeerChannel(peerId, dataChannel) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.dataChannel = dataChannel;
    }
  }

  // Remove a peer from the room
  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      this.peers.delete(peerId);
      this.dispatchEvent(new CustomEvent('peer-removed', {
        detail: { peerId, username: peer.username }
      }));
    }
  }

  // Add a dice roll to history
  addRoll(roll) {
    this.rollHistory.unshift(roll);
    // Use pop() for O(1) removal instead of slice() which creates a new array
    while (this.rollHistory.length > this.maxHistorySize) {
      this.rollHistory.pop();
    }
  }

  // Get full room state for syncing to new peers
  getState() {
    return {
      peers: Array.from(this.peers.entries()).map(([peerId, data]) => ({
        peerId,
        username: data.username,
        joinOrder: data.joinOrder
      })),
      rollHistory: this.rollHistory.slice(0, 50), // Send last 50 rolls
      diceConfig: this.diceConfig,
      holders: Array.from(this.holders.entries()) // Convert Map to array for serialization
    };
  }

  // Load state (when receiving from host or during migration)
  loadState(state) {
    this.peers.clear();
    this.rollHistory = state.rollHistory || [];
    // Handle both old format (count) and new format (diceSets)
    if (state.diceConfig && state.diceConfig.diceSets) {
      this.diceConfig = state.diceConfig;
    } else {
      // Migrate from old format
      this.diceConfig = {
        diceSets: [{ id: 'set-1', count: state.diceConfig?.count || 2, color: '#6366f1' }]
      };
    }

    // Load holders map
    this.holders.clear();
    if (state.holders) {
      for (const [setId, holder] of state.holders) {
        this.holders.set(setId, holder);
      }
    }

    // Find highest join order to continue from
    let maxJoinOrder = 0;
    for (const peer of (state.peers || [])) {
      this.peers.set(peer.peerId, {
        username: peer.username,
        joinOrder: peer.joinOrder,
        dataChannel: null
      });
      maxJoinOrder = Math.max(maxJoinOrder, peer.joinOrder);
    }
    this.joinCounter = maxJoinOrder + 1;
  }

  // Set dice configuration (host only)
  setDiceConfig(config) {
    this.diceConfig = config;
  }

  // Set who is holding a specific dice set
  setHolder(setId, peerId, username) {
    this.holders.set(setId, { peerId, username });
  }

  // Clear a specific holder (after they roll)
  clearHolder(setId) {
    this.holders.delete(setId);
  }

  // Clear all holders
  clearAllHolders() {
    this.holders.clear();
  }

  // Get holder for a specific set
  getHolder(setId) {
    return this.holders.get(setId) || null;
  }

  // Check if all sets are held
  allSetsHeld() {
    return this.diceConfig.diceSets.every(set => this.holders.has(set.id));
  }

  // Get list of sets held by a specific peer
  getSetsHeldByPeer(peerId) {
    const sets = [];
    for (const [setId, holder] of this.holders) {
      if (holder.peerId === peerId) {
        sets.push(setId);
      }
    }
    return sets;
  }

  // Get the next host candidate (peer with lowest join order)
  getNextHostCandidate(excludePeerId = null) {
    let candidate = null;
    let lowestOrder = Infinity;

    for (const [peerId, data] of this.peers) {
      if (peerId !== excludePeerId && data.joinOrder < lowestOrder) {
        lowestOrder = data.joinOrder;
        candidate = { peerId, username: data.username };
      }
    }

    return candidate;
  }

  // Send message to a specific peer
  sendToPeer(peerId, message) {
    const peer = this.peers.get(peerId);
    if (peer && peer.dataChannel && peer.dataChannel.readyState === 'open') {
      peer.dataChannel.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  // Broadcast message to all peers
  broadcast(message, excludePeerId = null) {
    for (const [peerId, peer] of this.peers) {
      if (peerId !== excludePeerId && peer.dataChannel && peer.dataChannel.readyState === 'open') {
        peer.dataChannel.send(JSON.stringify(message));
      }
    }
  }

  // Get peer list for UI
  getPeerList() {
    return Array.from(this.peers.entries()).map(([peerId, data]) => ({
      peerId,
      username: data.username,
      connected: data.dataChannel && data.dataChannel.readyState === 'open'
    }));
  }

  // Clear all state
  clear() {
    this.peers.clear();
    this.rollHistory = [];
    this.joinCounter = 0;
    this.diceConfig = {
      diceSets: [{ id: 'set-1', count: 2, color: '#6366f1' }]
    };
    this.holders.clear();
  }
}
