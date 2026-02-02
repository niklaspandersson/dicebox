/**
 * SignalingClient - Handles WebSocket connection for mesh topology signaling
 * Handles: peer ID assignment, room queries, room creation/joining, and WebRTC signaling
 */

import { getWebSocketUrl } from "./config.js";

// Heartbeat interval (should be less than server's SESSION_EXPIRY)
const HEARTBEAT_INTERVAL = 30000; // 30 seconds

export class SignalingClient extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.peerId = null;
    this.roomId = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this._connectPromise = null;
    this._heartbeatInterval = null;
    this._sessionToken = null;
  }

  /**
   * Get or create session token (stored in sessionStorage for tab persistence)
   */
  getSessionToken() {
    if (this._sessionToken) {
      return this._sessionToken;
    }

    // Try to get existing token from sessionStorage
    this._sessionToken = sessionStorage.getItem("dicebox-session-token");

    if (!this._sessionToken) {
      // Generate new token (UUID-like format)
      this._sessionToken = crypto.randomUUID();
      sessionStorage.setItem("dicebox-session-token", this._sessionToken);
    }

    return this._sessionToken;
  }

  connect() {
    // Prevent multiple concurrent connection attempts
    if (this._connectPromise) {
      return this._connectPromise;
    }

    this._connectPromise = new Promise((resolve, reject) => {
      const wsUrl = getWebSocketUrl();

      try {
        this.ws = new WebSocket(wsUrl);
      } catch (error) {
        this._connectPromise = null;
        reject(error);
        return;
      }

      const connectionTimeout = setTimeout(() => {
        this._connectPromise = null;
        this.ws?.close();
        reject(new Error("Connection timeout"));
      }, 10000);

      this.ws.onopen = () => {
        console.log("Connected to signaling server, sending hello...");
        this.reconnectAttempts = 0;

        // Send hello with session token
        const sessionToken = this.getSessionToken();
        this.send({ type: "hello", sessionToken });

        this.dispatchEvent(new CustomEvent("connected"));
      };

      this.ws.onclose = (event) => {
        console.log("Disconnected from signaling server", event.code);
        clearTimeout(connectionTimeout);
        this._connectPromise = null;
        this.stopHeartbeat();

        const wasConnected = this.peerId !== null;
        const previousRoomId = this.roomId;

        // Don't clear peerId/roomId - session may be restored on reconnect
        this.dispatchEvent(
          new CustomEvent("disconnected", {
            detail: { wasConnected, previousRoomId },
          }),
        );

        this.attemptReconnect();
      };

      this.ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        clearTimeout(connectionTimeout);
        this._connectPromise = null;
        reject(error);
      };

      this.ws.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch (error) {
          console.error("Failed to parse message from server:", error);
          return;
        }

        // Handle peer-id specially to resolve connect promise
        if (message.type === "peer-id") {
          this.peerId = message.peerId;

          if (message.restored) {
            console.log(
              "Session restored, peer ID:",
              this.peerId,
              "room:",
              message.roomId,
            );
            this.roomId = message.roomId || null;
            // Dispatch session-restored event for app to handle
            this.dispatchEvent(
              new CustomEvent("session-restored", {
                detail: { peerId: this.peerId, roomId: this.roomId },
              }),
            );
          } else {
            console.log("New session, peer ID:", this.peerId);
          }

          clearTimeout(connectionTimeout);
          this._connectPromise = null;
          this.startHeartbeat();
          resolve();
          return;
        }

        // Handle heartbeat ack (just ignore, it's just to confirm connection is alive)
        if (message.type === "heartbeat-ack") {
          return;
        }

        // Handle server errors
        if (message.type === "error") {
          console.error("Server error:", message.errorType, message.reason);
          this.dispatchEvent(
            new CustomEvent("server-error", { detail: message }),
          );
          return;
        }

        this.handleMessage(message);
      };
    });

    return this._connectPromise;
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this._heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ type: "heartbeat" });
      }
    }, HEARTBEAT_INTERVAL);
  }

  stopHeartbeat() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
  }

  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log("Max reconnection attempts reached");
      this.dispatchEvent(new CustomEvent("reconnect-failed"));
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    console.log(
      `Attempting reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`,
    );
    setTimeout(() => {
      this.connect()
        .then(() => {
          // Emit reconnected event so app can re-register if needed
          this.dispatchEvent(
            new CustomEvent("reconnected", {
              detail: { peerId: this.peerId },
            }),
          );
        })
        .catch(() => {
          // Will trigger another attemptReconnect via onclose
        });
    }, delay);
  }

  handleMessage(message) {
    // Dispatch all messages as events - let the app handle them
    this.dispatchEvent(new CustomEvent(message.type, { detail: message }));
  }

  /**
   * Send a message to the server
   * @returns {boolean} true if message was sent, false if not connected
   */
  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error("Failed to send message:", error);
        return false;
      }
    }
    return false;
  }

  /**
   * Check if connected to the signaling server
   * @returns {boolean}
   */
  isConnected() {
    return (
      this.ws !== null &&
      this.ws.readyState === WebSocket.OPEN &&
      this.peerId !== null
    );
  }

  // Query if a room exists and get all peer IDs
  queryRoom(roomId) {
    return this.send({ type: "query-room", roomId });
  }

  // Create a new room with dice config
  createRoom(roomId, diceConfig) {
    if (this.send({ type: "create-room", roomId, diceConfig })) {
      this.roomId = roomId;
      return true;
    }
    return false;
  }

  // Join an existing room
  joinRoom(roomId) {
    if (this.send({ type: "join-room", roomId })) {
      this.roomId = roomId;
      return true;
    }
    return false;
  }

  // Leave current room
  leaveRoom() {
    const success = this.send({ type: "leave-room" });
    this.roomId = null;
    return success;
  }

  // WebRTC signaling
  sendOffer(targetPeerId, offer) {
    return this.send({ type: "offer", targetPeerId, offer });
  }

  sendAnswer(targetPeerId, answer) {
    return this.send({ type: "answer", targetPeerId, answer });
  }

  sendIceCandidate(targetPeerId, candidate) {
    return this.send({ type: "ice-candidate", targetPeerId, candidate });
  }

  disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      this.send({ type: "leave-room" });
      this.ws.close();
      this.ws = null;
    }
    this.peerId = null;
    this.roomId = null;
    this._connectPromise = null;
  }

  // Reset reconnection state (useful when user explicitly disconnects)
  resetReconnection() {
    this.reconnectAttempts = this.maxReconnectAttempts;
  }

  // Clear session (for explicit logout/new session)
  clearSession() {
    sessionStorage.removeItem("dicebox-session-token");
    this._sessionToken = null;
  }
}

// Singleton instance
export const signalingClient = new SignalingClient();
