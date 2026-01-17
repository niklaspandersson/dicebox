/**
 * DiceBox - Main Application
 * Host-based P2P room model with host migration
 */
import { signalingClient } from './signaling-client.js';
import { webrtcManager } from './webrtc-manager.js';
import { RoomHost } from './room-host.js';

// Message types for P2P communication
const MSG = {
  // Host -> Peer
  WELCOME: 'welcome',           // Initial state sync when peer joins
  PEER_JOINED: 'peer-joined',   // Notify all peers of new peer
  PEER_LEFT: 'peer-left',       // Notify all peers of departed peer
  DICE_ROLL: 'dice-roll',       // Broadcast dice roll
  HOST_LEAVING: 'host-leaving', // Host is leaving, includes migration info

  // Peer -> Host
  INTRODUCE: 'introduce',       // Peer sends username to host
  ROLL_DICE: 'roll-dice',       // Peer requests dice roll broadcast
};

class DiceBoxApp {
  constructor() {
    this.peerId = null;
    this.username = null;
    this.roomId = null;

    // Host-based state
    this.isHost = false;
    this.hostPeerId = null;
    this.roomState = new RoomHost();

    // Join order (for migration election)
    this.myJoinOrder = 0;

    // Connection state
    this.serverConnected = false;

    // UI components
    this.roomJoin = document.querySelector('room-join');
    this.roomView = document.querySelector('room-view');
    this.diceRoller = null;
    this.diceHistory = null;
    this.peerList = null;

    this.init();
  }

  async init() {
    this.setupEventListeners();

    // Show connecting state
    if (this.roomJoin) {
      this.roomJoin.setConnecting();
    }

    await this.connectToSignalingServer();
  }

  async connectToSignalingServer() {
    try {
      await signalingClient.connect();
      this.peerId = signalingClient.peerId;
      this.serverConnected = true;
      console.log('Connected to signaling server, peer ID:', this.peerId);

      // Update UI to show connected state
      if (this.roomJoin) {
        this.roomJoin.setConnected();
      }
    } catch (error) {
      console.error('Failed to connect to signaling server:', error);
      this.serverConnected = false;

      // Show error state in UI
      if (this.roomJoin) {
        this.roomJoin.setDisconnected(true);
      }
    }
  }

  showStatus(text, type = 'connected') {
    let status = document.querySelector('.connection-status');
    if (!status) {
      status = document.createElement('div');
      status.className = 'connection-status';
      document.body.appendChild(status);
    }
    status.textContent = text;
    status.className = `connection-status ${type}`;

    if (type === 'connected') {
      setTimeout(() => status.remove(), 3000);
    }
  }

  setupEventListeners() {
    // Room join UI events
    document.addEventListener('join-room', (e) => {
      this.joinOrCreateRoom(e.detail.roomId, e.detail.username);
    });

    document.addEventListener('leave-room', () => {
      this.leaveRoom();
    });

    // Retry connection event
    document.addEventListener('retry-connection', () => {
      this.retryConnection();
    });

    // Dice roll UI events
    document.addEventListener('dice-rolled', (e) => {
      this.handleLocalDiceRoll(e.detail);
    });

    // Signaling server events
    this.setupSignalingEvents();

    // WebRTC events
    this.setupWebRTCEvents();
  }

  async retryConnection() {
    console.log('Retrying connection...');

    if (this.roomJoin) {
      this.roomJoin.setConnecting();
    }

    // Small delay before retry
    await new Promise(resolve => setTimeout(resolve, 500));

    await this.connectToSignalingServer();
  }

