/**
 * RoomJoin - Web Component for joining a dice room
 */
class RoomJoin extends HTMLElement {
  constructor() {
    super();
    this._serverConnected = false;
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
  }

  render() {
    this.innerHTML = `
      <div class="server-banner" id="server-banner" style="display: none;">
        <span class="banner-icon">&#9888;</span>
        <span class="banner-text">No server connection - multiplayer unavailable</span>
        <button class="banner-dismiss" id="banner-dismiss" aria-label="Dismiss">&times;</button>
      </div>

      <div class="card join-form" id="join-form">
        <div class="form-group">
          <label for="username">Your Name</label>
          <input type="text" id="username" placeholder="Enter your name" maxlength="20" autocomplete="off">
        </div>
        <div class="form-group">
          <label for="room-id">Room Code</label>
          <input type="text" id="room-id" placeholder="Enter room code to join, or create a new room" maxlength="20" autocomplete="off">
        </div>
        <div class="join-buttons">
          <button class="btn-create" id="btn-create">Create Room</button>
          <button class="btn-join" id="btn-join">Join Room</button>
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    const createBtn = this.querySelector('#btn-create');
    const joinBtn = this.querySelector('#btn-join');
    const usernameInput = this.querySelector('#username');
    const roomIdInput = this.querySelector('#room-id');
    const dismissBtn = this.querySelector('#banner-dismiss');

    createBtn.addEventListener('click', () => this.handleCreate());
    joinBtn.addEventListener('click', () => this.handleJoin());

    // Enter key support
    usernameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.handleCreate();
      }
    });

    roomIdInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.handleJoin();
      }
    });

    // Dismiss banner
    dismissBtn.addEventListener('click', () => {
      this.querySelector('#server-banner').style.display = 'none';
    });

    // Focus username on load
    usernameInput.focus();
  }

  generateRoomId() {
    const adjectives = ['red', 'blue', 'green', 'fast', 'lucky', 'wild', 'cool', 'epic'];
    const nouns = ['dragon', 'wizard', 'knight', 'rogue', 'mage', 'warrior', 'archer', 'bard'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 100);
    return `${adj}-${noun}-${num}`;
  }

  handleCreate() {
    const username = this.querySelector('#username').value.trim();

    if (!username) {
      this.querySelector('#username').focus();
      return;
    }

    const roomId = this.generateRoomId();

    this.dispatchEvent(new CustomEvent('join-room', {
      bubbles: true,
      detail: { username, roomId, isHost: true }
    }));
  }

  handleJoin() {
    const username = this.querySelector('#username').value.trim();
    const roomId = this.querySelector('#room-id').value.trim();

    if (!username) {
      this.querySelector('#username').focus();
      return;
    }

    if (!roomId) {
      this.querySelector('#room-id').focus();
      return;
    }

    this.dispatchEvent(new CustomEvent('join-room', {
      bubbles: true,
      detail: { username, roomId, isHost: false }
    }));
  }

  // Called when successfully connected to server
  setConnected() {
    this._serverConnected = true;
    const bannerEl = this.querySelector('#server-banner');
    if (bannerEl) bannerEl.style.display = 'none';
  }

  // Called when connection fails
  setDisconnected() {
    this._serverConnected = false;
    const bannerEl = this.querySelector('#server-banner');
    if (bannerEl) bannerEl.style.display = 'flex';
  }

  // Called when attempting to connect
  setConnecting() {
    this._serverConnected = false;
    // Don't show banner while still trying to connect
    const bannerEl = this.querySelector('#server-banner');
    if (bannerEl) bannerEl.style.display = 'none';
  }
}

customElements.define('room-join', RoomJoin);
