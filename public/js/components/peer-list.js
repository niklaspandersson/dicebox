/**
 * PeerList - Web Component for displaying connected peers
 */
import { escapeHtml } from '../utils/html-utils.js';

class PeerList extends HTMLElement {
  constructor() {
    super();
    this.peers = new Map();
    this.selfPeerId = null;
    this.selfUsername = null;
    // Map of peer IDs to dice set color
    this.holderInfo = new Map();
  }

  connectedCallback() {
    this.render();
  }

  setSelf(peerId, username) {
    this.selfPeerId = peerId;
    this.selfUsername = username;
    this.renderPeers();
  }

  addPeer(peerId, username, status = 'connected') {
    this.peers.set(peerId, { username, status });
    this.renderPeers();
  }

  updatePeerStatus(peerId, status) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.status = status;
      this.renderPeers();
    }
  }

  removePeer(peerId) {
    this.peers.delete(peerId);
    this.renderPeers();
  }

  setHolders(holderInfo) {
    this.holderInfo = new Map(holderInfo);
    this.renderPeers();
  }

  render() {
    this.innerHTML = `
      <div class="card">
        <h3>Players</h3>
        <div class="peer-list-content"></div>
      </div>
    `;
    this.renderPeers();
  }

  renderPeers() {
    const content = this.querySelector('.peer-list-content');
    if (!content) return;

    const allPeers = [];

    // Add self first
    if (this.selfPeerId && this.selfUsername) {
      allPeers.push({
        peerId: this.selfPeerId,
        username: this.selfUsername,
        status: 'connected',
        isSelf: true,
        isHolder: this.holderInfo.has(this.selfPeerId),
        holderColor: this.holderInfo.get(this.selfPeerId)
      });
    }

    // Add other peers
    for (const [peerId, { username, status }] of this.peers) {
      allPeers.push({
        peerId,
        username,
        status,
        isSelf: false,
        isHolder: this.holderInfo.has(peerId),
        holderColor: this.holderInfo.get(peerId)
      });
    }

    if (allPeers.length === 0) {
      content.innerHTML = '<div class="empty-message">Waiting for players...</div>';
      return;
    }

    content.innerHTML = allPeers.map(({ peerId, username, status, isSelf, isHolder, holderColor }) => `
      <div class="peer-item ${isHolder ? 'holding' : ''} ${isSelf && isHolder ? 'can-drop' : ''}"
           data-peer-id="${peerId}"
           data-is-self="${isSelf}"
           data-is-holder="${isHolder}"
           style="${isHolder ? `border-color: ${holderColor}` : ''}">
        <div class="peer-avatar-container">
          <div class="peer-avatar ${isSelf ? 'self' : ''} ${isHolder ? 'holding' : ''}">${this.getInitials(username)}</div>
          ${isHolder ? '<div class="peer-dice-icon">&#127922;</div>' : ''}
        </div>
        <div class="peer-name ${isSelf ? 'self' : ''}">${escapeHtml(username)}</div>
        <div class="peer-status ${status === 'connecting' ? 'connecting' : ''}"></div>
      </div>
    `).join('');

    // Add click handlers for self holding dice
    content.querySelectorAll('.peer-item.can-drop').forEach(item => {
      item.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('dice-dropped', { bubbles: true }));
      });
    });
  }

  getInitials(name) {
    return name
      .split(' ')
      .map(part => part.charAt(0).toUpperCase())
      .slice(0, 2)
      .join('');
  }

  clear() {
    this.peers.clear();
    this.selfPeerId = null;
    this.selfUsername = null;
    this.holderInfo.clear();
    this.renderPeers();
  }
}

customElements.define('peer-list', PeerList);