  setupSignalingEvents() {
    // Connection state events
    signalingClient.addEventListener('connected', () => {
      this.serverConnected = true;
      if (this.roomJoin && this.roomJoin.style.display !== 'none') {
        this.roomJoin.setConnected();
      }
    });

    signalingClient.addEventListener('disconnected', () => {
      console.log('Disconnected from signaling server');
      this.serverConnected = false;

      // If we're in the lobby, show the error
      if (this.roomJoin && this.roomJoin.style.display !== 'none') {
        this.roomJoin.setDisconnected(true);
      } else {
        // If we're in a room, show a status message
        this.showStatus('Disconnected from server', 'disconnected');
      }
    });

    signalingClient.addEventListener('reconnect-failed', () => {
      console.log('Reconnection failed');
      if (this.roomJoin && this.roomJoin.style.display !== 'none') {
        this.roomJoin.setDisconnected(true);
      }
    });

    // Room query response
    signalingClient.addEventListener('room-info', (e) => {
      this.handleRoomInfo(e.detail);
    });

    // Host registration responses
    signalingClient.addEventListener('register-host-success', (e) => {
      this.handleHostRegistered(e.detail);
    });

    signalingClient.addEventListener('register-host-failed', (e) => {
      console.error('Failed to register as host:', e.detail.reason);
      this.showStatus('Room already exists', 'disconnected');
    });

    // Join room responses
    signalingClient.addEventListener('join-room-success', (e) => {
      this.handleJoinRoomSuccess(e.detail);
    });

    signalingClient.addEventListener('join-room-failed', (e) => {
      console.error('Failed to join room:', e.detail.reason);
      this.showStatus('Room not found', 'disconnected');
    });

    // Host receives notification of peer wanting to connect
    signalingClient.addEventListener('peer-connecting', (e) => {
      this.handlePeerConnecting(e.detail);
    });

    // Host migration
    signalingClient.addEventListener('claim-host-success', (e) => {
      this.handleBecameHost(e.detail);
    });

    signalingClient.addEventListener('claim-host-failed', (e) => {
      console.log('Another peer claimed host');
    });
  }

  setupWebRTCEvents() {
    // Data channel opened
    webrtcManager.addEventListener('channel-open', (e) => {
      const { peerId, channel } = e.detail;
      console.log(`Channel opened with ${peerId}`);

      if (this.isHost) {
        // Host: update channel reference in room state
        this.roomState.setPeerChannel(peerId, channel);
      } else if (peerId === this.hostPeerId) {
        // Client: connected to host, introduce ourselves
        this.sendToHost({ type: MSG.INTRODUCE, username: this.username });
      }
    });

    // Received message from peer
    webrtcManager.addEventListener('message', (e) => {
      this.handlePeerMessage(e.detail.peerId, e.detail.message);
    });

    // Peer disconnected
    webrtcManager.addEventListener('peer-disconnected', (e) => {
      this.handlePeerDisconnected(e.detail.peerId);
    });

    // Connection state changes
    webrtcManager.addEventListener('connection-state-change', (e) => {
      const { peerId, state } = e.detail;
      if (this.peerList) {
        this.peerList.updatePeerStatus(peerId, state === 'connected' ? 'connected' : 'connecting');
      }
    });
  }

  // Join or create a room
  async joinOrCreateRoom(roomId, username) {
    this.roomId = roomId;
    this.username = username;

    // Query server to see if room exists
    signalingClient.queryRoom(roomId);
  }

  handleRoomInfo({ roomId, exists, hostPeerId }) {
    if (roomId !== this.roomId) return;

    if (exists) {
      // Room exists, join as client
      console.log(`Room ${roomId} exists, joining as client. Host: ${hostPeerId}`);
      this.isHost = false;
      this.hostPeerId = hostPeerId;
      signalingClient.joinRoom(roomId);
    } else {
      // Room doesn't exist, create as host
      console.log(`Room ${roomId} doesn't exist, creating as host`);
      signalingClient.registerHost(roomId);
    }
  }

  handleHostRegistered({ roomId }) {
    console.log(`Registered as host for room ${roomId}`);
    this.isHost = true;
    this.hostPeerId = this.peerId;
    this.myJoinOrder = 0;

    // Initialize room state with self
    this.roomState.clear();

    this.enterRoom();
  }

  handleJoinRoomSuccess({ roomId, hostPeerId }) {
    console.log(`Joined room ${roomId}, connecting to host ${hostPeerId}`);
    this.hostPeerId = hostPeerId;

    // Initiate WebRTC connection to host
    webrtcManager.connectToPeer(hostPeerId);
  }

  // Host: handle incoming peer connection request
  handlePeerConnecting({ peerId }) {
    if (!this.isHost) return;

    console.log(`Peer ${peerId} wants to connect`);
    // Host waits for peer to initiate WebRTC connection
    // (peer sends offer after join-room-success)
  }

