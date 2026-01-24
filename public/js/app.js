/**
 * DiceBox - Main Application
 * Mesh topology: all peers are equal, no host/client distinction
 */
import { signalingClient } from './signaling-client.js';
import { webrtcManager } from './webrtc-manager.js';
import { ConnectionManager } from './connection-manager.js';
import { RoomManager } from './room-manager.js';
import { MessageRouter, MSG } from './message-router.js';

class DiceBoxApp {
  constructor() {
    // Initialize managers
    this.connectionManager = new ConnectionManager();
    this.roomManager = new RoomManager();
    this.messageRouter = new MessageRouter();

    // UI components
    this.headerBar = document.querySelector('header-bar');
    this.roomJoin = document.querySelector('room-join');
    this.roomView = document.querySelector('room-view');
    this.diceRoller = null;
    this.diceHistory = null;
    this.peerList = null;

    this.init();
  }

  async init() {
    this.setupMessageHandlers();
    this.setupEventListeners();
    this.setupManagerEvents();

    await this.connectionManager.connect();
  }

  // === MESSAGE HANDLERS SETUP (Mesh topology - all handlers are equal) ===

  setupMessageHandlers() {
    this.messageRouter
      .onMessage(MSG.HELLO, (peerId, msg) => this.handleHello(peerId, msg))
      .onMessage(MSG.WELCOME, (peerId, msg) => this.handleWelcome(peerId, msg))
      .onMessage(MSG.REQUEST_STATE, (peerId, msg) => this.handleRequestState(peerId, msg))
      .onMessage(MSG.PEER_JOINED, (peerId, msg) => this.handlePeerJoinedMsg(peerId, msg))
      .onMessage(MSG.PEER_LEFT, (peerId, msg) => this.handlePeerLeftMsg(peerId, msg))
      .onMessage(MSG.DICE_ROLL, (peerId, msg) => this.handleDiceRollMsg(peerId, msg))
      .onMessage(MSG.DICE_GRAB, (peerId, msg) => this.handleDiceGrabMsg(peerId, msg))
      .onMessage(MSG.DICE_DROP, (peerId, msg) => this.handleDiceDropMsg(peerId, msg));
  }

  // === MANAGER EVENTS SETUP ===

  setupManagerEvents() {
    // Connection manager events
    this.connectionManager.setupEventListeners({
      onConnected: () => {},
      onDisconnected: () => {},
      onReconnected: () => {
        // Session should be automatically restored by signaling client
      },
      onReconnectFailed: () => {},
      onServerError: () => {}
    });

    // Room manager events
    this.roomManager.setupSignalingEvents({
      onCreateRoomFailed: ({ reason }) => {
        console.error('Failed to create room:', reason);
      },
      onJoinFailed: ({ reason }) => {
        console.error('Failed to join room:', reason);
      },
      onPeerDisconnected: ({ peerId }) => {
        // Handle WebRTC disconnection
        webrtcManager.closePeerConnection(peerId);
        if (this.peerList) {
          this.peerList.removePeer(peerId);
        }
        this.updateDiceRollerState();
      },
      onSessionRestored: ({ roomId }) => {
        if (roomId && this.roomView.classList.contains('active')) {
          console.log('Session restored while in room, reconnecting...');
          if (this.peerList) {
            this.peerList.setSelfStatus('connecting');
          }
          // Re-query room to get current peers
          signalingClient.queryRoom(roomId);
        }
      }
    });

    this.roomManager.addEventListener('room-created', () => {
      this.enterRoom();
    });

    this.roomManager.addEventListener('peer-left', (e) => {
      const { peerId, username } = e.detail;
      if (this.peerList) {
        this.peerList.removePeer(peerId);
      }
      // Clear any dice sets held by this peer
      const meshState = this.roomManager.getMeshState();
      const setsHeld = meshState.getSetsHeldByPeer(peerId);
      for (const setId of setsHeld) {
        meshState.clearHolder(setId);
      }
      this.updateDiceRollerState();
    });
  }

  // === UI EVENT LISTENERS ===

