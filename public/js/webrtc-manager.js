/**
 * WebRTCManager - Handles peer-to-peer connections using WebRTC
 * Mesh topology: connects all peers directly, app controls connection initiation
 *
 * TURN Server Configuration:
 * For production deployment, configure TURN servers to handle symmetric NAT traversal.
 * TURN credentials can be:
 * 1. Static: Set via webrtcManager.configure({ turnServers: [...] })
 * 2. Dynamic: Fetched from server via /api/turn-credentials endpoint
 *
 * Example static configuration:
 *   webrtcManager.configure({
 *     turnServers: [{
 *       urls: 'turn:turn.example.com:3478',
 *       username: 'user',
 *       credential: 'pass'
 *     }]
 *   });
 *
 * Popular TURN server options:
 * - Twilio Network Traversal Service (paid)
 * - Xirsys (free tier available)
 * - coturn (self-hosted, open source)
 * - Cloudflare Calls (beta)
 */
import { signalingClient } from "./signaling-client.js";
import { getApiBaseUrl } from "./config.js";

// Default STUN servers (free, public)
const DEFAULT_STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },
  { urls: "stun:stun.stunprotocol.org:3478" },
];

// Connection timeout in milliseconds
const CONNECTION_TIMEOUT = 30000;

// TURN credential refresh interval (refresh 5 minutes before expiry)
const TURN_CREDENTIAL_REFRESH_BUFFER = 5 * 60 * 1000;

export class WebRTCManager extends EventTarget {
  constructor() {
    super();
    this.peerConnections = new Map(); // peerId -> RTCPeerConnection
    this.dataChannels = new Map(); // peerId -> RTCDataChannel
    this.pendingCandidates = new Map(); // peerId -> ICE candidates received before connection ready
    this.connectionTimeouts = new Map(); // peerId -> timeout ID

    // ICE server configuration
    this.stunServers = [...DEFAULT_STUN_SERVERS];
    this.turnServers = [];
    this.turnCredentialExpiry = null;
    this.turnCredentialRefreshTimer = null;
    // Default TURN credentials endpoint uses the configured API base URL
    this.turnCredentialsEndpoint = `${getApiBaseUrl()}/api/turn-credentials`;

    this.setupSignalingHandlers();

    // Fetch TURN credentials on initialization
    this.refreshTurnCredentials();
  }

  /**
   * Configure WebRTC settings including TURN servers
   * @param {Object} config Configuration object
   * @param {Array} config.turnServers - Array of TURN server configs
   * @param {Array} config.stunServers - Array of STUN server configs (optional, adds to defaults)
   * @param {string} config.turnCredentialsEndpoint - URL to fetch dynamic TURN credentials
   * @param {number} config.turnCredentialTTL - Credential TTL in seconds (for dynamic credentials)
   */
  configure(config = {}) {
    if (config.stunServers) {
      this.stunServers = [...DEFAULT_STUN_SERVERS, ...config.stunServers];
    }

    if (config.turnServers) {
      this.turnServers = config.turnServers;
      console.log(`Configured ${this.turnServers.length} TURN server(s)`);
    }

    if (config.turnCredentialsEndpoint) {
      // If endpoint is an absolute URL, use it directly; otherwise prepend the API base URL
      if (/^https?:\/\//i.test(config.turnCredentialsEndpoint)) {
        this.turnCredentialsEndpoint = config.turnCredentialsEndpoint;
      } else {
        this.turnCredentialsEndpoint = `${getApiBaseUrl()}${config.turnCredentialsEndpoint}`;
      }
      // Fetch credentials immediately
      this.refreshTurnCredentials();
    }

    this.dispatchEvent(
      new CustomEvent("configured", {
        detail: {
          stunCount: this.stunServers.length,
          turnCount: this.turnServers.length,
          hasDynamicCredentials: !!this.turnCredentialsEndpoint,
        },
      }),
    );
  }

