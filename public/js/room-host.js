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

    // Dice configuration (host-controlled)
    this.diceConfig = {
      count: 1  // Number of d6 dice
    };

    // Who is currently holding the dice (null if no one)
    this.holderPeerId = null;
    this.holderUsername = null;
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
      holderPeerId: this.holderPeerId,
      holderUsername: this.holderUsername
    };
  }

  // Load state (when receiving from host or during migration)
  loadState(state) {
    this.peers.clear();
    this.rollHistory = state.rollHistory || [];
    this.diceConfig = state.diceConfig || { count: 1 };
    this.holderPeerId = state.holderPeerId || null;
    this.holderUsername = state.holderUsername || null;

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
    this.diceConfig = { ...this.diceConfig, ...config };
  }

  // Set who is holding the dice
  setHolder(peerId, username) {
    this.holderPeerId = peerId;
    this.holderUsername = username;
  }

  // Clear the holder (after a roll)
  clearHolder() {
    this.holderPeerId = null;
    this.holderUsername = null;
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
    this.diceConfig = { count: 1 };
    this.holderPeerId = null;
    this.holderUsername = null;
  }
}
