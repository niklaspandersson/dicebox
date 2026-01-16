/**
 * SignalingClient - Handles WebSocket connection to minimal ICE broker
 * Only handles: peer ID assignment, room queries, host registration, and WebRTC signaling
 */
export class SignalingClient extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.peerId = null;
    this.roomId = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this._pendingPeerId = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('Connected to signaling server');
        this.reconnectAttempts = 0;
        this.dispatchEvent(new CustomEvent('connected'));
      };

      this.ws.onclose = () => {
        console.log('Disconnected from signaling server');
        this.peerId = null;
        this.dispatchEvent(new CustomEvent('disconnected'));
        this.attemptReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };

      this.ws.onmessage = (event) => {
        const message = JSON.parse(event.data);

        // Handle peer-id specially to resolve connect promise
        if (message.type === 'peer-id') {
          this.peerId = message.peerId;
          console.log('Assigned peer ID:', this.peerId);
          resolve();
          return;
        }

        this.handleMessage(message);
      };
    });
  }

  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Max reconnection attempts reached');
      this.dispatchEvent(new CustomEvent('reconnect-failed'));
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    console.log(`Attempting reconnect in ${delay}ms...`);
    setTimeout(() => {
      this.connect().catch(() => {});
    }, delay);
  }

  handleMessage(message) {
    // Dispatch all messages as events - let the app handle them
    this.dispatchEvent(new CustomEvent(message.type, { detail: message }));
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  // Query if a room exists and who the host is
  queryRoom(roomId) {
    this.send({ type: 'query-room', roomId });
  }

  // Register as host for a new room
  registerHost(roomId) {
    this.roomId = roomId;
    this.send({ type: 'register-host', roomId });
  }

  // Claim host role (for migration)
  claimHost(roomId) {
    this.send({ type: 'claim-host', roomId });
  }

  // Join an existing room
  joinRoom(roomId) {
    this.roomId = roomId;
    this.send({ type: 'join-room', roomId });
  }

  // Leave current room
  leaveRoom() {
    this.send({ type: 'leave-room' });
    this.roomId = null;
  }

  // WebRTC signaling
  sendOffer(targetPeerId, offer) {
    this.send({ type: 'offer', targetPeerId, offer });
  }

  sendAnswer(targetPeerId, answer) {
    this.send({ type: 'answer', targetPeerId, answer });
  }

  sendIceCandidate(targetPeerId, candidate) {
    this.send({ type: 'ice-candidate', targetPeerId, candidate });
  }

  disconnect() {
    if (this.ws) {
      this.send({ type: 'leave-room' });
      this.ws.close();
      this.ws = null;
    }
    this.peerId = null;
    this.roomId = null;
  }
}

// Singleton instance
export const signalingClient = new SignalingClient();
