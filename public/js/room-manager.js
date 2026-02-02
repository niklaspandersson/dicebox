/**
 * RoomManager - Handles room lifecycle for mesh topology
 * All peers are equal - no host/client distinction
 */
import { signalingClient } from "./signaling-client.js";
import { webrtcManager } from "./webrtc-manager.js";
import { MeshState } from "./mesh-state.js";

export class RoomManager extends EventTarget {
  constructor() {
    super();
    this.roomId = null;
    this.username = null;
    this.meshState = new MeshState();
    this.pendingConnections = new Set(); // Peers we're trying to connect to
    this.receivedStateFrom = null; // Track which peer gave us initial state
  }

  /**
   * Create a new room
   */
  createRoom(roomId, username, myPeerId, serverConnected, diceConfig) {
    this.roomId = roomId;
    this.username = username;

    // Initialize mesh state
    this.meshState.clear();
    this.meshState.setDiceConfig(diceConfig);
    this.meshState.addPeer(myPeerId, username);

    // Register room with server
    if (serverConnected) {
      signalingClient.createRoom(roomId, diceConfig);
    }

    console.log(
      `Created room ${roomId} (server ${serverConnected ? "connected" : "offline"})`,
    );
    this.dispatchEvent(
      new CustomEvent("room-created", {
        detail: { roomId },
      }),
    );
  }

  /**
   * Join an existing room
   */
  joinRoom(roomId, username, serverConnected) {
    if (!serverConnected) {
      this.dispatchEvent(
        new CustomEvent("join-failed", {
          detail: { reason: "Cannot join room - no server connection" },
        }),
      );
      return false;
    }

    this.roomId = roomId;
    this.username = username;
    this.receivedStateFrom = null;

    // Query room to get list of peers
    signalingClient.queryRoom(roomId);
    return true;
  }

  /**
   * Handle room info response from server
   */
  handleRoomInfo({ roomId, exists, peerIds, diceConfig }) {
    if (roomId !== this.roomId) return;

    if (exists && peerIds && peerIds.length > 0) {
      console.log(
        `Room ${roomId} exists with ${peerIds.length} peers, joining...`,
      );

      // Set dice config from room
      if (diceConfig) {
        this.meshState.setDiceConfig(diceConfig);
      }

      // Join the room via signaling
      signalingClient.joinRoom(roomId);
    } else {
      this.dispatchEvent(
        new CustomEvent("join-failed", {
          detail: { reason: exists ? "Room is empty" : "Room not found" },
        }),
      );
      this.roomId = null;
    }
  }

  /**
   * Handle successful room join - connect to all peers
   */
  handleJoinRoomSuccess({ roomId, peerIds, diceConfig }) {
    console.log(`Joined room ${roomId}, connecting to ${peerIds.length} peers`);

    // Set dice config
    if (diceConfig) {
      this.meshState.setDiceConfig(diceConfig);
    }

    // Connect to all existing peers
    this.pendingConnections = new Set(peerIds);
    for (const peerId of peerIds) {
      webrtcManager.connectToPeer(peerId);
    }

    this.dispatchEvent(
      new CustomEvent("room-joined", {
        detail: { roomId, peerIds, diceConfig },
      }),
    );
  }

  /**
   * Handle room creation confirmation
   */
  handleCreateRoomSuccess({ roomId }) {
    console.log(`Room ${roomId} created successfully`);
    this.dispatchEvent(
      new CustomEvent("create-room-success", { detail: { roomId } }),
    );
  }

  /**
   * Handle room creation failure
   */
  handleCreateRoomFailed({ roomId, reason }) {
    console.error("Failed to create room:", reason);
    this.dispatchEvent(
      new CustomEvent("create-room-failed", { detail: { roomId, reason } }),
    );
  }

  /**
   * Handle notification that a peer is joining (for existing room members)
   */
  handlePeerJoining({ peerId, roomId }) {
    if (roomId !== this.roomId) return;
    console.log(`Peer ${peerId} is joining room`);
    // We'll receive their HELLO message when WebRTC connects
  }

