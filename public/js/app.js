/**
 * DiceBox - Main Application
 * Connects all components and manages application state
 */
import { signalingClient } from './signaling-client.js';
import { webrtcManager } from './webrtc-manager.js';

class DiceBoxApp {
  constructor() {
    this.peerId = null;
    this.username = null;
    this.roomId = null;

    this.roomJoin = document.querySelector('room-join');
    this.roomView = document.querySelector('room-view');
    this.diceRoller = null;
    this.diceHistory = null;
    this.peerList = null;

    this.init();
  }

  async init() {
    this.setupEventListeners();
    await this.connectToSignalingServer();
  }

  async connectToSignalingServer() {
    try {
      await signalingClient.connect();
      console.log('Connected to signaling server');
    } catch (error) {
      console.error('Failed to connect to signaling server:', error);
      this.showConnectionError();
    }
  }

  showConnectionError() {
    const status = document.createElement('div');
    status.className = 'connection-status disconnected';
    status.textContent = 'Connection failed. Retrying...';
    document.body.appendChild(status);
  }

  setupEventListeners() {
    // Room join events
    document.addEventListener('join-room', (e) => {
      this.joinRoom(e.detail.roomId, e.detail.username);
    });

    document.addEventListener('leave-room', () => {
      this.leaveRoom();
    });

    // Dice roll events
    document.addEventListener('dice-rolled', (e) => {
      this.handleLocalDiceRoll(e.detail);
    });

    // Signaling events
    signalingClient.addEventListener('joined', (e) => {
      this.handleJoined(e.detail);
    });

    signalingClient.addEventListener('peer-joined', (e) => {
      this.handlePeerJoined(e.detail);
    });

    signalingClient.addEventListener('peer-left', (e) => {
      this.handlePeerLeft(e.detail);
    });

    signalingClient.addEventListener('dice-roll', (e) => {
      this.handleRemoteDiceRoll(e.detail);
    });

    signalingClient.addEventListener('disconnected', () => {
      console.log('Disconnected from server');
    });

    // WebRTC events
    webrtcManager.addEventListener('connection-state-change', (e) => {
      const { peerId, state } = e.detail;
      if (this.peerList) {
        this.peerList.updatePeerStatus(peerId, state === 'connected' ? 'connected' : 'connecting');
      }
    });
  }

  joinRoom(roomId, username) {
    this.roomId = roomId;
    this.username = username;

    signalingClient.joinRoom(roomId, username);
  }

  handleJoined({ peerId, roomId, peers }) {
    this.peerId = peerId;
    this.roomId = roomId;

    // Hide join form, show room view
    this.roomJoin.style.display = 'none';
    this.roomView.show();
    this.roomView.setRoomId(roomId);

    // Get component references
    this.diceRoller = this.roomView.querySelector('dice-roller');
    this.diceHistory = this.roomView.querySelector('dice-history');
    this.peerList = this.roomView.querySelector('peer-list');

    // Set up peer list
    this.peerList.setSelf(peerId, this.username);
    this.diceHistory.peerId = peerId;

    // Add existing peers
    for (const peer of peers) {
      this.peerList.addPeer(peer.peerId, peer.username, 'connecting');
    }

    console.log(`Joined room ${roomId} as ${this.username} (${peerId})`);
    console.log(`Found ${peers.length} existing peers`);
  }

  handlePeerJoined({ peerId, username }) {
    if (this.peerList) {
      this.peerList.addPeer(peerId, username, 'connecting');
    }
    console.log(`Peer joined: ${username} (${peerId})`);
  }

  handlePeerLeft({ peerId, username }) {
    if (this.peerList) {
      this.peerList.removePeer(peerId);
    }
    console.log(`Peer left: ${username} (${peerId})`);
  }

  handleLocalDiceRoll({ diceType, count, values, total }) {
    // Send roll to all peers via signaling server
    signalingClient.sendDiceRoll(diceType, count, values, total);

    // Add to local history
    if (this.diceHistory) {
      this.diceHistory.addRoll({
        username: this.username,
        peerId: this.peerId,
        diceType,
        count,
        values,
        total
      });
    }
  }

  handleRemoteDiceRoll({ peerId, username, diceType, count, values, total }) {
    // Don't double-add our own rolls
    if (peerId === this.peerId) return;

    if (this.diceHistory) {
      this.diceHistory.addRoll({
        username,
        peerId,
        diceType,
        count,
        values,
        total
      });
    }
  }

  leaveRoom() {
    signalingClient.disconnect();
    webrtcManager.closeAll();

    // Reset state
    this.peerId = null;
    this.roomId = null;

    // Clear and reset components
    if (this.peerList) this.peerList.clear();
    if (this.diceHistory) this.diceHistory.clear();

    // Show join form, hide room view
    this.roomJoin.style.display = 'block';
    this.roomView.hide();

    // Reconnect to signaling server
    this.connectToSignalingServer();
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.diceBoxApp = new DiceBoxApp();
});
