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
        <div class="form-group room-id-group" id="room-id-group" style="display: none;">
          <label for="room-id">Room Code</label>
          <input type="text" id="room-id" placeholder="Enter dice room code (e.g. ⚀⚂⚄⚁⚅)" maxlength="20" autocomplete="off">
        </div>
        <div class="join-buttons">
          <button class="btn-create" id="btn-create">Create Room</button>
          <button class="btn-join" id="btn-join">Join Room</button>
        </div>
      </div>
    `;
    this._joinMode = false;
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
    // Use dice faces for thematic room IDs: ⚀⚁⚂⚃⚄⚅
    const dice = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    let roomId = '';
    // 5 dice gives 7776 combinations
    for (let i = 0; i < 5; i++) {
      roomId += dice[Math.floor(Math.random() * 6)];
    }
    return roomId;
  }

  handleCreate() {
    const username = this.querySelector('#username').value.trim();

    if (!username) {
      this.querySelector('#username').focus();
      return;
    }

    // Reset join mode if active
    this.resetJoinMode();

    const roomId = this.generateRoomId();

    this.dispatchEvent(new CustomEvent('join-room', {
      bubbles: true,
      detail: { username, roomId, isHost: true }
    }));
  }

  resetJoinMode() {
    this._joinMode = false;
    const roomIdGroup = this.querySelector('#room-id-group');
    const joinBtn = this.querySelector('#btn-join');
    if (roomIdGroup) roomIdGroup.style.display = 'none';
    if (joinBtn) joinBtn.textContent = 'Join Room';
  }

  handleJoin() {
    const username = this.querySelector('#username').value.trim();
    const roomIdGroup = this.querySelector('#room-id-group');
    const roomIdInput = this.querySelector('#room-id');
    const roomId = roomIdInput.value.trim();

    if (!username) {
      this.querySelector('#username').focus();
      return;
    }

    // If room ID input is not visible, show it
    if (!this._joinMode) {
      this._joinMode = true;
      roomIdGroup.style.display = 'block';
      roomIdInput.focus();
      this.querySelector('#btn-join').textContent = 'Enter Room';
      return;
    }

    // Room ID input is visible, validate and join
    if (!roomId) {
      roomIdInput.focus();
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