  setupEventListeners() {
    // Room join UI events
    document.addEventListener('join-room', (e) => {
      const { roomId, username, isHost, diceConfig } = e.detail;
      if (isHost) {
        this.roomManager.createRoom(
          roomId,
          username,
          this.connectionManager.getEffectiveId(),
          this.connectionManager.serverConnected,
          diceConfig
        );
      } else {
        this.roomManager.joinRoom(roomId, username, this.connectionManager.serverConnected);
      }
    });

    document.addEventListener('leave-room', () => {
      this.leaveRoom();
    });

    document.addEventListener('retry-connection', () => {
      this.retryConnection();
    });

    // Dice events
    document.addEventListener('dice-rolled', (e) => {
      this.handleLocalDiceRoll(e.detail);
    });

    document.addEventListener('dice-grabbed', (e) => {
      this.handleLocalDiceGrab(e);
    });

    document.addEventListener('dice-dropped', () => {
      this.handleLocalDiceDrop();
    });

    // WebRTC events
    this.setupWebRTCEvents();
  }

  async retryConnection() {
    await this.connectionManager.retryConnection();
  }

  setupWebRTCEvents() {
    webrtcManager.addEventListener('channel-open', (e) => {
      const { peerId, channel } = e.detail;
      console.log(`Channel opened with ${peerId}`);

      // Reset self status to connected when we establish a peer connection
      // This handles the case where self was set to 'connecting' during session restoration
      if (this.peerList) {
        this.peerList.setSelfStatus('connected');
      }

      this.roomManager.markPeerConnected(peerId);

      // Send HELLO to introduce ourselves
      this.messageRouter.sendToPeer(peerId, {
        type: MSG.HELLO,
        username: this.roomManager.username
      });

      // If we don't have state yet, request it from this peer
      if (!this.roomManager.hasReceivedState() && this.roomManager.inRoom()) {
        this.messageRouter.sendToPeer(peerId, {
          type: MSG.REQUEST_STATE
        });
      }
    });

    webrtcManager.addEventListener('message', (e) => {
      this.messageRouter.route(e.detail.peerId, e.detail.message);
    });

    webrtcManager.addEventListener('peer-disconnected', (e) => {
      this.handlePeerDisconnected(e.detail.peerId);
    });

    webrtcManager.addEventListener('connection-state-change', (e) => {
      const { peerId, state } = e.detail;
      if (this.peerList) {
        this.peerList.updatePeerStatus(peerId, state === 'connected' ? 'connected' : 'connecting');
      }
    });

    webrtcManager.addEventListener('connection-timeout', (e) => {
      const { peerId } = e.detail;
      console.log(`Connection to ${peerId} timed out`);
      this.handlePeerDisconnected(peerId);
    });
  }

  // === MESSAGE HANDLERS (Mesh topology - unified handlers) ===

  handleHello(peerId, { username }) {
    console.log(`Peer ${peerId} introduced as ${username}`);
    const meshState = this.roomManager.getMeshState();

    // Add peer to our state
    meshState.addPeer(peerId, username);

    // Add to UI
    if (this.peerList) {
      this.peerList.addPeer(peerId, username, 'connected');
    }

    // If we already have state, broadcast that this peer joined to others
    if (this.roomManager.hasReceivedState()) {
      this.messageRouter.broadcast({
        type: MSG.PEER_JOINED,
        peerId,
        username
      }, peerId);
    }
  }

  handleRequestState(peerId, msg) {
    console.log(`Peer ${peerId} requested state`);
    const meshState = this.roomManager.getMeshState();

    // Send our current state to this peer
    this.messageRouter.sendToPeer(peerId, {
      type: MSG.WELCOME,
      state: meshState.getSnapshot()
    });
  }

