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
    if (this.rollHistory.length > this.maxHistorySize) {
      this.rollHistory = this.rollHistory.slice(0, this.maxHistorySize);
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
      rollHistory: this.rollHistory.slice(0, 50) // Send last 50 rolls
    };
  }

  // Load state (when receiving from host or during migration)
  loadState(state) {
    this.peers.clear();
    this.rollHistory = state.rollHistory || [];

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
  }
}
