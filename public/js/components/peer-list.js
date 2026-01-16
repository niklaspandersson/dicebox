/**
 * PeerList - Web Component for displaying connected peers
 */
class PeerList extends HTMLElement {
  constructor() {
    super();
    this.peers = new Map();
    this.selfPeerId = null;
    this.selfUsername = null;
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
        isSelf: true
      });
    }

    // Add other peers
    for (const [peerId, { username, status }] of this.peers) {
      allPeers.push({ peerId, username, status, isSelf: false });
    }

    if (allPeers.length === 0) {
      content.innerHTML = '<div class="empty-message">Waiting for players...</div>';
      return;
    }

    content.innerHTML = allPeers.map(({ username, status, isSelf }) => `
      <div class="peer-item">
        <div class="peer-avatar ${isSelf ? 'self' : ''}">${this.getInitials(username)}</div>
        <div class="peer-name ${isSelf ? 'self' : ''}">${this.escapeHtml(username)}</div>
        <div class="peer-status ${status === 'connecting' ? 'connecting' : ''}"></div>
      </div>
    `).join('');
  }

  getInitials(name) {
    return name
      .split(' ')
      .map(part => part.charAt(0).toUpperCase())
      .slice(0, 2)
      .join('');
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  clear() {
    this.peers.clear();
    this.selfPeerId = null;
    this.selfUsername = null;
    this.renderPeers();
  }
}

customElements.define('peer-list', PeerList);