  handleWelcome(peerId, { state }) {
    console.log(`Received state from ${peerId}`);

    // Only accept state if we haven't received it yet
    if (this.roomManager.hasReceivedState()) {
      console.log('Already have state, ignoring');
      return;
    }

    this.roomManager.setReceivedStateFrom(peerId);
    const meshState = this.roomManager.getMeshState();

    // Load the state (includes diceConfig)
    meshState.loadSnapshot(state);

    // Now enter the room UI
    this.enterRoom();

    // Populate peer list and history from state
    for (const peer of (state.peers || [])) {
      if (peer.peerId !== this.connectionManager.peerId) {
        this.peerList.addPeer(peer.peerId, peer.username, 'connected');
      }
    }

    for (const roll of (state.rollHistory || []).slice().reverse()) {
      this.diceHistory.addRoll(roll);
    }

    this.updateDiceRollerState();
  }

  handlePeerJoinedMsg(peerId, { peerId: newPeerId, username }) {
    if (newPeerId === this.connectionManager.peerId) return;

    const meshState = this.roomManager.getMeshState();
    meshState.addPeer(newPeerId, username);

    if (this.peerList) {
      this.peerList.addPeer(newPeerId, username, 'connected');
    }
  }

  handlePeerLeftMsg(peerId, { peerId: leftPeerId }) {
    const meshState = this.roomManager.getMeshState();
    meshState.removePeer(leftPeerId);

    if (this.peerList) {
      this.peerList.removePeer(leftPeerId);
    }

    this.updateDiceRollerState();
  }

  handleDiceRollMsg(peerId, roll) {
    const meshState = this.roomManager.getMeshState();

    // Check for duplicate
    if (meshState.hasRoll(roll.rollId)) {
      return;
    }

    // Add to state
    meshState.addRoll(roll);
    meshState.clearAllHolders();

    // Convert setResults to rollResults format for display
    const rollResults = {};
    for (const sr of (roll.setResults || [])) {
      rollResults[sr.setId] = sr.values;
    }

    // Update UI
    if (this.diceRoller) {
      this.diceRoller.showRoll(rollResults);
    }

    if (this.diceHistory) {
      this.diceHistory.addRoll(roll);
    }

    this.updateDiceRollerState();
  }

  handleDiceGrabMsg(peerId, { setId, username }) {
    const meshState = this.roomManager.getMeshState();

    // Set holder in state
    meshState.setHolder(setId, peerId, username);
    this.updateDiceRollerState();
  }

  handleDiceDropMsg(peerId, { setId }) {
    const meshState = this.roomManager.getMeshState();

    // Clear holder
    if (setId) {
      meshState.clearHolder(setId);
    } else {
      // Clear all sets held by this peer
      const setsHeld = meshState.getSetsHeldByPeer(peerId);
      for (const heldSetId of setsHeld) {
        meshState.clearHolder(heldSetId);
      }
    }

    this.updateDiceRollerState();
  }

  // === PEER DISCONNECTION ===

  handlePeerDisconnected(peerId) {
    console.log(`Peer disconnected: ${peerId}`);
    const meshState = this.roomManager.getMeshState();

    const peer = meshState.getPeer(peerId);
    if (peer) {
      // Clear dice sets held by this peer
      const setsHeld = meshState.getSetsHeldByPeer(peerId);
      for (const setId of setsHeld) {
        meshState.clearHolder(setId);

        // Broadcast that the dice was dropped
        this.messageRouter.broadcast({
          type: MSG.DICE_DROP,
          setId,
          peerId
        });
      }

      meshState.removePeer(peerId);

      // Broadcast peer left to others
      this.messageRouter.broadcast({
        type: MSG.PEER_LEFT,
        peerId,
        username: peer.username
      });

      if (this.peerList) {
        this.peerList.removePeer(peerId);
      }

      this.updateDiceRollerState();
    }
  }

  // === ROOM UI ===

  enterRoom() {
    this.roomJoin.style.display = 'none';
    this.roomView.show();
    this.headerBar.showRoomView(this.roomManager.roomId);

    this.diceRoller = this.roomView.querySelector('dice-roller');
    this.diceHistory = this.roomView.querySelector('dice-history');
    this.peerList = this.roomView.querySelector('peer-list');

    this.peerList.setSelf(this.connectionManager.getEffectiveId(), this.roomManager.username);
    this.diceHistory.peerId = this.connectionManager.getEffectiveId();

    this.updateDiceRollerState();

    console.log(`Entered room ${this.roomManager.roomId} as ${this.roomManager.username}`);
  }