  /**
   * Fetch fresh TURN credentials from the server
   * Server should return: { urls, username, credential, ttl }
   */
  async refreshTurnCredentials() {
    if (!this.turnCredentialsEndpoint) return;

    try {
      const response = await fetch(this.turnCredentialsEndpoint);

      // Handle 404 gracefully - TURN server not configured is a valid state
      if (response.status === 404) {
        console.info(
          "TURN credentials endpoint not configured (404), using STUN only",
        );
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const credentials = await response.json();

      if (credentials.servers && Array.isArray(credentials.servers)) {
        this.turnServers = credentials.servers;
      } else if (credentials.urls) {
        // Single server format
        this.turnServers = [
          {
            urls: credentials.urls,
            username: credentials.username,
            credential: credentials.credential,
          },
        ];
      }

      // Schedule credential refresh before expiry
      if (credentials.ttl) {
        this.turnCredentialExpiry = Date.now() + credentials.ttl * 1000;
        this.scheduleTurnCredentialRefresh(credentials.ttl * 1000);
      }

      console.log(
        `TURN credentials refreshed, ${this.turnServers.length} server(s), expires in ${credentials.ttl}s`,
      );

      this.dispatchEvent(
        new CustomEvent("turn-credentials-refreshed", {
          detail: {
            serverCount: this.turnServers.length,
            ttl: credentials.ttl,
          },
        }),
      );
    } catch (error) {
      console.error("Failed to fetch TURN credentials:", error);
      this.dispatchEvent(
        new CustomEvent("turn-credentials-error", { detail: { error } }),
      );
    }
  }

  scheduleTurnCredentialRefresh(ttlMs) {
    if (this.turnCredentialRefreshTimer) {
      clearTimeout(this.turnCredentialRefreshTimer);
    }

    // Refresh before expiry
    const refreshIn = Math.max(ttlMs - TURN_CREDENTIAL_REFRESH_BUFFER, 60000);

    this.turnCredentialRefreshTimer = setTimeout(() => {
      this.refreshTurnCredentials();
    }, refreshIn);
  }

  /**
   * Get current ICE servers configuration
   */
  getIceServers() {
    const servers = [...this.stunServers];

    if (this.turnServers.length > 0) {
      // Check if credentials are still valid
      if (this.turnCredentialExpiry && Date.now() > this.turnCredentialExpiry) {
        console.warn("TURN credentials expired, using STUN only");
      } else {
        servers.push(...this.turnServers);
      }
    }

    return servers;
  }

  /**
   * Check if TURN servers are configured and available
   */
  hasTurnServers() {
    if (this.turnServers.length === 0) return false;
    if (this.turnCredentialExpiry && Date.now() > this.turnCredentialExpiry)
      return false;
    return true;
  }

  setupSignalingHandlers() {
    // Handle incoming WebRTC offers
    signalingClient.addEventListener("offer", async (e) => {
      const { fromPeerId, offer } = e.detail;
      console.log(`Received offer from: ${fromPeerId}`);
      try {
        await this.handleOffer(fromPeerId, offer);
      } catch (error) {
        console.error(`Failed to handle offer from ${fromPeerId}:`, error);
        this.closePeerConnection(fromPeerId);
      }
    });

    // Handle incoming WebRTC answers
    signalingClient.addEventListener("answer", async (e) => {
      const { fromPeerId, answer } = e.detail;
      console.log(`Received answer from: ${fromPeerId}`);
      try {
        await this.handleAnswer(fromPeerId, answer);
      } catch (error) {
        console.error(`Failed to handle answer from ${fromPeerId}:`, error);
        this.closePeerConnection(fromPeerId);
      }
    });

    // Handle incoming ICE candidates
    signalingClient.addEventListener("ice-candidate", async (e) => {
      const { fromPeerId, candidate } = e.detail;
      try {
        await this.handleIceCandidate(fromPeerId, candidate);
      } catch (error) {
        console.error(
          `Failed to handle ICE candidate from ${fromPeerId}:`,
          error,
        );
      }
    });
  }

  // Create a connection to a peer and initiate WebRTC handshake
  async connectToPeer(peerId) {
    console.log(`Initiating connection to peer: ${peerId}`);
    try {
      return await this.createPeerConnection(peerId, true);
    } catch (error) {
      console.error(`Failed to connect to peer ${peerId}:`, error);
      this.closePeerConnection(peerId);
      throw error;
    }
  }

  // Set up connection timeout
  startConnectionTimeout(peerId) {
    this.clearConnectionTimeout(peerId);

    const timeoutId = setTimeout(() => {
      const pc = this.peerConnections.get(peerId);
      if (pc && pc.connectionState !== "connected") {
        console.log(`Connection to ${peerId} timed out`);
        this.closePeerConnection(peerId);
        this.dispatchEvent(
          new CustomEvent("connection-timeout", { detail: { peerId } }),
        );
      }
    }, CONNECTION_TIMEOUT);

    this.connectionTimeouts.set(peerId, timeoutId);
  }

  clearConnectionTimeout(peerId) {
    const timeoutId = this.connectionTimeouts.get(peerId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.connectionTimeouts.delete(peerId);
    }
  }

  async createPeerConnection(peerId, initiator = false) {
    // Close existing connection if any
    if (this.peerConnections.has(peerId)) {
      this.closePeerConnection(peerId);
    }

    // Initialize pending candidates buffer for this peer (preserve existing if any)
    // This is critical: ICE candidates may arrive before the offer/answer,
    // so we must not clear already-buffered candidates
    if (!this.pendingCandidates.has(peerId)) {
      this.pendingCandidates.set(peerId, []);
    }

    // Get current ICE servers (STUN + TURN if configured)
    const iceServers = this.getIceServers();

    const pc = new RTCPeerConnection({ iceServers });

    this.peerConnections.set(peerId, pc);

    // Start connection timeout
    this.startConnectionTimeout(peerId);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        signalingClient.sendIceCandidate(peerId, e.candidate);
      }
    };

