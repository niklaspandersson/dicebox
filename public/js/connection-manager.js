/**
 * ConnectionManager - Handles signaling server connection and status
 */
import { signalingClient } from "./signaling-client.js";

export class ConnectionManager extends EventTarget {
  constructor() {
    super();
    this.serverConnected = false;
    this.peerId = null;
    this.localId = "local-" + Math.random().toString(36).substring(2, 10);
  }

  /**
   * Returns peerId if connected, otherwise localId for offline operation
   */
  getEffectiveId() {
    return this.peerId || this.localId;
  }

  /**
   * Connect to the signaling server
   */
  async connect() {
    try {
      await signalingClient.connect();
      this.peerId = signalingClient.peerId;
      this.serverConnected = true;
      console.log("Connected to signaling server, peer ID:", this.peerId);
      this.dispatchEvent(
        new CustomEvent("connected", { detail: { peerId: this.peerId } }),
      );
      return true;
    } catch (error) {
      console.error("Failed to connect to signaling server:", error);
      this.serverConnected = false;
      this.dispatchEvent(
        new CustomEvent("disconnected", { detail: { error } }),
      );
      return false;
    }
  }

  /**
   * Retry connection after a short delay
   */
  async retryConnection() {
    console.log("Retrying connection...");
    this.dispatchEvent(new CustomEvent("connecting"));
    await new Promise((resolve) => setTimeout(resolve, 500));
    return this.connect();
  }

  /**
   * Setup event listeners for signaling server events
   */
  setupEventListeners(callbacks) {
    signalingClient.addEventListener("connected", () => {
      this.serverConnected = true;
      this.dispatchEvent(
        new CustomEvent("connected", { detail: { peerId: this.peerId } }),
      );
      callbacks.onConnected?.();
    });

    signalingClient.addEventListener("disconnected", (e) => {
      console.log("Disconnected from signaling server");
      this.serverConnected = false;
      this.dispatchEvent(new CustomEvent("disconnected", { detail: e.detail }));
      callbacks.onDisconnected?.(e.detail);
    });

    signalingClient.addEventListener("reconnected", (e) => {
      console.log(
        "Reconnected to signaling server with new peer ID:",
        e.detail.peerId,
      );
      this.peerId = e.detail.peerId;
      this.serverConnected = true;
      this.dispatchEvent(new CustomEvent("reconnected", { detail: e.detail }));
      callbacks.onReconnected?.(e.detail);
    });

    signalingClient.addEventListener("reconnect-failed", () => {
      console.log("Reconnection failed");
      this.dispatchEvent(new CustomEvent("reconnect-failed"));
      callbacks.onReconnectFailed?.();
    });

    signalingClient.addEventListener("server-error", (e) => {
      console.error("Server error:", e.detail);
      this.dispatchEvent(new CustomEvent("server-error", { detail: e.detail }));
      callbacks.onServerError?.(e.detail);
    });
  }
}
