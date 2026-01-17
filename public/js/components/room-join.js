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
      <div class="server-error" id="server-error" style="display: none;">
        <div class="error-icon">&#9888;</div>
        <h2>Unable to Connect</h2>
        <p>Cannot connect to the DiceBox server. This could be because:</p>
        <ul>
          <li>The server is not running</li>
          <li>You're viewing this page without a server (e.g., GitHub Pages)</li>
          <li>There's a network issue</li>
        </ul>
        <p class="error-hint">
          To play DiceBox, you need to run the server locally:
        </p>
        <pre><code>npm install
npm start</code></pre>
        <button class="btn-retry" id="btn-retry">Retry Connection</button>
      </div>

      <div class="card join-form" id="join-form">
        <div class="connecting-overlay" id="connecting-overlay">
          <div class="spinner"></div>
          <p>Connecting to server...</p>
        </div>
        <div class="form-group">
          <label for="username">Your Name</label>
          <input type="text" id="username" placeholder="Enter your name" maxlength="20" autocomplete="off" disabled>
        </div>
        <div class="form-group">
          <label for="room-id">Room Code</label>
          <input type="text" id="room-id" placeholder="Enter room code or leave empty for new room" maxlength="20" autocomplete="off" disabled>
        </div>
        <button class="btn-join" id="btn-join" disabled>Join Room</button>
      </div>
    `;
  }

  setupEventListeners() {
    const joinBtn = this.querySelector('#btn-join');
    const usernameInput = this.querySelector('#username');
    const roomIdInput = this.querySelector('#room-id');
    const retryBtn = this.querySelector('#btn-retry');

    joinBtn.addEventListener('click', () => this.handleJoin());

    // Enter key support
    [usernameInput, roomIdInput].forEach(input => {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.handleJoin();
        }
      });
    });

    // Generate random room ID if empty on focus out
    roomIdInput.addEventListener('blur', () => {
      if (!roomIdInput.value.trim()) {
        roomIdInput.value = this.generateRoomId();
      }
    });

    // Retry button
    retryBtn.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('retry-connection', { bubbles: true }));
    });

    // Auto-generate room ID initially
    roomIdInput.value = this.generateRoomId();
  }

  generateRoomId() {
    const adjectives = ['red', 'blue', 'green', 'fast', 'lucky', 'wild', 'cool', 'epic'];
    const nouns = ['dragon', 'wizard', 'knight', 'rogue', 'mage', 'warrior', 'archer', 'bard'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 100);
    return `${adj}-${noun}-${num}`;
  }

  handleJoin() {
    if (!this._serverConnected) return;

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
      detail: { username, roomId }
    }));
  }

  // Called when successfully connected to server
  setConnected() {
    this._serverConnected = true;

    const errorEl = this.querySelector('#server-error');
    const formEl = this.querySelector('#join-form');
    const overlayEl = this.querySelector('#connecting-overlay');

    if (errorEl) errorEl.style.display = 'none';
    if (formEl) formEl.style.display = 'block';
    if (overlayEl) overlayEl.style.display = 'none';

    // Enable form
    this.querySelector('#username').disabled = false;
    this.querySelector('#room-id').disabled = false;
    this.querySelector('#btn-join').disabled = false;

    // Focus username field
    this.querySelector('#username').focus();
  }

  // Called when connection fails
  setDisconnected(showError = true) {
    this._serverConnected = false;

    const errorEl = this.querySelector('#server-error');
    const formEl = this.querySelector('#join-form');

    if (showError) {
      if (errorEl) errorEl.style.display = 'block';
      if (formEl) formEl.style.display = 'none';
    }

    // Disable form
    this.querySelector('#username').disabled = true;
    this.querySelector('#room-id').disabled = true;
    this.querySelector('#btn-join').disabled = true;
  }

  // Called when attempting to connect
  setConnecting() {
    this._serverConnected = false;

    const errorEl = this.querySelector('#server-error');
    const formEl = this.querySelector('#join-form');
    const overlayEl = this.querySelector('#connecting-overlay');

    if (errorEl) errorEl.style.display = 'none';
    if (formEl) formEl.style.display = 'block';
    if (overlayEl) overlayEl.style.display = 'flex';

    // Disable form while connecting
    this.querySelector('#username').disabled = true;
    this.querySelector('#room-id').disabled = true;
    this.querySelector('#btn-join').disabled = true;
  }
}

customElements.define('room-join', RoomJoin);