  // Handle messages from peers via WebRTC
  handlePeerMessage(fromPeerId, message) {
    console.log(`Message from ${fromPeerId}:`, message.type);

    switch (message.type) {
      // === Messages TO HOST ===
      case MSG.INTRODUCE:
        if (this.isHost) {
          this.hostHandleIntroduce(fromPeerId, message);
        }
        break;

      case MSG.ROLL_DICE:
        if (this.isHost) {
          this.hostHandleRollDice(fromPeerId, message);
        }
        break;

      // === Messages FROM HOST ===
      case MSG.WELCOME:
        if (!this.isHost) {
          this.clientHandleWelcome(message);
        }
        break;

      case MSG.PEER_JOINED:
        this.handlePeerJoinedMsg(message);
        break;

      case MSG.PEER_LEFT:
        this.handlePeerLeftMsg(message);
        break;

      case MSG.DICE_ROLL:
        this.handleDiceRollMsg(message);
        break;

      case MSG.HOST_LEAVING:
        this.handleHostLeavingMsg(fromPeerId, message);
        break;

      default:
        console.log('Unknown message type:', message.type);
    }
  }

  // === HOST MESSAGE HANDLERS ===

  hostHandleIntroduce(peerId, { username }) {
    console.log(`Peer ${peerId} introduced as ${username}`);

    // Add peer to room state
    const channel = webrtcManager.getDataChannel(peerId);
    this.roomState.addPeer(peerId, username, channel);

    // Send welcome with current state
    const state = this.roomState.getState();
    webrtcManager.sendToPeer(peerId, {
      type: MSG.WELCOME,
      yourJoinOrder: this.roomState.peers.get(peerId).joinOrder,
      peers: [
        { peerId: this.peerId, username: this.username, joinOrder: this.myJoinOrder },
        ...state.peers.filter(p => p.peerId !== peerId)
      ],
      rollHistory: state.rollHistory
    });

    // Notify other peers
    this.roomState.broadcast({
      type: MSG.PEER_JOINED,
      peerId,
      username
    }, peerId);

    // Update local UI
    if (this.peerList) {
      this.peerList.addPeer(peerId, username, 'connected');
    }
  }

  hostHandleRollDice(peerId, { diceType, count, values, total }) {
    const peer = this.roomState.peers.get(peerId);
    if (!peer) return;

    const roll = {
      peerId,
      username: peer.username,
      diceType,
      count,
      values,
      total,
      timestamp: Date.now()
    };

    // Add to history
    this.roomState.addRoll(roll);

    // Broadcast to all peers (including sender)
    this.roomState.broadcast({ type: MSG.DICE_ROLL, ...roll });

    // Add to local UI
    if (this.diceHistory) {
      this.diceHistory.addRoll(roll);
    }
  }

  // === CLIENT MESSAGE HANDLERS ===

  clientHandleWelcome({ yourJoinOrder, peers, rollHistory }) {
    console.log('Received welcome from host');
    this.myJoinOrder = yourJoinOrder;

    // Enter the room UI
    this.enterRoom();

    // Populate peer list
    for (const peer of peers) {
      if (peer.peerId !== this.peerId) {
        this.peerList.addPeer(peer.peerId, peer.username, 'connected');
      }
    }

    // Populate roll history
    for (const roll of rollHistory.reverse()) {
      this.diceHistory.addRoll(roll);
    }
  }

  handlePeerJoinedMsg({ peerId, username }) {
    if (peerId === this.peerId) return;

    if (this.peerList) {
      this.peerList.addPeer(peerId, username, 'connected');
    }
  }

  handlePeerLeftMsg({ peerId, username }) {
    if (this.peerList) {
      this.peerList.removePeer(peerId);
    }
  }

  handleDiceRollMsg({ peerId, username, diceType, count, values, total, timestamp }) {
    if (this.diceHistory) {
      this.diceHistory.addRoll({ peerId, username, diceType, count, values, total });
    }
  }

  handleHostLeavingMsg(fromPeerId, { nextHostPeerId, roomState }) {
    console.log(`Host is leaving, next host: ${nextHostPeerId}`);

    // Store the state for potential migration
    this.roomState.loadState(roomState);

    if (nextHostPeerId === this.peerId) {
      // We're the new host!
      this.initiateHostMigration();
    } else {
      // Someone else will be host, update our reference
      this.hostPeerId = nextHostPeerId;
    }
  }

  // === HOST MIGRATION ===

  initiateHostMigration() {
    console.log('Initiating host migration - claiming host role');

    // Try to claim host with the server
    signalingClient.claimHost(this.roomId);
  }

  handleBecameHost({ roomId }) {
    console.log('Successfully became new host');
    this.isHost = true;
    this.hostPeerId = this.peerId;

    this.showStatus('You are now the host', 'connected');

    // Re-establish connections with all peers
    // They should reconnect to us
    for (const [peerId, data] of this.roomState.peers) {
      if (peerId !== this.peerId) {
        const channel = webrtcManager.getDataChannel(peerId);
        if (channel) {
          this.roomState.setPeerChannel(peerId, channel);
        }
      }
    }

    // Update UI to show host status
    if (this.roomView) {
      this.roomView.setHostStatus(true);
    }
  }

