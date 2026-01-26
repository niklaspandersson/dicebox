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
      .onMessage(MSG.DICE_DROP, (peerId, msg) => this.handleDiceDropMsg(peerId, msg))
      .onMessage(MSG.DICE_LOCK, (peerId, msg) => this.handleDiceLockMsg(peerId, msg));
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

    document.addEventListener('dice-lock-changed', (e) => {
      this.handleLocalDiceLock(e.detail);
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

      // Clear saved states for this set (dice have been rolled by someone)
      meshState.clearSavedStateForSet(sr.setId);

      // Update lock state from roll
      const lockInfo = roll.lockedDice?.find(l => l.setId === sr.setId);
      if (lockInfo && lockInfo.lockedIndices.length > 0) {
        meshState.setLockState(sr.setId, lockInfo.lockedIndices, lockInfo.values);
      } else {
        meshState.clearLocksForSet(sr.setId);
      }

      // Clear holder rolled flag (holders are cleared)
      meshState.clearHolderRolled(sr.setId);

      // Set last roller
      meshState.setLastRoller(sr.setId, sr.holderId, sr.holderUsername);
    }

    // Update UI
    if (this.diceRoller) {
      this.diceRoller.showRoll(rollResults, roll.lockedDice);
    }

    if (this.diceHistory) {
      this.diceHistory.addRoll(roll);
    }

    this.updateDiceRollerState();
  }

  handleDiceGrabMsg(peerId, { setId, username, restoredLock }) {
    const meshState = this.roomManager.getMeshState();

    // Note: Don't clear lastRoller here - it should persist until someone actually rolls.
    // This allows the lastRoller to retain locking ability if they grab and drop without rolling.

    // Clear existing locks when someone grabs
    meshState.clearLocksForSet(setId);
    meshState.clearHolderRolled(setId);

    // Set holder in state
    meshState.setHolder(setId, peerId, username);

    // Restore lock state if provided (same user picking up their dice)
    if (restoredLock && restoredLock.lockedIndices && restoredLock.lockedIndices.length > 0) {
      meshState.setLockState(setId, restoredLock.lockedIndices, restoredLock.values);
      meshState.setHolderHasRolled(setId); // They had rolled before
    }

    this.updateDiceRollerState();
  }

  handleDiceDropMsg(peerId, { setId }) {
    const meshState = this.roomManager.getMeshState();

    // Clear holder
    if (setId) {
      meshState.clearHolder(setId);
      meshState.clearHolderRolled(setId);
      // Note: Don't clear locks here - they may be restored if same user picks up
    } else {
      // Clear all sets held by this peer
      const setsHeld = meshState.getSetsHeldByPeer(peerId);
      for (const heldSetId of setsHeld) {
        meshState.clearHolder(heldSetId);
        meshState.clearHolderRolled(heldSetId);
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
        meshState.clearLocksForSet(setId);
        meshState.clearHolderRolled(setId);

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
    const diceConfig = meshState.getDiceConfig();
    const allowLocking = diceConfig?.allowLocking || false;

    // Check if user has saved state to restore
    const savedState = allowLocking ? meshState.getSavedDiceState(setId, myId) : null;

    // Check if user is the lastRoller (they may have locked dice after rolling)
    const lastRoller = meshState.getLastRoller(setId);
    const iAmLastRoller = lastRoller && lastRoller.peerId === myId;

    // Save current locks if I'm lastRoller (before clearing)
    const currentLocks = iAmLastRoller ? meshState.getLockedDice(setId) : null;

    // Grab locally
    if (meshState.tryGrab(setId, myId, this.roomManager.username)) {
      // Note: Don't clear lastRoller here - it should persist until someone actually rolls.
      // This allows the lastRoller to retain locking ability if they grab and drop without rolling.

      // Determine what lock state to use
      let lockToRestore = null;

      if (iAmLastRoller && currentLocks) {
        // I was lastRoller and had locks - preserve them
        lockToRestore = {
          lockedIndices: [...currentLocks.lockedIndices],
          values: Array.isArray(currentLocks.values)
            ? [...currentLocks.values]
            : [...currentLocks.values.values()]
        };
      } else if (savedState) {
        // Restore from saved state (dropped dice scenario)
        lockToRestore = savedState;
      }

      // Clear locks for this set (will be restored below if applicable)
      meshState.clearLocksForSet(setId);
      meshState.clearHolderRolled(setId);

      // Restore lock state if applicable
      if (lockToRestore) {
        meshState.setLockState(setId, lockToRestore.lockedIndices, lockToRestore.values);
        meshState.setHolderHasRolled(setId); // They had rolled before, so can continue locking

        // Update dice roller current values with locked values
        if (this.diceRoller) {
          const currentVals = this.diceRoller.currentValues[setId] || [];
          const newVals = [...currentVals];
          for (let i = 0; i < lockToRestore.lockedIndices.length; i++) {
            const idx = lockToRestore.lockedIndices[i];
            newVals[idx] = lockToRestore.values[i];
          }
          this.diceRoller.currentValues[setId] = newVals;
        }
      }

      // Broadcast to all peers
      this.messageRouter.broadcast({
        type: MSG.DICE_GRAB,
        setId,
        peerId: myId,
        username: this.roomManager.username,
        restoredLock: lockToRestore ? {
          lockedIndices: lockToRestore.lockedIndices,
          values: lockToRestore.values
        } : null
      });

      this.updateDiceRollerState();
    }
  }

  handleLocalDiceDrop() {
    const myId = this.connectionManager.getEffectiveId();
    const meshState = this.roomManager.getMeshState();
    const diceConfig = meshState.getDiceConfig();
    const allowLocking = diceConfig?.allowLocking || false;

    if (!meshState.isPeerHolding(myId)) return;

    const setsToRelease = meshState.getSetsHeldByPeer(myId);

    for (const setId of setsToRelease) {
      // Save lock state before releasing (if locking is enabled)
      if (allowLocking && this.diceRoller) {
        const lockedMap = this.diceRoller.lockedDice.get(setId);
        const currentValues = this.diceRoller.currentValues[setId] || [];

        if (lockedMap && lockedMap.size > 0) {
          const lockedIndices = [...lockedMap.keys()];
          const lockedValues = lockedIndices.map(idx => lockedMap.get(idx));
          meshState.saveDiceState(setId, myId, lockedIndices, currentValues);
        } else if (meshState.hasHolderRolled(setId)) {
          // Save current values even without locks if they've rolled
          meshState.saveDiceState(setId, myId, [], currentValues);
        }
      }

      meshState.clearHolder(setId);
      meshState.clearHolderRolled(setId);

      // Broadcast to all peers
      this.messageRouter.broadcast({
        type: MSG.DICE_DROP,
        setId,
        peerId: myId
      });
    }

    // Clear local lock state in the dice roller
    if (this.diceRoller) {
      this.diceRoller.clearLocks();
    }

    this.updateDiceRollerState();
  }

  handleLocalDiceRoll({ rollResults, total, holders, lockedDice }) {
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

      // Mark that holder has rolled (for locking)
      meshState.setHolderHasRolled(set.id);

      // Clear saved states for all peers for this set (dice have been rolled)
      meshState.clearSavedStateForSet(set.id);

      // Update lock state in mesh state
      const lockInfo = lockedDice?.find(l => l.setId === set.id);
      if (lockInfo && lockInfo.lockedIndices.length > 0) {
        meshState.setLockState(set.id, lockInfo.lockedIndices, lockInfo.values);
      } else {
        meshState.clearLocksForSet(set.id);
      }

      // Set last roller (for locking after dice are released)
      meshState.setLastRoller(set.id, myId, this.roomManager.username);
    }

    // Clear holders
    meshState.clearAllHolders();

    const roll = {
      setResults,
      total,
      rollId,
      timestamp: Date.now(),
      lockedDice: lockedDice || []
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

  handleLocalDiceLock({ setId, dieIndex, locked, value }) {
    const meshState = this.roomManager.getMeshState();
    const myId = this.connectionManager.getEffectiveId();

    // Update mesh state
    if (locked) {
      meshState.lockDie(setId, dieIndex, value);
    } else {
      meshState.unlockDie(setId, dieIndex);
    }

    // Broadcast to all peers
    this.messageRouter.broadcast({
      type: MSG.DICE_LOCK,
      setId,
      dieIndex,
      locked,
      value,
      peerId: myId
    });
  }

  handleDiceLockMsg(peerId, { setId, dieIndex, locked, value }) {
    const meshState = this.roomManager.getMeshState();

    // Update mesh state
    if (locked) {
      meshState.lockDie(setId, dieIndex, value);
    } else {
      meshState.unlockDie(setId, dieIndex);
    }

    // Update dice roller UI
    this.updateDiceRollerState();
  }

  updateDiceRollerState() {
    if (!this.diceRoller) return;

    const meshState = this.roomManager.getMeshState();
    const diceConfig = meshState.getDiceConfig();
    const holders = meshState.getHolders();

    // Prepare locked dice info for dice roller
    const lockedDice = [];
    for (const set of (diceConfig?.diceSets || [])) {
      const lock = meshState.getLockedDice(set.id);
      if (lock) {
        lockedDice.push([set.id, {
          lockedIndices: [...lock.lockedIndices],
          values: lock.values
        }]);
      }
    }

    // Prepare holder rolled state
    const holderHasRolled = [];
    for (const set of (diceConfig?.diceSets || [])) {
      if (meshState.hasHolderRolled(set.id)) {
        holderHasRolled.push([set.id, true]);
      }
    }

    // Prepare last roller info
    const lastRoller = [];
    for (const set of (diceConfig?.diceSets || [])) {
      const roller = meshState.getLastRoller(set.id);
      if (roller) {
        lastRoller.push([set.id, roller]);
      }
    }

    this.diceRoller.setConfig({
      diceSets: diceConfig?.diceSets || [],
      holders: Array.from(holders.entries()),
      myPeerId: this.connectionManager.getEffectiveId(),
      allowLocking: diceConfig?.allowLocking || false,
      lockedDice,
      holderHasRolled,
      lastRoller
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
