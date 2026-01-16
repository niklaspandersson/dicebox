/**
 * WebRTCManager - Handles peer-to-peer connections using WebRTC
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
    signalingClient.addEventListener('peer-joined', async (e) => {
      const { peerId, username } = e.detail;
      console.log(`Peer joined: ${peerId} (${username})`);
      // Initiate connection to new peer
      await this.createPeerConnection(peerId, true);
    });

    signalingClient.addEventListener('peer-left', (e) => {
      const { peerId } = e.detail;
      console.log(`Peer left: ${peerId}`);
      this.closePeerConnection(peerId);
    });

    signalingClient.addEventListener('offer', async (e) => {
      const { fromPeerId, offer } = e.detail;
      console.log(`Received offer from: ${fromPeerId}`);
      await this.handleOffer(fromPeerId, offer);
    });

    signalingClient.addEventListener('answer', async (e) => {
      const { fromPeerId, answer } = e.detail;
      console.log(`Received answer from: ${fromPeerId}`);
      await this.handleAnswer(fromPeerId, answer);
    });

    signalingClient.addEventListener('ice-candidate', async (e) => {
      const { fromPeerId, candidate } = e.detail;
      await this.handleIceCandidate(fromPeerId, candidate);
    });

    signalingClient.addEventListener('joined', async (e) => {
      const { peers } = e.detail;
      // Connect to existing peers in the room
      for (const peer of peers) {
        await this.createPeerConnection(peer.peerId, true);
      }
    });
  }

  async createPeerConnection(peerId, initiator = false) {
    if (this.peerConnections.has(peerId)) {
      return this.peerConnections.get(peerId);
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

      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
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
      this.dispatchEvent(new CustomEvent('channel-open', { detail: { peerId } }));
    };

    channel.onclose = () => {
      console.log(`Data channel with ${peerId} closed`);
      this.dataChannels.delete(peerId);
    };

    channel.onmessage = (e) => {
      const message = JSON.parse(e.data);
      this.dispatchEvent(new CustomEvent('message', {
        detail: { peerId, message }
      }));
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
    this.dataChannels.delete(peerId);
    this.dispatchEvent(new CustomEvent('peer-disconnected', { detail: { peerId } }));
  }

  sendToPeer(peerId, message) {
    const channel = this.dataChannels.get(peerId);
    if (channel && channel.readyState === 'open') {
      channel.send(JSON.stringify(message));
    }
  }

  broadcast(message) {
    for (const [peerId, channel] of this.dataChannels) {
      if (channel.readyState === 'open') {
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
    return Array.from(this.dataChannels.keys());
  }
}

// Singleton instance
export const webrtcManager = new WebRTCManager();