  handlePeerDisconnected(peerId) {
    console.log(`Peer disconnected: ${peerId}`);

    if (this.isHost) {
      // Host: remove peer from state and notify others
      const peer = this.roomState.peers.get(peerId);
      if (peer) {
        this.roomState.removePeer(peerId);

        this.roomState.broadcast({
          type: MSG.PEER_LEFT,
          peerId,
          username: peer.username
        });

        if (this.peerList) {
          this.peerList.removePeer(peerId);
        }
      }
    } else if (peerId === this.hostPeerId) {
      // Client: host disconnected, need migration
      console.log('Host disconnected! Initiating migration...');
      this.showStatus('Host disconnected, migrating...', 'connecting');

      // Check if we should become the new host (lowest join order)
      const nextHost = this.roomState.getNextHostCandidate(this.hostPeerId);

      if (!nextHost || this.myJoinOrder < nextHost.joinOrder) {
        // We should be the new host
        this.initiateHostMigration();
      } else {
        // Wait for new host to establish
        this.hostPeerId = nextHost.peerId;
        console.log(`Expecting ${nextHost.peerId} to become new host`);

        // Try to connect to new host
        setTimeout(() => {
          if (!this.isHost && this.hostPeerId === nextHost.peerId) {
            webrtcManager.connectToPeer(nextHost.peerId);
          }
        }, 1000);
      }
    }
  }

  // === ROOM UI ===

  enterRoom() {
    // Hide join form, show room view
    this.roomJoin.style.display = 'none';
    this.roomView.show();
    this.roomView.setRoomId(this.roomId);
    this.roomView.setHostStatus(this.isHost);

    // Get component references
    this.diceRoller = this.roomView.querySelector('dice-roller');
    this.diceHistory = this.roomView.querySelector('dice-history');
    this.peerList = this.roomView.querySelector('peer-list');

    // Set up peer list with self
    this.peerList.setSelf(this.peerId, this.username);
    this.diceHistory.peerId = this.peerId;

    console.log(`Entered room ${this.roomId} as ${this.username} (${this.isHost ? 'HOST' : 'CLIENT'})`);
  }

  // === DICE ROLLING ===

  handleLocalDiceRoll({ diceType, count, values, total }) {
    const roll = {
      peerId: this.peerId,
      username: this.username,
      diceType,
      count,
      values,
      total,
      timestamp: Date.now()
    };

    if (this.isHost) {
      // Host: add to state and broadcast
      this.roomState.addRoll(roll);
      this.roomState.broadcast({ type: MSG.DICE_ROLL, ...roll });

      // Add to local UI
      if (this.diceHistory) {
        this.diceHistory.addRoll(roll);
      }
    } else {
      // Client: send to host for broadcast
      this.sendToHost({
        type: MSG.ROLL_DICE,
        diceType,
        count,
        values,
        total
      });

      // Optimistically add to local UI
      if (this.diceHistory) {
        this.diceHistory.addRoll(roll);
      }
    }
  }

  sendToHost(message) {
    if (this.hostPeerId) {
      webrtcManager.sendToPeer(this.hostPeerId, message);
    }
  }

  // === LEAVE ROOM ===

  leaveRoom() {
    if (this.isHost) {
      // Host: notify peers and handoff
      const nextHost = this.roomState.getNextHostCandidate();

      if (nextHost) {
        // Send migration info to all peers
        this.roomState.broadcast({
          type: MSG.HOST_LEAVING,
          nextHostPeerId: nextHost.peerId,
          roomState: this.roomState.getState()
        });
      }
    }

    // Clean up
    signalingClient.leaveRoom();
    webrtcManager.closeAll();

    // Reset state
    this.peerId = signalingClient.peerId;
    this.roomId = null;
    this.isHost = false;
    this.hostPeerId = null;
    this.roomState.clear();

    // Clear and reset components
    if (this.peerList) this.peerList.clear();
    if (this.diceHistory) this.diceHistory.clear();

    // Show join form, hide room view
    this.roomJoin.style.display = 'block';
    this.roomView.hide();

    // Update room-join state based on connection
    if (this.serverConnected) {
      this.roomJoin.setConnected();
    } else {
      this.roomJoin.setDisconnected(true);
    }
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.diceBoxApp = new DiceBoxApp();
});