  /**
   * Handle peer disconnection notification from server
   */
  handlePeerDisconnected({ peerId, roomId }) {
    if (roomId !== this.roomId) return;

    const peer = this.meshState.getPeer(peerId);
    if (peer) {
      this.meshState.removePeer(peerId);
      this.dispatchEvent(
        new CustomEvent("peer-left", {
          detail: { peerId, username: peer.username },
        }),
      );
    }
  }

  /**
   * Handle peer reconnection notification from server
   */
  handlePeerReconnected({ peerId, roomId }) {
    if (roomId !== this.roomId) return;
    console.log(`Peer ${peerId} reconnected to room`);

    // Reconnect WebRTC to this peer if we're not already connected
    if (!webrtcManager.isConnectedTo(peerId)) {
      webrtcManager.connectToPeer(peerId);
    }
  }

  /**
   * Leave the current room
   */
  leaveRoom() {
    const oldRoomId = this.roomId;

    // Clean up
    signalingClient.leaveRoom();
    webrtcManager.closeAll();

    // Reset state
    this.roomId = null;
    this.meshState.clear();
    this.pendingConnections.clear();
    this.receivedStateFrom = null;

    console.log(`Left room ${oldRoomId}`);
    this.dispatchEvent(
      new CustomEvent("room-left", {
        detail: { roomId: oldRoomId },
      }),
    );
  }

  /**
   * Get mesh state object
   */
  getMeshState() {
    return this.meshState;
  }

  /**
   * Check if in a room
   */
  inRoom() {
    return this.roomId !== null;
  }

  /**
   * Mark that we've received state from a peer
   */
  setReceivedStateFrom(peerId) {
    this.receivedStateFrom = peerId;
  }

  /**
   * Check if we've received initial state
   */
  hasReceivedState() {
    return this.receivedStateFrom !== null;
  }

  /**
   * Remove peer from pending connections
   */
  markPeerConnected(peerId) {
    this.pendingConnections.delete(peerId);
  }

  /**
   * Check if we have pending connections
   */
  hasPendingConnections() {
    return this.pendingConnections.size > 0;
  }

  /**
   * Setup signaling server event listeners for room events
   */
  setupSignalingEvents(callbacks) {
    signalingClient.addEventListener("room-info", (e) => {
      this.handleRoomInfo(e.detail);
    });

    signalingClient.addEventListener("create-room-success", (e) => {
      this.handleCreateRoomSuccess(e.detail);
    });

    signalingClient.addEventListener("create-room-failed", (e) => {
      this.handleCreateRoomFailed(e.detail);
      callbacks.onCreateRoomFailed?.(e.detail);
    });

    signalingClient.addEventListener("join-room-success", (e) => {
      this.handleJoinRoomSuccess(e.detail);
    });

    signalingClient.addEventListener("join-room-failed", (e) => {
      console.error("Failed to join room:", e.detail.reason);
      this.dispatchEvent(new CustomEvent("join-failed", { detail: e.detail }));
      callbacks.onJoinFailed?.(e.detail);
    });

    signalingClient.addEventListener("peer-joining", (e) => {
      this.handlePeerJoining(e.detail);
      callbacks.onPeerJoining?.(e.detail);
    });

    signalingClient.addEventListener("peer-disconnected", (e) => {
      this.handlePeerDisconnected(e.detail);
      callbacks.onPeerDisconnected?.(e.detail);
    });

    signalingClient.addEventListener("peer-reconnected", (e) => {
      this.handlePeerReconnected(e.detail);
      callbacks.onPeerReconnected?.(e.detail);
    });

    signalingClient.addEventListener("peer-left", (e) => {
      this.handlePeerDisconnected(e.detail); // Same handling
      callbacks.onPeerLeft?.(e.detail);
    });

    signalingClient.addEventListener("session-restored", (e) => {
      const { roomId } = e.detail;
      console.log(`Session restored, previous room: ${roomId}`);
      if (roomId) {
        this.roomId = roomId;
      }
      this.dispatchEvent(
        new CustomEvent("session-restored", { detail: e.detail }),
      );
      callbacks.onSessionRestored?.(e.detail);
    });
  }
}
