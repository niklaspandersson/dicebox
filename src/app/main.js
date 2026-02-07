/**
 * DiceBox - Main Application
 * Mesh topology: all peers are equal, no host/client distinction
 */

// Error reporting — install global handlers early in this module's init.
// Note: ES module imports are hoisted, so imported modules evaluate first.
import { initErrorReporter } from "../services/error-reporter.js";
initErrorReporter();

// Services
import { signalingClient } from "../services/signaling-client.js";
import { webrtcManager } from "../services/webrtc-manager.js";
import { ConnectionManager } from "../services/connection-manager.js";
import { RoomManager } from "../services/room-manager.js";
import { MessageRouter, MSG } from "../services/message-router.js";

// Dice app
import { createApp } from "./App.js";

// UI Components (register custom elements)
import "../ui/components/shared/play-frame.js";
import "../ui/components/shared/header-bar.js";
import "../ui/components/shared/username-input.js";
import "../ui/components/room/room-create.js";
import "../ui/components/room/room-join.js";
import "../ui/components/room/room-view.js";
import "../ui/components/room/room-code-input.js";
import "../ui/components/room/dice-config.js";
import "../ui/components/room/dice-history.js";
import "../ui/components/room/peer-list.js";

class DiceBoxApp {
  constructor() {
    // Initialize managers
    this.connectionManager = new ConnectionManager();
    this.roomManager = new RoomManager();
    this.messageRouter = new MessageRouter();

    // UI components
    this.headerBar = document.querySelector("header-bar");
    this.roomView = document.getElementById("room-view");
    this.diceHistory = null;
    this.peerList = null;

    // Dice app
    this.diceApp = null;

    this.init();
  }

  #showView(id) {
    const fullId = `${id}-view`;
    for (const view of document.querySelectorAll(".view")) {
      view.classList.toggle("active", fullId === view.id);
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
      );
  }

  // === MANAGER EVENTS SETUP ===

  setupManagerEvents() {
    // Connection manager events
    this.connectionManager.setupEventListeners({
      onConnected: () => {
        if (this.peerList) {
          this.peerList.setSelfStatus("connected");
        }
      },
      onDisconnected: () => {
        if (this.peerList) {
          const hasPeers = this.peerList.peers.size > 0;
          this.peerList.setSelfStatus(
            hasPeers ? "reconnecting-with-peers" : "reconnecting",
          );
        }
      },
      onReconnected: () => {
        if (this.peerList) {
          this.peerList.setSelfStatus("connected");
        }
        // Session should be automatically restored by signaling client
      },
      onReconnectFailed: () => {
        if (this.peerList) {
          const hasPeers = this.peerList.peers.size > 0;
          this.peerList.setSelfStatus(
            hasPeers ? "reconnecting-with-peers" : "disconnected",
          );
        }
      },
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

    document.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

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
  }

  handleDiceRollMsg(peerId, roll) {
    const meshState = this.roomManager.getMeshState();

    // Check for duplicate
    if (meshState.hasRoll(roll.rollId)) {
      return;
    }

    // Add to state
    meshState.addRoll(roll);

    // Update state
    for (const sr of roll.setResults || []) {
      meshState.setLastRoller(sr.setId, sr.holderId, sr.holderUsername);

      // Update DiceStore
      if (this.diceApp) {
        this.diceApp.diceStore.applyRoll({
          setId: sr.setId,
          values: sr.values,
          playerId: sr.holderId,
          username: sr.holderUsername,
        });
      }
    }

    if (this.diceHistory) {
      this.diceHistory.addRoll(roll);
    }
  }

  // === PEER DISCONNECTION ===

  handlePeerDisconnected(peerId) {
    console.log(`Peer disconnected: ${peerId}`);
    const meshState = this.roomManager.getMeshState();

    const peer = meshState.getPeer(peerId);
    if (peer) {
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
    }
  }

  // === ROOM UI ===

  enterRoom() {
    // Hide any views in the play page
    this.#showView("room");

    this.headerBar.showRoomView();

    // Show room code badge on the play frame
    const topSlot = document.querySelector("play-frame .play-frame-top-slot");
    if (topSlot) {
      topSlot.innerHTML = `<span class="frame-badge">Room ${this.roomManager.roomId}</span>`;
    }

    // Get UI components
    const diceRollerContainer = this.roomView.querySelector(
      "dice-roller-container",
    );
    this.diceHistory = this.roomView.querySelector("dice-history");
    this.peerList = this.roomView.querySelector("peer-list");

    this.peerList.setSelf(
      this.connectionManager.getEffectiveId(),
      this.roomManager.username,
      this.connectionManager.serverConnected ? "connected" : "disconnected",
    );
    this.diceHistory.peerId = this.connectionManager.getEffectiveId();

    // Initialize dice app
    const meshState = this.roomManager.getMeshState();
    const diceConfig = meshState.getDiceConfig() || {
      diceSets: [{ id: "default", count: 5, color: "#ffffff" }],
    };

    const localPlayer = {
      id: this.connectionManager.getEffectiveId(),
      username: this.roomManager.username,
    };

    // Create network adapter for the dice app
    const networkAdapter = {
      broadcast: (type, payload) => {
        const msg = this.#convertToNetworkMessage(type, payload);
        if (msg) {
          this.messageRouter.broadcast(msg);

          // Also add to local history for dice rolls
          if (type === "dice:roll" && this.diceHistory) {
            this.diceHistory.addRoll(msg);
          }
        }
      },
    };

    // Create dice app
    this.diceApp = createApp({
      diceConfig,
      localPlayer,
      network: networkAdapter,
      strategyId: "drag-pickup",
    });

    // Mount to the container
    if (diceRollerContainer) {
      this.diceApp.mount(diceRollerContainer);
    }

    console.log(
      `Entered room ${this.roomManager.roomId} as ${this.roomManager.username}`,
    );
  }

  #convertToNetworkMessage(type, payload) {
    switch (type) {
      case "dice:roll":
        return {
          type: MSG.DICE_ROLL,
          rollId: payload.rollId || `roll-${Date.now()}`,
          timestamp: payload.timestamp || Date.now(),
          total:
            payload.total || payload.values?.reduce((a, b) => a + b, 0) || 0,
          setResults: payload.setResults || [
            {
              setId: payload.setId,
              color: payload.color,
              values: payload.values,
              holderId: payload.playerId,
              holderUsername: payload.username,
            },
          ],
        };
      default:
        return null;
    }
  }

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

    // Clear the room code badge
    const topSlot = document.querySelector("play-frame .play-frame-top-slot");
    if (topSlot) topSlot.innerHTML = "";

    // Redirect to play page mode selection
    window.location.href = window.location.pathname.replace(/\?.*$/, "");
  }
}

// Initialize app - modules are deferred so DOM is already ready
window.diceBoxApp = new DiceBoxApp();
