/**
 * WebRTCManager - Handles peer-to-peer connections using WebRTC
 * Simplified for host-based room model - app controls connection initiation
 */
import { signalingClient } from './signaling-client.js';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

export class WebRTCManager extends EventTarget {
  constructor() {
    super();
    this.peerConnections = new Map();
    this.dataChannels = new Map();
    this.setupSignalingHandlers();
  }

  setupSignalingHandlers() {
    // Handle incoming WebRTC offers
    signalingClient.addEventListener('offer', async (e) => {
      const { fromPeerId, offer } = e.detail;
      console.log(`Received offer from: ${fromPeerId}`);
      await this.handleOffer(fromPeerId, offer);
    });

    // Handle incoming WebRTC answers
    signalingClient.addEventListener('answer', async (e) => {
      const { fromPeerId, answer } = e.detail;
      console.log(`Received answer from: ${fromPeerId}`);
      await this.handleAnswer(fromPeerId, answer);
    });

    // Handle incoming ICE candidates
    signalingClient.addEventListener('ice-candidate', async (e) => {
      const { fromPeerId, candidate } = e.detail;
      await this.handleIceCandidate(fromPeerId, candidate);
    });
  }

  // Create a connection to a peer and initiate WebRTC handshake
  async connectToPeer(peerId) {
    console.log(`Initiating connection to peer: ${peerId}`);
    return this.createPeerConnection(peerId, true);
  }

  // Accept a connection from a peer (wait for their offer)
  async acceptPeer(peerId) {
    console.log(`Preparing to accept connection from peer: ${peerId}`);
    // Connection will be created when offer is received
  }

  async createPeerConnection(peerId, initiator = false) {
    // Close existing connection if any
    if (this.peerConnections.has(peerId)) {
      this.closePeerConnection(peerId);
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.peerConnections.set(peerId, pc);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        signalingClient.sendIceCandidate(peerId, e.candidate);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${peerId}: ${pc.connectionState}`);
      this.dispatchEvent(new CustomEvent('connection-state-change', {
        detail: { peerId, state: pc.connectionState }
      }));

      if (pc.connectionState === 'connected') {
        this.dispatchEvent(new CustomEvent('peer-connected', { detail: { peerId } }));
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.closePeerConnection(peerId);
      }
    };

    pc.ondatachannel = (e) => {
      console.log(`Received data channel from ${peerId}`);
      this.setupDataChannel(peerId, e.channel);
    };

    if (initiator) {
      const channel = pc.createDataChannel('dice', { ordered: true });
      this.setupDataChannel(peerId, channel);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      signalingClient.sendOffer(peerId, offer);
    }

    return pc;
  }

  setupDataChannel(peerId, channel) {
    this.dataChannels.set(peerId, channel);

    channel.onopen = () => {
      console.log(`Data channel with ${peerId} opened`);
      this.dispatchEvent(new CustomEvent('channel-open', {
        detail: { peerId, channel }
      }));
    };

    channel.onclose = () => {
      console.log(`Data channel with ${peerId} closed`);
      this.dataChannels.delete(peerId);
      this.dispatchEvent(new CustomEvent('channel-closed', { detail: { peerId } }));
    };

    channel.onmessage = (e) => {
      try {
        const message = JSON.parse(e.data);
        this.dispatchEvent(new CustomEvent('message', {
          detail: { peerId, message }
        }));
      } catch (err) {
        console.error('Error parsing message from peer:', err);
      }
    };
  }

  async handleOffer(peerId, offer) {
    const pc = await this.createPeerConnection(peerId, false);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    signalingClient.sendAnswer(peerId, answer);
  }

  async handleAnswer(peerId, answer) {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  async handleIceCandidate(peerId, candidate) {
    const pc = this.peerConnections.get(peerId);
    if (pc && candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error('Error adding ICE candidate:', e);
      }
    }
  }

  closePeerConnection(peerId) {
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

    this.dispatchEvent(new CustomEvent('peer-disconnected', { detail: { peerId } }));
  }

  getDataChannel(peerId) {
    return this.dataChannels.get(peerId);
  }

  sendToPeer(peerId, message) {
    const channel = this.dataChannels.get(peerId);
    if (channel && channel.readyState === 'open') {
      channel.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  broadcast(message, excludePeerId = null) {
    for (const [peerId, channel] of this.dataChannels) {
      if (peerId !== excludePeerId && channel.readyState === 'open') {
        channel.send(JSON.stringify(message));
      }
    }
  }

  closeAll() {
    for (const [peerId] of this.peerConnections) {
      this.closePeerConnection(peerId);
    }
  }

  getConnectedPeers() {
    return Array.from(this.dataChannels.entries())
      .filter(([_, channel]) => channel.readyState === 'open')
      .map(([peerId]) => peerId);
  }

  isConnectedTo(peerId) {
    const channel = this.dataChannels.get(peerId);
    return channel && channel.readyState === 'open';
  }
}

// Singleton instance
export const webrtcManager = new WebRTCManager();
