/**
 * DiceBox - Main Application
 * Host-based P2P room model with host migration
 * Refactored to use independent managers for better separation of concerns
 */
import { signalingClient } from './signaling-client.js';
import { webrtcManager } from './webrtc-manager.js';
import { ConnectionManager } from './connection-manager.js';
import { RoomManager } from './room-manager.js';
import { DiceStateManager } from './dice-state-manager.js';
import { HostMigrationManager } from './host-migration-manager.js';
import { MessageRouter, MSG } from './message-router.js';

class DiceBoxApp {
  constructor() {
    // Initialize managers
    this.connectionManager = new ConnectionManager();
    this.roomManager = new RoomManager();
    this.diceState = new DiceStateManager();
    this.migrationManager = new HostMigrationManager();
    this.messageRouter = new MessageRouter();

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
    this.setupMessageHandlers();
    this.setupEventListeners();
    this.setupManagerEvents();

    // Show connecting state
    if (this.roomJoin) {
      this.roomJoin.setConnecting();
    }

    const connected = await this.connectionManager.connect();
    if (connected && this.roomJoin) {
      this.roomJoin.setConnected();
    } else if (this.roomJoin) {
      this.roomJoin.setDisconnected();
    }
  }

  // === MESSAGE HANDLERS SETUP ===

  setupMessageHandlers() {
    // Host-only message handlers
    this.messageRouter
      .onHostMessage(MSG.INTRODUCE, (peerId, msg) => this.hostHandleIntroduce(peerId, msg))
      .onHostMessage(MSG.ROLL_DICE, (peerId, msg) => this.hostHandleRollDice(peerId, msg))
      .onHostMessage(MSG.GRAB_DICE, (peerId, msg) => this.hostHandleGrabDice(peerId, msg))
      .onHostMessage(MSG.DROP_DICE, (peerId) => this.hostHandleDropDice(peerId));

    // Client-only message handlers
    this.messageRouter
      .onClientMessage(MSG.WELCOME, (_, msg) => this.clientHandleWelcome(msg));

    // Messages for all peers
    this.messageRouter
      .onMessage(MSG.PEER_JOINED, (_, msg) => this.handlePeerJoinedMsg(msg))
      .onMessage(MSG.PEER_LEFT, (_, msg) => this.handlePeerLeftMsg(msg))
      .onMessage(MSG.DICE_ROLL, (peerId, msg) => this.handleDiceRollMsg(peerId, msg))
      .onMessage(MSG.DICE_CONFIG, (_, msg) => this.handleDiceConfigMsg(msg))
      .onMessage(MSG.DICE_HELD, (_, msg) => this.handleDiceHeldMsg(msg))
      .onMessage(MSG.HOST_LEAVING, (peerId, msg) => this.handleHostLeavingMsg(peerId, msg));
  }

  // === MANAGER EVENTS SETUP ===

