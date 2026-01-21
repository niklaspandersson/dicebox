/**
 * RoomManager - Handles room lifecycle (create/join/leave)
 */
import { signalingClient } from './signaling-client.js';
import { webrtcManager } from './webrtc-manager.js';
import { RoomHost } from './room-host.js';

export class RoomManager extends EventTarget {
  constructor() {
    super();
    this.roomId = null;
    this.username = null;
    this.isHost = false;
    this.hostPeerId = null;
    this.myJoinOrder = 0;
    this.roomState = new RoomHost();
  }

  /**
   * Create a new room as host
   */
  createRoom(roomId, username, effectiveId, serverConnected) {
    this.roomId = roomId;
    this.username = username;
    this.isHost = true;
    this.hostPeerId = effectiveId;
    this.myJoinOrder = 0;

    // Initialize room state
    this.roomState.clear();

    // If server is connected, register as host
    if (serverConnected) {
      signalingClient.registerHost(roomId);
    }

    console.log(`Created room ${roomId} as host (server ${serverConnected ? 'connected' : 'offline'})`);
    this.dispatchEvent(new CustomEvent('room-created', {
      detail: { roomId, isHost: true }
    }));
  }

  /**
   * Join an existing room (requires server)
   */
  joinRoom(roomId, username, serverConnected) {
    if (!serverConnected) {
      this.dispatchEvent(new CustomEvent('join-failed', {
        detail: { reason: 'Cannot join room - no server connection' }
      }));
      return false;
    }

    this.roomId = roomId;
    this.username = username;
    this.isHost = false;

    // Query server to find the host
    signalingClient.queryRoom(roomId);
    return true;
  }

  /**
   * Handle room info response from server
   */
  handleRoomInfo({ roomId, exists, hostPeerId }) {
    if (roomId !== this.roomId) return;

    if (exists) {
      console.log(`Room ${roomId} exists, joining as client. Host: ${hostPeerId}`);
      this.hostPeerId = hostPeerId;
      signalingClient.joinRoom(roomId);
    } else {
      this.dispatchEvent(new CustomEvent('join-failed', {
        detail: { reason: 'Room not found' }
      }));
      this.roomId = null;
    }
  }

  /**
   * Handle successful room join
   */
  handleJoinRoomSuccess({ roomId, hostPeerId }) {
    console.log(`Joined room ${roomId}, connecting to host ${hostPeerId}`);
    this.hostPeerId = hostPeerId;

    // Initiate WebRTC connection to host
    webrtcManager.connectToPeer(hostPeerId);

    this.dispatchEvent(new CustomEvent('room-joined', {
      detail: { roomId, hostPeerId }
    }));
  }

  /**
   * Handle host registration confirmation
   */
  handleHostRegistered({ roomId }) {
    console.log(`Registered as host for room ${roomId} with server`);
    this.dispatchEvent(new CustomEvent('host-registered', { detail: { roomId } }));
  }

  /**
   * Leave the current room
   */
  leaveRoom() {
    const wasHost = this.isHost;
    const oldRoomId = this.roomId;

    // Clean up
    signalingClient.leaveRoom();
    webrtcManager.closeAll();

    // Reset state
    this.roomId = null;
    this.isHost = false;
    this.hostPeerId = null;
    this.roomState.clear();
    this.myJoinOrder = 0;

    console.log(`Left room ${oldRoomId}`);
    this.dispatchEvent(new CustomEvent('room-left', {
      detail: { roomId: oldRoomId, wasHost }
    }));
  }

  /**
   * Become the new host (after migration)
   */
  becomeHost(peerId) {
    console.log('Successfully became new host');
    this.isHost = true;
    this.hostPeerId = peerId;

    this.dispatchEvent(new CustomEvent('became-host', {
      detail: { peerId }
    }));
  }

  /**
   * Update host peer ID (when host changes)
   */
  setHostPeerId(peerId) {
    this.hostPeerId = peerId;
  }

  /**
   * Set join order
   */
  setJoinOrder(order) {
    this.myJoinOrder = order;
  }

  /**
   * Get room state object
   */
  getRoomState() {
    return this.roomState;
  }

  /**
   * Check if in a room
   */
  inRoom() {
    return this.roomId !== null;
  }

  /**
   * Setup signaling server event listeners for room events
   */
  setupSignalingEvents(callbacks) {
    signalingClient.addEventListener('room-info', (e) => {
      this.handleRoomInfo(e.detail);
    });

    signalingClient.addEventListener('register-host-success', (e) => {
      this.handleHostRegistered(e.detail);
    });

    signalingClient.addEventListener('register-host-failed', (e) => {
      console.error('Failed to register as host:', e.detail.reason);
      this.dispatchEvent(new CustomEvent('register-host-failed', { detail: e.detail }));
      callbacks.onRegisterHostFailed?.(e.detail);
    });

    signalingClient.addEventListener('join-room-success', (e) => {
      this.handleJoinRoomSuccess(e.detail);
    });

    signalingClient.addEventListener('join-room-failed', (e) => {
      console.error('Failed to join room:', e.detail.reason);
      this.dispatchEvent(new CustomEvent('join-failed', { detail: e.detail }));
      callbacks.onJoinFailed?.(e.detail);
    });

    signalingClient.addEventListener('peer-connecting', (e) => {
      if (this.isHost) {
        console.log(`Peer ${e.detail.peerId} wants to connect`);
        this.dispatchEvent(new CustomEvent('peer-connecting', { detail: e.detail }));
        callbacks.onPeerConnecting?.(e.detail);
      }
    });

    signalingClient.addEventListener('claim-host-success', (e) => {
      this.dispatchEvent(new CustomEvent('claim-host-success', { detail: e.detail }));
      callbacks.onClaimHostSuccess?.(e.detail);
    });

    signalingClient.addEventListener('claim-host-failed', (e) => {
      console.log('Another peer claimed host');
      this.dispatchEvent(new CustomEvent('claim-host-failed', { detail: e.detail }));
      callbacks.onClaimHostFailed?.(e.detail);
    });
  }
}