  // === LOCAL DICE ACTIONS ===

  handleLocalDiceGrab(e) {
    const setId = e?.detail?.setId;
    if (!setId) return;

    const meshState = this.roomManager.getMeshState();

    if (meshState.isSetHeld(setId)) {
      return;
    }

    const myId = this.connectionManager.getEffectiveId();

    // Grab locally
    if (meshState.tryGrab(setId, myId, this.roomManager.username)) {
      // Broadcast to all peers
      this.messageRouter.broadcast({
        type: MSG.DICE_GRAB,
        setId,
        peerId: myId,
        username: this.roomManager.username
      });

      this.updateDiceRollerState();
    }
  }

  handleLocalDiceDrop() {
    const myId = this.connectionManager.getEffectiveId();
    const meshState = this.roomManager.getMeshState();

    if (!meshState.isPeerHolding(myId)) return;

    const setsToRelease = meshState.getSetsHeldByPeer(myId);

    for (const setId of setsToRelease) {
      meshState.clearHolder(setId);

      // Broadcast to all peers
      this.messageRouter.broadcast({
        type: MSG.DICE_DROP,
        setId,
        peerId: myId
      });
    }

    this.updateDiceRollerState();
  }

  handleLocalDiceRoll({ rollResults, total, holders }) {
    const myId = this.connectionManager.getEffectiveId();
    const meshState = this.roomManager.getMeshState();

    // Generate roll ID
    const rollId = `${myId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Build set results with holder info
    const diceConfig = meshState.getDiceConfig();
    const setResults = [];

    for (const set of diceConfig.diceSets) {
      const values = rollResults[set.id] || [];
      const holder = meshState.getHolder(set.id);
      setResults.push({
        setId: set.id,
        color: set.color,
        values,
        holderId: holder?.peerId || myId,
        holderUsername: holder?.username || this.roomManager.username
      });
    }

    // Clear holders
    meshState.clearAllHolders();

    const roll = {
      setResults,
      total,
      rollId,
      timestamp: Date.now()
    };

    // Add to local state
    meshState.addRoll(roll);

    // Broadcast to all peers
    this.messageRouter.broadcast({
      type: MSG.DICE_ROLL,
      ...roll
    });

    // Update local UI
    if (this.diceHistory) {
      this.diceHistory.addRoll(roll);
    }

    this.updateDiceRollerState();
  }

  updateDiceRollerState() {
    if (!this.diceRoller) return;

    const meshState = this.roomManager.getMeshState();
    const diceConfig = meshState.getDiceConfig();
    const holders = meshState.getHolders();

    this.diceRoller.setConfig({
      diceSets: diceConfig?.diceSets || [],
      holders: Array.from(holders.entries()),
      myPeerId: this.connectionManager.getEffectiveId()
    });

    if (this.peerList && diceConfig) {
      const holderInfo = new Map();
      for (const [setId, holder] of holders) {
        if (!holderInfo.has(holder.peerId)) {
          const set = diceConfig.diceSets.find(s => s.id === setId);
          holderInfo.set(holder.peerId, set?.color || '#f59e0b');
        }
      }
      this.peerList.setHolders(holderInfo);
    }
  }

  // === LEAVE ROOM ===

  leaveRoom() {
    // Broadcast that we're leaving
    this.messageRouter.broadcast({
      type: MSG.PEER_LEFT,
      peerId: this.connectionManager.peerId,
      username: this.roomManager.username
    });

    this.roomManager.leaveRoom();
    this.connectionManager.peerId = signalingClient.peerId;

    if (this.peerList) this.peerList.clear();
    if (this.diceHistory) this.diceHistory.clear();

    this.roomJoin.style.display = 'block';
    this.roomView.hide();
    this.headerBar.showJoinView();
  }
}

// Initialize app - modules are deferred so DOM is already ready
window.diceBoxApp = new DiceBoxApp();
