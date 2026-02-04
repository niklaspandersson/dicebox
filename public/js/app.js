/**
 * DiceBox - Main Application
 * Mesh topology: all peers are equal, no host/client distinction
 *
 * Now uses the new strategy-based dice rolling architecture.
 */
import { signalingClient } from "./signaling-client.js";
import { webrtcManager } from "./webrtc-manager.js";
import { ConnectionManager } from "./connection-manager.js";
import { RoomManager } from "./room-manager.js";
import { MessageRouter, MSG } from "./message-router.js";

// Import new architecture
import { createApp } from "../../src/app/App.js";
import { LegacyBridge } from "../../src/infrastructure/network/LegacyBridge.js";

class DiceBoxApp {
  constructor() {
    // Initialize managers
    this.connectionManager = new ConnectionManager();
    this.roomManager = new RoomManager();
    this.messageRouter = new MessageRouter();

    // UI components
    this.headerBar = document.querySelector("header-bar");
    this.roomView = document.getElementById("room-view");
    this.diceRoller = null; // Legacy reference (unused, kept for compatibility)
    this.diceHistory = null;
    this.peerList = null;

    // New strategy-based dice app
    this.diceApp = null;

    this.init();
  }

  #showView(id) {
    const fullId = `${id}-view`
    for(const view of document.querySelectorAll('.view')) {
      view.classList.toggle("active", fullId === view.id)
    }
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
      .onMessage(MSG.REQUEST_STATE, (peerId, msg) =>
        this.handleRequestState(peerId, msg),
      )
      .onMessage(MSG.PEER_JOINED, (peerId, msg) =>
        this.handlePeerJoinedMsg(peerId, msg),
      )
      .onMessage(MSG.PEER_LEFT, (peerId, msg) =>
        this.handlePeerLeftMsg(peerId, msg),
      )
      .onMessage(MSG.DICE_ROLL, (peerId, msg) =>
        this.handleDiceRollMsg(peerId, msg),
      )
      .onMessage(MSG.DICE_GRAB, (peerId, msg) =>
        this.handleDiceGrabMsg(peerId, msg),
      )
      .onMessage(MSG.DICE_DROP, (peerId, msg) =>
        this.handleDiceDropMsg(peerId, msg),
      )
      .onMessage(MSG.DICE_LOCK, (peerId, msg) =>
        this.handleDiceLockMsg(peerId, msg),
      );
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
      onServerError: () => {},
    });

    // Room manager events
    this.roomManager.setupSignalingEvents({
      onCreateRoomFailed: ({ reason }) => {
        console.error("Failed to create room:", reason);
      },
      onJoinFailed: ({ reason }) => {
        console.error("Failed to join room:", reason);
      },
      onPeerDisconnected: ({ peerId }) => {
        // Handle WebRTC disconnection
        webrtcManager.closePeerConnection(peerId);
        if (this.peerList) {
          this.peerList.removePeer(peerId);
        }
        // Note: Dice state updates handled by DiceStore subscriptions
      },
      onSessionRestored: ({ roomId }) => {
        if (roomId && this.roomView.classList.contains("active")) {
          console.log("Session restored while in room, reconnecting...");
          if (this.peerList) {
            this.peerList.setSelfStatus("connecting");
          }
          // Re-query room to get current peers
          signalingClient.queryRoom(roomId);
        }
      },
    });

    this.roomManager.addEventListener("room-created", () => {
      this.enterRoom();
    });

    this.roomManager.addEventListener("peer-left", (e) => {
      const { peerId, username } = e.detail;
      if (this.peerList) {
        this.peerList.removePeer(peerId);
      }
      // Clear any dice sets held by this peer
      const meshState = this.roomManager.getMeshState();
      const setsHeld = meshState.getSetsHeldByPeer(peerId);
      for (const setId of setsHeld) {
        meshState.clearHolder(setId);
        // Update new DiceStore
        if (this.diceApp) {
          this.diceApp.diceStore.clearHolder(setId);
        }
      }
    });
  }

  // === UI EVENT LISTENERS ===

  setupEventListeners() {
    // Room join UI events
    document.addEventListener("join-room", (e) => {
      const { roomId, username, isHost, diceConfig } = e.detail;
      if (isHost) {
        this.roomManager.createRoom(
          roomId,
          username,
          this.connectionManager.getEffectiveId(),
          this.connectionManager.serverConnected,
          diceConfig,
        );
      } else {
        this.roomManager.joinRoom(
          roomId,
          username,
          this.connectionManager.serverConnected,
        );
      }
    });

    document.addEventListener("leave-room", () => {
      this.leaveRoom();
    });

    document.addEventListener("retry-connection", () => {
      this.retryConnection();
    });

    // Note: Local dice events (dice-rolled, dice-grabbed, etc.) are now handled
    // internally by the new strategy-based dice app. We only handle network
    // messages via the messageRouter handlers.

    document.addEventListener("dblclick", e => {
      e.preventDefault();
      e.stopPropagation();
    })

    // WebRTC events
    this.setupWebRTCEvents();
  }

  async retryConnection() {
    await this.connectionManager.retryConnection();
  }

  setupWebRTCEvents() {
    webrtcManager.addEventListener("channel-open", (e) => {
      const { peerId, channel } = e.detail;
      console.log(`Channel opened with ${peerId}`);

      // Reset self status to connected when we establish a peer connection
      // This handles the case where self was set to 'connecting' during session restoration
      if (this.peerList) {
        this.peerList.setSelfStatus("connected");
      }

      this.roomManager.markPeerConnected(peerId);

      // Send HELLO to introduce ourselves
      this.messageRouter.sendToPeer(peerId, {
        type: MSG.HELLO,
        username: this.roomManager.username,
      });

      // If we don't have state yet, request it from this peer
      if (!this.roomManager.hasReceivedState() && this.roomManager.inRoom()) {
        this.messageRouter.sendToPeer(peerId, {
          type: MSG.REQUEST_STATE,
        });
      }
    });

    webrtcManager.addEventListener("message", (e) => {
      this.messageRouter.route(e.detail.peerId, e.detail.message);
    });

    webrtcManager.addEventListener("peer-disconnected", (e) => {
      this.handlePeerDisconnected(e.detail.peerId);
    });

    webrtcManager.addEventListener("connection-state-change", (e) => {
      const { peerId, state } = e.detail;
      if (this.peerList) {
        this.peerList.updatePeerStatus(
          peerId,
          state === "connected" ? "connected" : "connecting",
        );
      }
    });

    webrtcManager.addEventListener("connection-timeout", (e) => {
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
      this.peerList.addPeer(peerId, username, "connected");
    }

    // If we already have state, broadcast that this peer joined to others
    if (this.roomManager.hasReceivedState()) {
      this.messageRouter.broadcast(
        {
          type: MSG.PEER_JOINED,
          peerId,
          username,
        },
        peerId,
      );
    }
  }

  handleRequestState(peerId, msg) {
    console.log(`Peer ${peerId} requested state`);
    const meshState = this.roomManager.getMeshState();

    // Send our current state to this peer
    this.messageRouter.sendToPeer(peerId, {
      type: MSG.WELCOME,
      state: meshState.getSnapshot(),
    });
  }

  handleWelcome(peerId, { state }) {
    console.log(`Received state from ${peerId}`);

    // Only accept state if we haven't received it yet
    if (this.roomManager.hasReceivedState()) {
      console.log("Already have state, ignoring");
      return;
    }

    this.roomManager.setReceivedStateFrom(peerId);
    const meshState = this.roomManager.getMeshState();

    // Load the state (includes diceConfig)
    meshState.loadSnapshot(state);

    // Now enter the room UI
    this.enterRoom();

    // Populate peer list and history from state
    for (const peer of state.peers || []) {
      if (peer.peerId !== this.connectionManager.peerId) {
        this.peerList.addPeer(peer.peerId, peer.username, "connected");
      }
    }

    for (const roll of (state.rollHistory || []).slice().reverse()) {
      this.diceHistory.addRoll(roll);
    }

    // Sync dice store from legacy state
    if (this.diceApp && this.diceApp.legacyBridge) {
      this.diceApp.legacyBridge.syncFromLegacy();
    }
  }

  handlePeerJoinedMsg(peerId, { peerId: newPeerId, username }) {
    if (newPeerId === this.connectionManager.peerId) return;

    const meshState = this.roomManager.getMeshState();
    meshState.addPeer(newPeerId, username);

    if (this.peerList) {
      this.peerList.addPeer(newPeerId, username, "connected");
    }
  }

  handlePeerLeftMsg(peerId, { peerId: leftPeerId }) {
    const meshState = this.roomManager.getMeshState();
    meshState.removePeer(leftPeerId);

    if (this.peerList) {
      this.peerList.removePeer(leftPeerId);
    }

    // Clear holder in new DiceStore if peer was holding dice
    if (this.diceApp) {
      const setsHeld = meshState.getSetsHeldByPeer(leftPeerId);
      for (const setId of setsHeld) {
        this.diceApp.diceStore.clearHolder(setId);
      }
    }
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

    // Update new DiceStore and legacy state
    for (const sr of roll.setResults || []) {
      // Clear saved states for this set (dice have been rolled by someone)
      meshState.clearSavedStateForSet(sr.setId);

      // Update lock state from roll
      const lockInfo = roll.lockedDice?.find((l) => l.setId === sr.setId);
      if (lockInfo && lockInfo.lockedIndices.length > 0) {
        meshState.setLockState(
          sr.setId,
          lockInfo.lockedIndices,
          lockInfo.values,
        );
      } else {
        meshState.clearLocksForSet(sr.setId);
      }

      // Clear holder rolled flag (holders are cleared)
      meshState.clearHolderRolled(sr.setId);

      // Set last roller
      meshState.setLastRoller(sr.setId, sr.holderId, sr.holderUsername);

      // Update new DiceStore
      if (this.diceApp) {
        this.diceApp.diceStore.applyRoll({
          setId: sr.setId,
          values: sr.values,
          playerId: sr.holderId,
          username: sr.holderUsername,
        });
        // Clear holder in new store
        this.diceApp.diceStore.clearHolder(sr.setId);
      }
    }

    if (this.diceHistory) {
      this.diceHistory.addRoll(roll);
    }
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
    if (
      restoredLock &&
      restoredLock.lockedIndices &&
      restoredLock.lockedIndices.length > 0
    ) {
      meshState.setLockState(
        setId,
        restoredLock.lockedIndices,
        restoredLock.values,
      );
      meshState.setHolderHasRolled(setId); // They had rolled before
    }

    // Update new DiceStore
    if (this.diceApp) {
      this.diceApp.diceStore.setHolder(setId, peerId, username);
    }
  }

  handleDiceDropMsg(peerId, { setId }) {
    const meshState = this.roomManager.getMeshState();

    // Clear holder
    if (setId) {
      meshState.clearHolder(setId);
      meshState.clearHolderRolled(setId);
      // Note: Don't clear locks here - they may be restored if same user picks up

      // Update new DiceStore
      if (this.diceApp) {
        this.diceApp.diceStore.clearHolder(setId);
      }
    } else {
      // Clear all sets held by this peer
      const setsHeld = meshState.getSetsHeldByPeer(peerId);
      for (const heldSetId of setsHeld) {
        meshState.clearHolder(heldSetId);
        meshState.clearHolderRolled(heldSetId);

        // Update new DiceStore
        if (this.diceApp) {
          this.diceApp.diceStore.clearHolder(heldSetId);
        }
      }
    }
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
          peerId,
        });
      }

      meshState.removePeer(peerId);

      // Broadcast peer left to others
      this.messageRouter.broadcast({
        type: MSG.PEER_LEFT,
        peerId,
        username: peer.username,
      });

      if (this.peerList) {
        this.peerList.removePeer(peerId);
      }

      // Clear holder in new DiceStore
      if (this.diceApp) {
        for (const setId of setsHeld) {
          this.diceApp.diceStore.clearHolder(setId);
        }
      }
    }
  }

  // === ROOM UI ===

  enterRoom() {
    // Hide any views in the play page
    this.#showView("room")

    this.headerBar.showRoomView(this.roomManager.roomId);

    // Get UI components
    const diceRollerContainer = this.roomView.querySelector("dice-roller-container");
    this.diceHistory = this.roomView.querySelector("dice-history");
    this.peerList = this.roomView.querySelector("peer-list");

    this.peerList.setSelf(
      this.connectionManager.getEffectiveId(),
      this.roomManager.username,
    );
    this.diceHistory.peerId = this.connectionManager.getEffectiveId();

    // Initialize the new strategy-based dice app
    const meshState = this.roomManager.getMeshState();
    const diceConfig = meshState.getDiceConfig() || {
      diceSets: [{ id: 'default', count: 2, color: '#ffffff' }],
      allowLocking: false,
    };

    const localPlayer = {
      id: this.connectionManager.getEffectiveId(),
      username: this.roomManager.username,
    };

    // Create network adapter for the new app
    const networkAdapter = {
      broadcast: (type, payload) => {
        const legacyMsg = this.#convertToLegacyMessage(type, payload);
        if (legacyMsg) {
          this.messageRouter.broadcast(legacyMsg);
        }
      },
    };

    // Create the new dice app
    this.diceApp = createApp({
      diceConfig,
      localPlayer,
      network: networkAdapter,
      strategyId: 'grab-and-roll',
    });

    // Mount to the container
    if (diceRollerContainer) {
      this.diceApp.mount(diceRollerContainer);
    }

    // Bridge to legacy state for initial sync
    this.diceApp.bridgeToLegacyState(meshState, {
      syncFromLegacy: true,
      enableTwoWaySync: false,
    });

    // Subscribe to dice store changes to update peer list holder indicators
    this.diceApp.diceStore.subscribe(() => {
      this.#updatePeerListHolders();
    });

    console.log(
      `Entered room ${this.roomManager.roomId} as ${this.roomManager.username}`,
    );
  }

  #convertToLegacyMessage(type, payload) {
    switch (type) {
      case 'dice:roll':
        return {
          type: MSG.DICE_ROLL,
          ...LegacyBridge.convertToLegacyRoll(payload),
        };
      case 'dice:grab':
        return {
          type: MSG.DICE_GRAB,
          ...LegacyBridge.convertToLegacyGrab(payload),
        };
      case 'dice:drop':
        return {
          type: MSG.DICE_DROP,
          setId: payload.setId,
        };
      case 'dice:lock':
        return {
          type: MSG.DICE_LOCK,
          setId: payload.setId,
          dieIndex: payload.dieIndex,
          locked: payload.locked,
          value: payload.value,
        };
      default:
        return null;
    }
  }

  #updatePeerListHolders() {
    if (!this.peerList || !this.diceApp) return;

    const diceConfig = this.diceApp.diceStore.diceConfig;
    const holders = this.diceApp.diceStore.holders;

    const holderInfo = new Map();
    for (const [setId, holder] of holders) {
      if (!holderInfo.has(holder.playerId)) {
        const set = diceConfig.diceSets?.find((s) => s.id === setId);
        holderInfo.set(holder.playerId, set?.color || "#f59e0b");
      }
    }
    this.peerList.setHolders(holderInfo);
  }

  // Note: Local dice actions are now handled by the new strategy-based dice app.
  // The strategy broadcasts messages through the network adapter we provide.

  handleDiceLockMsg(peerId, { setId, dieIndex, locked, value }) {
    const meshState = this.roomManager.getMeshState();

    // Update mesh state
    if (locked) {
      meshState.lockDie(setId, dieIndex, value);
    } else {
      meshState.unlockDie(setId, dieIndex);
    }

    // Update new DiceStore
    if (this.diceApp) {
      this.diceApp.diceStore.setLock(setId, dieIndex, locked);
    }
  }

  // Note: updateDiceRollerState has been removed - the new dice app handles
  // its own state updates through the DiceStore subscriptions.

  // === LEAVE ROOM ===

  leaveRoom() {
    // Broadcast that we're leaving
    this.messageRouter.broadcast({
      type: MSG.PEER_LEFT,
      peerId: this.connectionManager.peerId,
      username: this.roomManager.username,
    });

    this.roomManager.leaveRoom();
    this.connectionManager.peerId = signalingClient.peerId;

    if (this.peerList) this.peerList.clear();
    if (this.diceHistory) this.diceHistory.clear();

    // Redirect to play page mode selection
    window.location.href = window.location.pathname.replace(/\?.*$/, "");
  }
}

// Initialize app - modules are deferred so DOM is already ready
window.diceBoxApp = new DiceBoxApp();