  setupManagerEvents() {
    // Connection manager events
    this.connectionManager.setupEventListeners({
      onConnected: () => {
        if (this.roomJoin && this.roomJoin.style.display !== 'none') {
          this.roomJoin.setConnected();
        }
      },
      onDisconnected: () => {
        if (this.roomJoin && this.roomJoin.style.display !== 'none') {
          this.roomJoin.setDisconnected();
        }
      },
      onReconnected: (detail) => {
        if (this.roomManager.roomId && this.roomManager.isHost) {
          console.log('Re-registering as host for room:', this.roomManager.roomId);
          signalingClient.registerHost(this.roomManager.roomId);
        }
      },
      onReconnectFailed: () => {
        if (this.roomJoin && this.roomJoin.style.display !== 'none') {
          this.roomJoin.setDisconnected();
        }
      },
      onServerError: (detail) => {
        if (detail.errorType === 'rate-limit') {
          this.connectionManager.showStatus('Rate limited - slow down', 'disconnected');
        }
      }
    });

    // Room manager events
    this.roomManager.setupSignalingEvents({
      onRegisterHostFailed: () => {
        this.connectionManager.showStatus('Room already exists', 'disconnected');
      },
      onJoinFailed: ({ reason }) => {
        this.connectionManager.showStatus(reason || 'Room not found', 'disconnected');
      },
      onHostDisconnected: ({ roomId }) => {
        if (!this.roomManager.isHost && this.roomManager.roomId === roomId) {
          console.log('Host disconnected, initiating migration...');
          this.connectionManager.showStatus('Host disconnected, reconnecting...', 'connecting');
          this.migrationManager.initiate(roomId, this.connectionManager.serverConnected);
        }
      },
      onRoomClosed: ({ roomId, reason }) => {
        if (this.roomManager.roomId === roomId) {
          console.log(`Room closed: ${reason}`);
          this.connectionManager.showStatus(reason || 'Room closed', 'disconnected');
          this.leaveRoom();
        }
      },
      onSessionRestored: ({ roomId }) => {
        if (roomId && this.roomView.classList.contains('active')) {
          // We were in a room and got restored - re-establish WebRTC connections
          console.log('Session restored while in room, re-establishing connections...');
          this.connectionManager.showStatus('Reconnecting...', 'connecting');
          this.handleSessionRestored(roomId);
        }
      },
      onHostReconnected: ({ roomId, hostPeerId }) => {
        if (this.roomManager.roomId === roomId && !this.roomManager.isHost) {
          console.log('Host reconnected, re-establishing connection...');
          this.connectionManager.showStatus('Host reconnected', 'connected');
          // Re-connect to host via WebRTC
          this.reconnectToHost(hostPeerId);
        }
      }
    });

    this.roomManager.addEventListener('room-created', () => {
      this.enterRoom();
    });

    this.roomManager.addEventListener('claim-host-success', (e) => {
      this.handleBecameHost(e.detail);
    });

    this.roomManager.addEventListener('claim-host-failed', () => {
      this.migrationManager.cancel();
    });

    // Migration manager events
    this.migrationManager.addEventListener('migration-failed', () => {
      this.connectionManager.showStatus('Failed to migrate host', 'disconnected');
    });

    this.migrationManager.addEventListener('connection-to-new-host-failed', () => {
      this.connectionManager.showStatus('Lost connection to room', 'disconnected');
    });
  }

  // === UI EVENT LISTENERS ===