    pc.onicecandidateerror = (e) => {
      // Only log significant errors (not just failed STUN attempts)
      if (e.errorCode !== 701) {
        console.warn(`ICE candidate error for ${peerId}:`, e.errorText);
      }
    };

    // Track ICE gathering state for debugging
    pc.onicegatheringstatechange = () => {
      console.log(
        `ICE gathering state with ${peerId}: ${pc.iceGatheringState}`,
      );
      if (pc.iceGatheringState === "complete") {
        this.dispatchEvent(
          new CustomEvent("ice-gathering-complete", {
            detail: { peerId },
          }),
        );
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${peerId}: ${pc.connectionState}`);
      this.dispatchEvent(
        new CustomEvent("connection-state-change", {
          detail: { peerId, state: pc.connectionState },
        }),
      );

      if (pc.connectionState === "connected") {
        this.clearConnectionTimeout(peerId);
        this.logConnectionType(peerId, pc);
        this.dispatchEvent(
          new CustomEvent("peer-connected", { detail: { peerId } }),
        );
      } else if (pc.connectionState === "failed") {
        // Only close on 'failed', not 'disconnected'
        // 'disconnected' is often temporary and can recover (e.g., when switching from IPv6 to IPv4)
        this.closePeerConnection(peerId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(
        `ICE connection state with ${peerId}: ${pc.iceConnectionState}`,
      );

      // Handle ICE restart if connection fails but peer connection is still valid
      if (pc.iceConnectionState === "failed") {
        console.log(`ICE connection failed for ${peerId}, closing...`);
        this.closePeerConnection(peerId);
      }
    };

    pc.ondatachannel = (e) => {
      console.log(`Received data channel from ${peerId}`);
      this.setupDataChannel(peerId, e.channel);
    };

    if (initiator) {
      const channel = pc.createDataChannel("dice", { ordered: true });
      this.setupDataChannel(peerId, channel);

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        signalingClient.sendOffer(peerId, offer);
      } catch (error) {
        console.error(`Failed to create/send offer to ${peerId}:`, error);
        throw error;
      }
    }

    return pc;
  }

  /**
   * Log the connection type (direct vs relay) for debugging
   */
  async logConnectionType(peerId, pc) {
    try {
      const stats = await pc.getStats();
      stats.forEach((report) => {
        if (report.type === "candidate-pair" && report.state === "succeeded") {
          const localCandidate = stats.get(report.localCandidateId);
          const remoteCandidate = stats.get(report.remoteCandidateId);

          const localType = localCandidate?.candidateType || "unknown";
          const remoteType = remoteCandidate?.candidateType || "unknown";

          const isRelayed = localType === "relay" || remoteType === "relay";
          console.log(
            `Connection to ${peerId}: ${isRelayed ? "RELAYED (TURN)" : "DIRECT"} (local: ${localType}, remote: ${remoteType})`,
          );

          this.dispatchEvent(
            new CustomEvent("connection-type-determined", {
              detail: { peerId, isRelayed, localType, remoteType },
            }),
          );
        }
      });
    } catch (e) {
      // Stats not available, ignore
    }
  }

  setupDataChannel(peerId, channel) {
    this.dataChannels.set(peerId, channel);

    const dispatchOpen = () => {
      console.log(`Data channel with ${peerId} opened`);
      this.dispatchEvent(
        new CustomEvent("channel-open", {
          detail: { peerId, channel },
        }),
      );
    };

    channel.onopen = dispatchOpen;

    // If channel is already open (can happen when ondatachannel fires with
    // an already-established channel), dispatch the event immediately
    if (channel.readyState === "open") {
      dispatchOpen();
    }

    channel.onclose = () => {
      console.log(`Data channel with ${peerId} closed`);
      this.dataChannels.delete(peerId);
      this.dispatchEvent(
        new CustomEvent("channel-closed", { detail: { peerId } }),
      );
    };

    channel.onerror = (error) => {
      console.error(`Data channel error with ${peerId}:`, error);
      this.dispatchEvent(
        new CustomEvent("channel-error", {
          detail: { peerId, error },
        }),
      );
    };

    channel.onmessage = (e) => {
      try {
        const message = JSON.parse(e.data);
        this.dispatchEvent(
          new CustomEvent("message", {
            detail: { peerId, message },
          }),
        );
      } catch (err) {
        console.error("Error parsing message from peer:", err);
      }
    };
  }

  async handleOffer(peerId, offer) {
    const pc = await this.createPeerConnection(peerId, false);

    // Pass offer directly - modern browsers don't need RTCSessionDescription wrapper
    await pc.setRemoteDescription(offer);

    // Apply any buffered ICE candidates now that remote description is set
    await this.applyPendingCandidates(peerId);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    signalingClient.sendAnswer(peerId, answer);
  }

  async handleAnswer(peerId, answer) {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      // Pass answer directly - modern browsers don't need RTCSessionDescription wrapper
      await pc.setRemoteDescription(answer);

      // Apply any buffered ICE candidates now that remote description is set
      await this.applyPendingCandidates(peerId);
    }
  }

  async handleIceCandidate(peerId, candidate) {
    if (!candidate) return;

    const pc = this.peerConnections.get(peerId);

    // If connection doesn't exist yet, or remote description isn't set, buffer the candidate
    if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
      let pending = this.pendingCandidates.get(peerId);
      if (!pending) {
        pending = [];
        this.pendingCandidates.set(peerId, pending);
      }
      pending.push(candidate);
      return;
    }

    try {
      // Pass candidate directly - modern browsers handle plain objects
      await pc.addIceCandidate(candidate);
    } catch (e) {
      console.error("Error adding ICE candidate:", e);
    }
  }

  async applyPendingCandidates(peerId) {
    const pending = this.pendingCandidates.get(peerId);
    if (!pending || pending.length === 0) return;

    const pc = this.peerConnections.get(peerId);
    if (!pc) return;

    for (const candidate of pending) {
      try {
        // Pass candidate directly - modern browsers handle plain objects
        await pc.addIceCandidate(candidate);
      } catch (e) {
        console.error("Error adding buffered ICE candidate:", e);
      }
    }

    this.pendingCandidates.set(peerId, []);
  }

  closePeerConnection(peerId) {
    this.clearConnectionTimeout(peerId);
    this.pendingCandidates.delete(peerId);

    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
    }

    const channel = this.dataChannels.get(peerId);
    if (channel) {
      channel.close();
      this.dataChannels.delete(peerId);
    }

    this.dispatchEvent(
      new CustomEvent("peer-disconnected", { detail: { peerId } }),
    );
  }

  getDataChannel(peerId) {
    return this.dataChannels.get(peerId);
  }

  sendToPeer(peerId, message) {
    const channel = this.dataChannels.get(peerId);
    if (channel && channel.readyState === "open") {
      try {
        channel.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error(`Failed to send to peer ${peerId}:`, error);
        return false;
      }
    }
    return false;
  }

  broadcast(message, excludePeerId = null) {
    const messageStr = JSON.stringify(message);
    for (const [peerId, channel] of this.dataChannels) {
      if (peerId !== excludePeerId && channel.readyState === "open") {
        try {
          channel.send(messageStr);
        } catch (error) {
          console.error(`Failed to broadcast to peer ${peerId}:`, error);
        }
      }
    }
  }

  closeAll() {
    // Create a copy of keys to avoid modifying map while iterating
    const peerIds = Array.from(this.peerConnections.keys());
    for (const peerId of peerIds) {
      this.closePeerConnection(peerId);
    }

    // Clean up TURN credential refresh timer
    if (this.turnCredentialRefreshTimer) {
      clearTimeout(this.turnCredentialRefreshTimer);
      this.turnCredentialRefreshTimer = null;
    }
  }

  getConnectedPeers() {
    return Array.from(this.dataChannels.entries())
      .filter(([_, channel]) => channel.readyState === "open")
      .map(([peerId]) => peerId);
  }

  isConnectedTo(peerId) {
    const channel = this.dataChannels.get(peerId);
    return channel && channel.readyState === "open";
  }

  /**
   * Get connection statistics for a peer
   */
  async getConnectionStats(peerId) {
    const pc = this.peerConnections.get(peerId);
    if (!pc) return null;

    try {
      const stats = await pc.getStats();
      const result = {
        connectionType: "unknown",
        localCandidateType: null,
        remoteCandidateType: null,
        bytesReceived: 0,
        bytesSent: 0,
        packetsLost: 0,
        roundTripTime: null,
      };

      stats.forEach((report) => {
        if (report.type === "candidate-pair" && report.state === "succeeded") {
          const localCandidate = stats.get(report.localCandidateId);
          const remoteCandidate = stats.get(report.remoteCandidateId);

          result.localCandidateType = localCandidate?.candidateType;
          result.remoteCandidateType = remoteCandidate?.candidateType;
          result.connectionType =
            result.localCandidateType === "relay" ||
            result.remoteCandidateType === "relay"
              ? "relay"
              : "direct";
          result.bytesReceived = report.bytesReceived || 0;
          result.bytesSent = report.bytesSent || 0;
          result.roundTripTime = report.currentRoundTripTime;
        }

        if (report.type === "inbound-rtp") {
          result.packetsLost += report.packetsLost || 0;
        }
      });

      return result;
    } catch (e) {
      return null;
    }
  }
}

// Singleton instance
export const webrtcManager = new WebRTCManager();
