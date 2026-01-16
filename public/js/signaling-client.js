/**
 * SignalingClient - Handles WebSocket connection to signaling server
 */
export class SignalingClient extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.peerId = null;
    this.roomId = null;
    this.username = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
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
        resolve();
      };

      this.ws.onclose = () => {
        console.log('Disconnected from signaling server');
        this.dispatchEvent(new CustomEvent('disconnected'));
        this.attemptReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(JSON.parse(event.data));
      };
    });
  }

  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    console.log(`Attempting reconnect in ${delay}ms...`);
    setTimeout(() => {
      this.connect().then(() => {
        if (this.roomId && this.username) {
          this.joinRoom(this.roomId, this.username);
        }
      }).catch(() => {});
    }, delay);
  }

  handleMessage(message) {
    switch (message.type) {
      case 'joined':
        this.peerId = message.peerId;
        this.dispatchEvent(new CustomEvent('joined', { detail: message }));
        break;

      case 'peer-joined':
        this.dispatchEvent(new CustomEvent('peer-joined', { detail: message }));
        break;

      case 'peer-left':
        this.dispatchEvent(new CustomEvent('peer-left', { detail: message }));
        break;

      case 'offer':
        this.dispatchEvent(new CustomEvent('offer', { detail: message }));
        break;

      case 'answer':
        this.dispatchEvent(new CustomEvent('answer', { detail: message }));
        break;

      case 'ice-candidate':
        this.dispatchEvent(new CustomEvent('ice-candidate', { detail: message }));
        break;

      case 'dice-roll':
        this.dispatchEvent(new CustomEvent('dice-roll', { detail: message }));
        break;

      case 'chat':
        this.dispatchEvent(new CustomEvent('chat', { detail: message }));
        break;

      default:
        console.log('Unknown message type:', message.type);
    }
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  joinRoom(roomId, username) {
    this.roomId = roomId;
    this.username = username;
    this.send({ type: 'join', roomId, username });
  }

  sendOffer(targetPeerId, offer) {
    this.send({ type: 'offer', targetPeerId, offer });
  }

  sendAnswer(targetPeerId, answer) {
    this.send({ type: 'answer', targetPeerId, answer });
  }

  sendIceCandidate(targetPeerId, candidate) {
    this.send({ type: 'ice-candidate', targetPeerId, candidate });
  }

  sendDiceRoll(diceType, count, values, total) {
    this.send({ type: 'dice-roll', diceType, count, values, total });
  }

  sendChat(message) {
    this.send({ type: 'chat', message });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.peerId = null;
    this.roomId = null;
  }
}

// Singleton instance
export const signalingClient = new SignalingClient();