  setupEventListeners() {
    // Room join UI events
    document.addEventListener('join-room', (e) => {
      const { roomId, username, isHost } = e.detail;
      if (isHost) {
        this.roomManager.createRoom(
          roomId,
          username,
          this.connectionManager.getEffectiveId(),
          this.connectionManager.serverConnected
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

    document.addEventListener('dice-config-changed', (e) => {
      this.handleLocalDiceConfigChange(e.detail);
    });

    document.addEventListener('dice-dropped', () => {
      this.handleLocalDiceDrop();
    });

    // WebRTC events
    this.setupWebRTCEvents();
  }

  async retryConnection() {
    if (this.roomJoin) {
      this.roomJoin.setConnecting();
    }
    const connected = await this.connectionManager.retryConnection();
    if (connected && this.roomJoin) {
      this.roomJoin.setConnected();
    }
  }

  setupWebRTCEvents() {
    const roomState = this.roomManager.getRoomState();

    webrtcManager.addEventListener('channel-open', (e) => {
      const { peerId, channel } = e.detail;
      console.log(`Channel opened with ${peerId}`);

      if (this.roomManager.isHost) {
        roomState.setPeerChannel(peerId, channel);
      } else if (peerId === this.roomManager.hostPeerId) {
        this.messageRouter.sendToHost(this.roomManager.hostPeerId, {
          type: MSG.INTRODUCE,
          username: this.roomManager.username
        });
      }
    });

    webrtcManager.addEventListener('message', (e) => {
      this.messageRouter.route(
        e.detail.peerId,
        e.detail.message,
        this.roomManager.isHost
      );
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

      if (!this.roomManager.isHost && peerId === this.roomManager.hostPeerId) {
        this.handlePeerDisconnected(peerId);
      }
    });
  }

  // === HOST MESSAGE HANDLERS ===

  hostHandleIntroduce(peerId, { username }) {
    console.log(`Peer ${peerId} introduced as ${username}`);
    const roomState = this.roomManager.getRoomState();

    const channel = webrtcManager.getDataChannel(peerId);
    roomState.addPeer(peerId, username, channel);

    const state = roomState.getState();
    webrtcManager.sendToPeer(peerId, {
      type: MSG.WELCOME,
      yourJoinOrder: roomState.peers.get(peerId).joinOrder,
      peers: [
        {
          peerId: this.connectionManager.peerId,
          username: this.roomManager.username,
          joinOrder: this.roomManager.myJoinOrder
        },
        ...state.peers.filter(p => p.peerId !== peerId)
      ],
      rollHistory: state.rollHistory,
      diceConfig: state.diceConfig,
      holders: state.holders
    });

    roomState.broadcast({
      type: MSG.PEER_JOINED,
      peerId,
      username
    }, peerId);

    if (this.peerList) {
      this.peerList.addPeer(peerId, username, 'connected');
    }
  }

  hostHandleRollDice(peerId, { diceType, rollResults, total, rollId }) {
    const roomState = this.roomManager.getRoomState();
    const peer = roomState.peers.get(peerId);
    if (!peer) return;

    const diceSettings = this.diceState.getSettings();
    const finalSetResults = [];

    for (const set of diceSettings.diceSets) {
      const values = rollResults[set.id] || [];
      const holder = roomState.getHolder(set.id);
      finalSetResults.push({
        setId: set.id,
        color: set.color,
        values,
        holderId: holder?.peerId || peerId,
        holderUsername: holder?.username || peer.username
      });
    }

    roomState.clearAllHolders();
    this.diceState.clearAllHolders();

    const roll = {
      setResults: finalSetResults,
      total,
      rollId,
      timestamp: Date.now()
    };

    roomState.addRoll(roll);
    roomState.broadcast({ type: MSG.DICE_ROLL, ...roll });

    if (this.diceRoller) {
      this.diceRoller.showRoll(rollResults);
    }
    if (this.diceHistory) {
      this.diceHistory.addRoll(roll);
    }
    this.updateDiceRollerState();
  }

  hostHandleGrabDice(peerId, { setId }) {
    const roomState = this.roomManager.getRoomState();
    const peer = roomState.peers.get(peerId);
    if (!peer) return;

    if (roomState.getHolder(setId) !== null) {
      console.log(`Grab rejected - set ${setId} is already held`);
      return;
    }

    roomState.setHolder(setId, peerId, peer.username);
    this.diceState.setHolder(setId, peerId, peer.username);

    roomState.broadcast({
      type: MSG.DICE_HELD,
      setId,
      holderPeerId: peerId,
      holderUsername: peer.username
    });

    this.updateDiceRollerState();
  }

  hostHandleDropDice(peerId) {
    const roomState = this.roomManager.getRoomState();
    const setsHeld = roomState.getSetsHeldByPeer(peerId);
    if (setsHeld.length === 0) return;

    for (const setId of setsHeld) {
      roomState.clearHolder(setId);
      this.diceState.clearHolder(setId);

      roomState.broadcast({
        type: MSG.DICE_HELD,
        setId,
        holderPeerId: null,
        holderUsername: null
      });
    }

    this.updateDiceRollerState();
  }

  // === CLIENT MESSAGE HANDLERS ===

  clientHandleWelcome({ yourJoinOrder, peers, rollHistory, diceConfig, holders }) {
    console.log('Received welcome from host');
    this.roomManager.setJoinOrder(yourJoinOrder);

    this.diceState.setSettings(diceConfig);
    this.diceState.loadHolders(holders);

    this.enterRoom();

    for (const peer of peers) {
      if (peer.peerId !== this.connectionManager.peerId) {
        this.peerList.addPeer(peer.peerId, peer.username, 'connected');
      }
    }

    for (const roll of rollHistory.slice().reverse()) {
      this.diceHistory.addRoll(roll);
    }

    this.updateDiceRollerState();
  }

  // === COMMON MESSAGE HANDLERS ===

  handlePeerJoinedMsg({ peerId, username }) {
    if (peerId === this.connectionManager.peerId) return;

    if (this.peerList) {
      this.peerList.addPeer(peerId, username, 'connected');
    }
  }

  handlePeerLeftMsg({ peerId }) {
    if (this.peerList) {
      this.peerList.removePeer(peerId);
    }
  }

  handleDiceRollMsg(fromPeerId, { setResults, total, rollId, timestamp }) {
    this.diceState.clearAllHolders();
    this.updateDiceRollerState();

    const weRolled = setResults?.some(sr => sr.holderId === this.connectionManager.peerId);
    if (weRolled && rollId && this.diceState.isPendingRoll(rollId)) {
      this.diceState.removePendingRoll(rollId);
      return;
    }

    const rollResults = {};
    for (const sr of (setResults || [])) {
      rollResults[sr.setId] = sr.values;
    }

    if (this.diceRoller) {
      this.diceRoller.showRoll(rollResults);
    }

    if (this.diceHistory) {
      this.diceHistory.addRoll({ setResults, total, rollId, timestamp });
    }
  }

  handleDiceConfigMsg({ diceConfig }) {
    this.diceState.setSettings(diceConfig);
    this.diceState.clearAllHolders();
    this.updateDiceRollerState();
  }

  handleDiceHeldMsg({ setId, holderPeerId, holderUsername }) {
    if (holderPeerId === null) {
      if (setId) {
        this.diceState.clearHolder(setId);
      } else {
        this.diceState.clearAllHolders();
      }
    } else {
      this.diceState.setHolder(setId, holderPeerId, holderUsername);
    }
    this.updateDiceRollerState();
  }

  handleHostLeavingMsg(fromPeerId, { nextHostPeerId, roomState }) {
    console.log(`Host is leaving, next host: ${nextHostPeerId}`);

    this.roomManager.getRoomState().loadState(roomState);

    if (nextHostPeerId === this.connectionManager.peerId) {
      this.migrationManager.initiate(this.roomManager.roomId, this.connectionManager.serverConnected);
    } else {
      this.roomManager.setHostPeerId(nextHostPeerId);
    }
  }

  // === HOST MIGRATION ===

  handleBecameHost({ roomId }) {
    console.log('Successfully became new host');
    this.migrationManager.cancel();
    this.roomManager.becomeHost(this.connectionManager.peerId);

    this.connectionManager.showStatus('You are now the host', 'connected');

    const roomState = this.roomManager.getRoomState();
    for (const [peerId] of roomState.peers) {
      if (peerId !== this.connectionManager.peerId) {
        const channel = webrtcManager.getDataChannel(peerId);
        if (channel) {
          roomState.setPeerChannel(peerId, channel);
        }
      }
    }

    if (this.roomView) {
      this.roomView.setHostStatus(true);
    }
  }

  /**
   * Handle session restoration after reconnect
   */
  handleSessionRestored(roomId) {
    // If we were the host, we should have been automatically restored
    // If we were a client, we need to reconnect to the host
    if (this.roomManager.isHost) {
      console.log('Session restored as host, waiting for peers to reconnect');
      this.connectionManager.showStatus('Reconnected as host', 'connected');
    } else if (this.roomManager.hostPeerId) {
      // Reconnect to host
      this.reconnectToHost(this.roomManager.hostPeerId);
    }
  }

  /**
   * Reconnect to host after session restoration or host reconnection
   */
  reconnectToHost(hostPeerId) {
    console.log(`Reconnecting to host: ${hostPeerId}`);

    // Close any existing connection to this peer
    webrtcManager.closePeerConnection(hostPeerId);

    // Initiate new connection
    webrtcManager.connectToPeer(hostPeerId)
      .then(() => {
        console.log('WebRTC connection to host re-established');
        this.connectionManager.showStatus('Connected', 'connected');
      })
      .catch((error) => {
        console.error('Failed to reconnect to host:', error);
        this.connectionManager.showStatus('Failed to reconnect', 'disconnected');
      });
  }

  handlePeerDisconnected(peerId) {
    console.log(`Peer disconnected: ${peerId}`);
    const roomState = this.roomManager.getRoomState();

    if (this.roomManager.isHost) {
      const peer = roomState.peers.get(peerId);
      if (peer) {
        roomState.removePeer(peerId);

        const setsHeld = roomState.getSetsHeldByPeer(peerId);
        if (setsHeld.length > 0) {
          for (const setId of setsHeld) {
            roomState.clearHolder(setId);
            this.diceState.clearHolder(setId);

            roomState.broadcast({
              type: MSG.DICE_HELD,
              setId,
              holderPeerId: null,
              holderUsername: null
            });
          }
          this.updateDiceRollerState();
        }

        roomState.broadcast({
          type: MSG.PEER_LEFT,
          peerId,
          username: peer.username
        });

        if (this.peerList) {
          this.peerList.removePeer(peerId);
        }
      }
    } else if (peerId === this.roomManager.hostPeerId) {
      console.log('Host disconnected! Initiating migration...');
      this.connectionManager.showStatus('Host disconnected, migrating...', 'connecting');

      const nextHost = roomState.getNextHostCandidate(this.roomManager.hostPeerId);

      if (this.migrationManager.shouldBecomeHost(
        this.roomManager.myJoinOrder,
        nextHost,
        this.roomManager.hostPeerId
      )) {
        this.migrationManager.initiate(this.roomManager.roomId, this.connectionManager.serverConnected);
      } else {
        this.roomManager.setHostPeerId(nextHost.peerId);
        console.log(`Expecting ${nextHost.peerId} to become new host`);

        this.migrationManager.attemptConnectToNewHost(nextHost.peerId, 0, (pId) => {
          return !this.roomManager.isHost && this.roomManager.hostPeerId === pId;
        });
      }
    }
  }

  // === ROOM UI ===

  enterRoom() {
    this.roomJoin.style.display = 'none';
    this.roomView.show();
    this.roomView.setRoomId(this.roomManager.roomId);
    this.roomView.setHostStatus(this.roomManager.isHost);

    this.diceConfig = this.roomView.querySelector('dice-config');
    this.diceRoller = this.roomView.querySelector('dice-roller');
    this.diceHistory = this.roomView.querySelector('dice-history');
    this.peerList = this.roomView.querySelector('peer-list');

    this.peerList.setSelf(this.connectionManager.getEffectiveId(), this.roomManager.username);
    this.diceHistory.peerId = this.connectionManager.getEffectiveId();

    if (this.roomManager.isHost) {
      const roomState = this.roomManager.getRoomState();
      this.diceState.setSettings(roomState.diceConfig);

      const holders = this.diceState.getHolders();
      holders.clear();
      for (const [setId, holder] of roomState.holders) {
        holders.set(setId, holder);
      }

      if (this.diceConfig) {
        this.diceConfig.setConfig(this.diceState.getSettings());
      }
    }
    this.updateDiceRollerState();

    console.log(`Entered room ${this.roomManager.roomId} as ${this.roomManager.username} (${this.roomManager.isHost ? 'HOST' : 'CLIENT'})`);
  }

  // === LOCAL DICE ACTIONS ===

  handleLocalDiceGrab(e) {
    const setId = e?.detail?.setId;
    if (!setId) return;

    if (this.diceState.isSetHeld(setId)) {
      return;
    }

    const myId = this.connectionManager.getEffectiveId();

    if (this.roomManager.isHost) {
      const roomState = this.roomManager.getRoomState();
      roomState.setHolder(setId, myId, this.roomManager.username);
      this.diceState.setHolder(setId, myId, this.roomManager.username);

      roomState.broadcast({
        type: MSG.DICE_HELD,
        setId,
        holderPeerId: myId,
        holderUsername: this.roomManager.username
      });

      this.updateDiceRollerState();
    } else {
      this.messageRouter.sendToHost(this.roomManager.hostPeerId, {
        type: MSG.GRAB_DICE,
        setId
      });
    }
  }

  handleLocalDiceConfigChange({ diceSets }) {
    if (!this.roomManager.isHost) return;

    const roomState = this.roomManager.getRoomState();
    this.diceState.setSettings({ diceSets });
    roomState.setDiceConfig({ diceSets });

    roomState.clearAllHolders();
    this.diceState.clearAllHolders();

    roomState.broadcast({
      type: MSG.DICE_CONFIG,
      diceConfig: { diceSets }
    });

    this.updateDiceRollerState();
  }

  handleLocalDiceDrop() {
    const myId = this.connectionManager.getEffectiveId();

    if (!this.diceState.isPeerHolding(myId)) return;

    if (this.roomManager.isHost) {
      const roomState = this.roomManager.getRoomState();
      const setsToRelease = this.diceState.getSetsHeldByPeer(myId);

      for (const setId of setsToRelease) {
        roomState.clearHolder(setId);
        this.diceState.clearHolder(setId);

        roomState.broadcast({
          type: MSG.DICE_HELD,
          setId,
          holderPeerId: null,
          holderUsername: null
        });
      }

      this.updateDiceRollerState();
    } else {
      this.messageRouter.sendToHost(this.roomManager.hostPeerId, {
        type: MSG.DROP_DICE
      });
    }
  }

  handleLocalDiceRoll({ diceType, rollResults, total, holders }) {
    const myId = this.connectionManager.getEffectiveId();
    const rollId = this.diceState.generateRollId(myId);

    const setResults = this.diceState.buildSetResultsWithHolders(
      rollResults,
      holders,
      myId,
      this.roomManager.username
    );

    this.diceState.clearAllHolders();

    const roll = {
      setResults,
      total,
      rollId,
      timestamp: Date.now()
    };

    if (this.roomManager.isHost) {
      const roomState = this.roomManager.getRoomState();
      roomState.clearAllHolders();
      roomState.addRoll(roll);
      roomState.broadcast({ type: MSG.DICE_ROLL, ...roll });

      if (this.diceHistory) {
        this.diceHistory.addRoll(roll);
      }
    } else {
      this.diceState.addPendingRoll(rollId);

      this.messageRouter.sendToHost(this.roomManager.hostPeerId, {
        type: MSG.ROLL_DICE,
        diceType,
        rollResults,
        total,
        rollId
      });

      if (this.diceHistory) {
        this.diceHistory.addRoll(roll);
      }
    }

    this.updateDiceRollerState();
  }

  updateDiceRollerState() {
    if (!this.diceRoller) return;

    const diceSettings = this.diceState.getSettings();
    const holders = this.diceState.getHolders();

    this.diceRoller.setConfig({
      diceSets: diceSettings.diceSets,
      holders: Array.from(holders.entries()),
      myPeerId: this.connectionManager.getEffectiveId(),
      isHost: this.roomManager.isHost
    });

    if (this.peerList) {
      const holderInfo = new Map();
      for (const [setId, holder] of holders) {
        if (!holderInfo.has(holder.peerId)) {
          const set = diceSettings.diceSets.find(s => s.id === setId);
          holderInfo.set(holder.peerId, set?.color || '#f59e0b');
        }
      }
      this.peerList.setHolders(holderInfo);
    }
  }

  // === LEAVE ROOM ===

  leaveRoom() {
    this.migrationManager.cancel();

    if (this.roomManager.isHost) {
      const roomState = this.roomManager.getRoomState();
      const nextHost = roomState.getNextHostCandidate();

      if (nextHost) {
        roomState.broadcast({
          type: MSG.HOST_LEAVING,
          nextHostPeerId: nextHost.peerId,
          roomState: roomState.getState()
        });
      }
    }

    this.roomManager.leaveRoom();
    this.diceState.reset();

    this.connectionManager.peerId = signalingClient.peerId;

    if (this.peerList) this.peerList.clear();
    if (this.diceHistory) this.diceHistory.clear();

    this.roomJoin.style.display = 'block';
    this.roomView.hide();

    if (this.connectionManager.serverConnected) {
      this.roomJoin.setConnected();
    } else {
      this.roomJoin.setDisconnected();
    }
  }
}

// Initialize app - modules are deferred so DOM is already ready
window.diceBoxApp = new DiceBoxApp();
