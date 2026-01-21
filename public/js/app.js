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
  DICE_CONFIG: 'dice-config',   // Broadcast dice configuration change
  DICE_HELD: 'dice-held',       // Broadcast that someone grabbed the dice
  HOST_LEAVING: 'host-leaving', // Host is leaving, includes migration info

  // Peer -> Host
  INTRODUCE: 'introduce',       // Peer sends username to host
  ROLL_DICE: 'roll-dice',       // Peer requests dice roll broadcast
  GRAB_DICE: 'grab-dice',       // Peer wants to hold the dice
  DROP_DICE: 'drop-dice',       // Host forces holder to drop dice
};

// Host migration configuration
const MIGRATION_CONFIG = {
  initialDelay: 500,      // Initial delay before first reconnection attempt
  maxDelay: 10000,        // Maximum delay between attempts
  maxAttempts: 5,         // Maximum number of reconnection attempts
  backoffMultiplier: 2,   // Exponential backoff multiplier
};

class DiceBoxApp {
  constructor() {
    // Generate a local ID for offline use; will be replaced by server-assigned peerId
    this.localId = 'local-' + Math.random().toString(36).substring(2, 10);
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

    // Migration state
    this.migrationAttempts = 0;
    this.migrationTimeout = null;

    // Track pending rolls (for duplicate prevention)
    this.pendingRolls = new Set();

    // Local dice state (synced with room state)
    this.diceSettings = {
      diceSets: [{ id: 'set-1', count: 2, color: '#ffffff' }]
    };
    // Holders map: setId -> { peerId, username }
    this.holders = new Map();

    // UI components
    this.roomJoin = document.querySelector('room-join');
    this.roomView = document.querySelector('room-view');
    this.diceConfig = null;
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

  // Returns peerId if connected, otherwise localId for offline operation
  getEffectiveId() {
    return this.peerId || this.localId;
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
        this.roomJoin.setDisconnected();
      }
    }
  }

  updateConnectionIndicator(state) {
    const indicator = document.getElementById('connection-indicator');
    if (!indicator) return;

    indicator.classList.remove('connected', 'disconnected');
    if (state === 'connected') {
      indicator.classList.add('connected');
      indicator.title = 'Connected to server';
    } else if (state === 'disconnected') {
      indicator.classList.add('disconnected');
      indicator.title = 'Disconnected - multiplayer unavailable';
    } else {
      indicator.title = 'Connecting...';
    }
  }

  showStatus(text, type = 'connected') {
    // Update the header indicator
    this.updateConnectionIndicator(type);

    // Only show toast for non-error transient messages
    if (type === 'disconnected') return;

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
      const { roomId, username, isHost } = e.detail;
      if (isHost) {
        this.createRoom(roomId, username);
      } else {
        this.joinRoom(roomId, username);
      }
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

    // Dice grab event (user clicked to hold a dice set)
    document.addEventListener('dice-grabbed', (e) => {
      this.handleLocalDiceGrab(e);
    });

    // Dice config change event (host only)
    document.addEventListener('dice-config-changed', (e) => {
      this.handleLocalDiceConfigChange(e.detail);
    });

    // Dice drop event (host forces holder to drop)
    document.addEventListener('dice-dropped', () => {
      this.handleLocalDiceDrop();
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
      this.updateConnectionIndicator('connected');
      if (this.roomJoin && this.roomJoin.style.display !== 'none') {
        this.roomJoin.setConnected();
      }
    });

    signalingClient.addEventListener('disconnected', (e) => {
      const { wasHost, previousRoomId } = e.detail || {};
      console.log('Disconnected from signaling server');
      this.serverConnected = false;
      this.updateConnectionIndicator('disconnected');

      // If we're in the lobby, also update room-join component
      if (this.roomJoin && this.roomJoin.style.display !== 'none') {
        this.roomJoin.setDisconnected();
      }
    });

    // Handle reconnection - re-register host if we were hosting
    signalingClient.addEventListener('reconnected', (e) => {
      console.log('Reconnected to signaling server with new peer ID:', e.detail.peerId);
      this.peerId = e.detail.peerId;
      this.serverConnected = true;
      this.updateConnectionIndicator('connected');

      if (this.roomId && this.isHost) {
        // Re-register as host after reconnection
        console.log('Re-registering as host for room:', this.roomId);
        signalingClient.registerHost(this.roomId);
      }
    });

    signalingClient.addEventListener('reconnect-failed', () => {
      console.log('Reconnection failed');
      this.updateConnectionIndicator('disconnected');
      if (this.roomJoin && this.roomJoin.style.display !== 'none') {
        this.roomJoin.setDisconnected();
      }
    });

    // Handle server errors
    signalingClient.addEventListener('server-error', (e) => {
      console.error('Server error:', e.detail);
      if (e.detail.errorType === 'rate-limit') {
        this.showStatus('Rate limited - slow down', 'disconnected');
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
      this.cancelMigration();
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

    // Connection timeout
    webrtcManager.addEventListener('connection-timeout', (e) => {
      const { peerId } = e.detail;
      console.log(`Connection to ${peerId} timed out`);

      if (!this.isHost && peerId === this.hostPeerId) {
        // Failed to connect to host, handle as host disconnect
        this.handlePeerDisconnected(peerId);
      }
    });
  }

  // Create a new room as host (works offline)
  createRoom(roomId, username) {
    this.roomId = roomId;
    this.username = username;
    this.isHost = true;
    this.hostPeerId = this.getEffectiveId();
    this.myJoinOrder = 0;

    // Initialize room state
    this.roomState.clear();

    // Enter the room immediately (offline-capable)
    this.enterRoom();

    // If server is connected, register as host
    if (this.serverConnected) {
      signalingClient.registerHost(roomId);
    }

    console.log(`Created room ${roomId} as host (server ${this.serverConnected ? 'connected' : 'offline'})`);
  }

  // Join an existing room (requires server)
  joinRoom(roomId, username) {
    if (!this.serverConnected) {
      this.showStatus('Cannot join room - no server connection', 'disconnected');
      return;
    }

    this.roomId = roomId;
    this.username = username;
    this.isHost = false;

    // Query server to find the host
    signalingClient.queryRoom(roomId);
  }

  handleRoomInfo({ roomId, exists, hostPeerId }) {
    if (roomId !== this.roomId) return;

    if (exists) {
      // Room exists, join as client
      console.log(`Room ${roomId} exists, joining as client. Host: ${hostPeerId}`);
      this.hostPeerId = hostPeerId;
      signalingClient.joinRoom(roomId);
    } else {
      // Room doesn't exist
      this.showStatus('Room not found', 'disconnected');
      this.roomId = null;
    }
  }

  handleHostRegistered({ roomId }) {
    console.log(`Registered as host for room ${roomId} with server`);
    // Room was already entered in createRoom(), this just confirms server registration
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

      case MSG.GRAB_DICE:
        if (this.isHost) {
          this.hostHandleGrabDice(fromPeerId, message);
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
        this.handleDiceRollMsg(fromPeerId, message);
        break;

      case MSG.DICE_CONFIG:
        this.handleDiceConfigMsg(message);
        break;

      case MSG.DICE_HELD:
        this.handleDiceHeldMsg(message);
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
      rollHistory: state.rollHistory,
      diceConfig: state.diceConfig,
      holders: state.holders
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

  hostHandleRollDice(peerId, { diceType, rollResults, total, rollId, setResults }) {
    const peer = this.roomState.peers.get(peerId);
    if (!peer) return;

    // Build set results with holder info
    const finalSetResults = [];
    for (const set of this.diceSettings.diceSets) {
      const values = rollResults[set.id] || [];
      const holder = this.roomState.getHolder(set.id);
      finalSetResults.push({
        setId: set.id,
        color: set.color,
        values,
        holderId: holder?.peerId || peerId,
        holderUsername: holder?.username || peer.username
      });
    }

    // Clear all holders since a roll happened
    this.roomState.clearAllHolders();
    this.holders.clear();

    const roll = {
      setResults: finalSetResults,
      total,
      rollId,
      timestamp: Date.now()
    };

    // Add to history
    this.roomState.addRoll(roll);

    // Broadcast to all peers (including sender)
    this.roomState.broadcast({ type: MSG.DICE_ROLL, ...roll });

    // Display roll result locally and add to history
    if (this.diceRoller) {
      this.diceRoller.showRoll(rollResults);
    }
    if (this.diceHistory) {
      this.diceHistory.addRoll(roll);
    }
    this.updateDiceRollerState();
  }

  hostHandleGrabDice(peerId, { setId }) {
    const peer = this.roomState.peers.get(peerId);
    if (!peer) return;

    // Only allow grab if this set isn't already held
    if (this.roomState.getHolder(setId) !== null) {
      console.log(`Grab rejected - set ${setId} is already held`);
      return;
    }

    // Set the holder for this set
    this.roomState.setHolder(setId, peerId, peer.username);
    this.holders.set(setId, { peerId, username: peer.username });

    // Broadcast to all peers
    this.roomState.broadcast({
      type: MSG.DICE_HELD,
      setId,
      holderPeerId: peerId,
      holderUsername: peer.username
    });

    this.updateDiceRollerState();
  }

  // === CLIENT MESSAGE HANDLERS ===

  clientHandleWelcome({ yourJoinOrder, peers, rollHistory, diceConfig, holders }) {
    console.log('Received welcome from host');
    this.myJoinOrder = yourJoinOrder;

    // Set dice config - handle both old and new formats
    if (diceConfig && diceConfig.diceSets) {
      this.diceSettings = diceConfig;
    } else {
      // Migrate from old format
      this.diceSettings = {
        diceSets: [{ id: 'set-1', count: diceConfig?.count || 2, color: '#ffffff' }]
      };
    }

    // Set holders state
    this.holders.clear();
    if (holders) {
      for (const [setId, holder] of holders) {
        this.holders.set(setId, holder);
      }
    }

    // Enter the room UI
    this.enterRoom();

    // Populate peer list
    for (const peer of peers) {
      if (peer.peerId !== this.peerId) {
        this.peerList.addPeer(peer.peerId, peer.username, 'connected');
      }
    }

    // Populate roll history (reversed to show newest first)
    for (const roll of rollHistory.slice().reverse()) {
      this.diceHistory.addRoll(roll);
    }

    // Update dice roller with current state
    this.updateDiceRollerState();
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

  handleDiceRollMsg(fromPeerId, { setResults, total, rollId, timestamp }) {
    // A roll clears all holders
    this.holders.clear();
    this.updateDiceRollerState();

    // If this is our own roll coming back from the host, check for duplicate
    // Check if we initiated this roll (our peerId appears in setResults)
    const weRolled = setResults?.some(sr => sr.holderId === this.peerId);
    if (weRolled && rollId && this.pendingRolls.has(rollId)) {
      // This is a confirmation of our roll - remove from pending, don't add again
      this.pendingRolls.delete(rollId);
      return;
    }

    // Convert setResults to rollResults format for display
    const rollResults = {};
    for (const sr of (setResults || [])) {
      rollResults[sr.setId] = sr.values;
    }

    // Display the roll result on the dice roller
    if (this.diceRoller) {
      this.diceRoller.showRoll(rollResults);
    }

    if (this.diceHistory) {
      this.diceHistory.addRoll({ setResults, total, rollId, timestamp });
    }
  }

  handleDiceConfigMsg({ diceConfig }) {
    // Handle both old and new formats
    if (diceConfig && diceConfig.diceSets) {
      this.diceSettings = diceConfig;
    } else {
      this.diceSettings = {
        diceSets: [{ id: 'set-1', count: diceConfig?.count || 2, color: '#ffffff' }]
      };
    }
    // Clear holders when config changes
    this.holders.clear();
    this.updateDiceRollerState();
  }

  handleDiceHeldMsg({ setId, holderPeerId, holderUsername }) {
    if (holderPeerId === null) {
      // Clear this set's holder (or all if setId is null)
      if (setId) {
        this.holders.delete(setId);
      } else {
        this.holders.clear();
      }
    } else {
      this.holders.set(setId, { peerId: holderPeerId, username: holderUsername });
    }
    this.updateDiceRollerState();
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

  cancelMigration() {
    if (this.migrationTimeout) {
      clearTimeout(this.migrationTimeout);
      this.migrationTimeout = null;
    }
    this.migrationAttempts = 0;
  }

  initiateHostMigration() {
    console.log('Initiating host migration - claiming host role');
    this.cancelMigration();
    this.attemptClaimHost();
  }

  attemptClaimHost() {
    if (this.migrationAttempts >= MIGRATION_CONFIG.maxAttempts) {
      console.log('Max migration attempts reached, giving up');
      this.showStatus('Failed to migrate host', 'disconnected');
      return;
    }

    this.migrationAttempts++;

    // Calculate delay with exponential backoff
    const delay = Math.min(
      MIGRATION_CONFIG.initialDelay * Math.pow(MIGRATION_CONFIG.backoffMultiplier, this.migrationAttempts - 1),
      MIGRATION_CONFIG.maxDelay
    );

    console.log(`Migration attempt ${this.migrationAttempts}/${MIGRATION_CONFIG.maxAttempts} in ${delay}ms`);

    this.migrationTimeout = setTimeout(() => {
      if (this.serverConnected) {
        signalingClient.claimHost(this.roomId);
      } else {
        // No server connection, retry after delay
        this.attemptClaimHost();
      }
    }, delay);
  }

  handleBecameHost({ roomId }) {
    console.log('Successfully became new host');
    this.cancelMigration();
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

        // If this peer was holding any dice sets, clear those holders
        const setsHeld = this.roomState.getSetsHeldByPeer(peerId);
        if (setsHeld.length > 0) {
          for (const setId of setsHeld) {
            this.roomState.clearHolder(setId);
            this.holders.delete(setId);

            // Broadcast that this set is no longer held
            this.roomState.broadcast({
              type: MSG.DICE_HELD,
              setId,
              holderPeerId: null,
              holderUsername: null
            });
          }

          this.updateDiceRollerState();
        }

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
        // Someone else will be host, update our reference
        this.hostPeerId = nextHost.peerId;
        console.log(`Expecting ${nextHost.peerId} to become new host`);

        // Try to connect to new host with exponential backoff
        this.attemptConnectToNewHost(nextHost.peerId, 0);
      }
    }
  }

  attemptConnectToNewHost(peerId, attempt) {
    if (attempt >= MIGRATION_CONFIG.maxAttempts) {
      console.log('Failed to connect to new host after max attempts');
      this.showStatus('Lost connection to room', 'disconnected');
      return;
    }

    const delay = Math.min(
      MIGRATION_CONFIG.initialDelay * Math.pow(MIGRATION_CONFIG.backoffMultiplier, attempt),
      MIGRATION_CONFIG.maxDelay
    );

    setTimeout(() => {
      if (!this.isHost && this.hostPeerId === peerId) {
        console.log(`Attempting to connect to new host ${peerId} (attempt ${attempt + 1})`);
        webrtcManager.connectToPeer(peerId).catch(() => {
          this.attemptConnectToNewHost(peerId, attempt + 1);
        });
      }
    }, delay);
  }

  // === ROOM UI ===

  enterRoom() {
    // Hide join form, show room view
    this.roomJoin.style.display = 'none';
    this.roomView.show();
    this.roomView.setRoomId(this.roomId);
    this.roomView.setHostStatus(this.isHost);

    // Get component references
    this.diceConfig = this.roomView.querySelector('dice-config');
    this.diceRoller = this.roomView.querySelector('dice-roller');
    this.diceHistory = this.roomView.querySelector('dice-history');
    this.peerList = this.roomView.querySelector('peer-list');

    // Set up peer list with self (use effective ID for offline support)
    this.peerList.setSelf(this.getEffectiveId(), this.username);
    this.diceHistory.peerId = this.getEffectiveId();

    // Initialize dice roller state (for host, client gets this from WELCOME)
    if (this.isHost) {
      this.diceSettings = this.roomState.diceConfig;
      // Copy holders from room state
      this.holders.clear();
      for (const [setId, holder] of this.roomState.holders) {
        this.holders.set(setId, holder);
      }
      // Set the dice config UI
      if (this.diceConfig) {
        this.diceConfig.setConfig(this.diceSettings);
      }
    }
    this.updateDiceRollerState();

    console.log(`Entered room ${this.roomId} as ${this.username} (${this.isHost ? 'HOST' : 'CLIENT'})`);
  }

  // === DICE ROLLING ===

  handleLocalDiceGrab(e) {
    // User clicked to grab a dice set
    const setId = e?.detail?.setId;
    if (!setId) return;

    // Check if this set is already held
    if (this.holders.has(setId)) {
      return;
    }

    const myId = this.getEffectiveId();

    if (this.isHost) {
      // Host grabs immediately
      this.roomState.setHolder(setId, myId, this.username);
      this.holders.set(setId, { peerId: myId, username: this.username });

      // Broadcast to all peers
      this.roomState.broadcast({
        type: MSG.DICE_HELD,
        setId,
        holderPeerId: myId,
        holderUsername: this.username
      });

      this.updateDiceRollerState();
    } else {
      // Client: send grab request to host
      this.sendToHost({ type: MSG.GRAB_DICE, setId });
    }
  }

  handleLocalDiceConfigChange({ diceSets }) {
    if (!this.isHost) return; // Only host can change config

    this.diceSettings = { diceSets };
    this.roomState.setDiceConfig({ diceSets });

    // Clear all holders when config changes
    this.roomState.clearAllHolders();
    this.holders.clear();

    // Broadcast to all peers
    this.roomState.broadcast({
      type: MSG.DICE_CONFIG,
      diceConfig: { diceSets }
    });

    this.updateDiceRollerState();
  }

  handleLocalDiceDrop() {
    if (!this.isHost) return; // Only host can force drop
    if (this.holders.size === 0) return; // No one is holding

    // Clear all holders
    this.roomState.clearAllHolders();
    this.holders.clear();

    // Broadcast that no one is holding anymore
    this.roomState.broadcast({
      type: MSG.DICE_HELD,
      setId: null,
      holderPeerId: null,
      holderUsername: null
    });

    this.updateDiceRollerState();
  }

  updateDiceRollerState() {
    if (!this.diceRoller) return;

    this.diceRoller.setConfig({
      diceSets: this.diceSettings.diceSets,
      holders: Array.from(this.holders.entries()),
      myPeerId: this.getEffectiveId(),
      isHost: this.isHost
    });

    // Update peer list to show who's holding (show first holder for now)
    if (this.peerList) {
      const firstHolder = this.holders.size > 0 ? this.holders.values().next().value : null;
      this.peerList.setHolder(firstHolder?.peerId || null);
    }
  }

  handleLocalDiceRoll({ diceType, rollResults, total, holders }) {
    // Generate a unique roll ID for duplicate prevention
    const rollId = `${this.getEffectiveId()}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Build set results with holder info
    const setResults = [];
    for (const set of this.diceSettings.diceSets) {
      const values = rollResults[set.id] || [];
      // Get holder from the event (which has the holders at time of roll)
      const holderEntry = holders?.find(([setId]) => setId === set.id);
      const holder = holderEntry ? holderEntry[1] : this.holders.get(set.id);
      setResults.push({
        setId: set.id,
        color: set.color,
        values,
        holderId: holder?.peerId || this.getEffectiveId(),
        holderUsername: holder?.username || this.username
      });
    }

    // Clear holders since we rolled
    this.holders.clear();

    const roll = {
      setResults,
      total,
      rollId,
      timestamp: Date.now()
    };

    if (this.isHost) {
      // Host: clear holders, add to state and broadcast
      this.roomState.clearAllHolders();
      this.roomState.addRoll(roll);
      this.roomState.broadcast({ type: MSG.DICE_ROLL, ...roll });

      // Add to local UI
      if (this.diceHistory) {
        this.diceHistory.addRoll(roll);
      }
    } else {
      // Client: track this roll as pending to prevent duplicate display
      this.pendingRolls.add(rollId);

      // Send to host for broadcast
      this.sendToHost({
        type: MSG.ROLL_DICE,
        diceType,
        rollResults,
        total,
        rollId
      });

      // Optimistically add to local UI
      if (this.diceHistory) {
        this.diceHistory.addRoll(roll);
      }

      // Clean up pending roll after timeout (in case host never confirms)
      setTimeout(() => {
        this.pendingRolls.delete(rollId);
      }, 10000);
    }

    this.updateDiceRollerState();
  }

  sendToHost(message) {
    if (this.hostPeerId) {
      webrtcManager.sendToPeer(this.hostPeerId, message);
    }
  }

  // === LEAVE ROOM ===

  leaveRoom() {
    this.cancelMigration();

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
    this.pendingRolls.clear();
    this.diceSettings = {
      diceSets: [{ id: 'set-1', count: 2, color: '#ffffff' }]
    };
    this.holders.clear();

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
      this.roomJoin.setDisconnected();
    }
  }
}

// Initialize app - modules are deferred so DOM is already ready
window.diceBoxApp = new DiceBoxApp();
