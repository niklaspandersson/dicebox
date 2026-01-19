/**
 * RoomJoin - Web Component for joining a dice room
 */
class RoomJoin extends HTMLElement {
  constructor() {
    super();
    this._serverConnected = false;
    this._diceValues = [0, 0, 0, 0]; // 4 dice, values 0-5 (representing 1-6)
  }

  // Generate SVG for a die face with proper pip arrangement
  getDiceSvg(value) {
    // value is 0-5 internally, but represents 1-6 on the die
    const faceValue = value + 1;
    const pipColor = '#0f172a';

    // Pip positions for a standard die (relative to 50x50 viewBox)
    const positions = {
      topLeft: { cx: 14, cy: 14 },
      topRight: { cx: 36, cy: 14 },
      midLeft: { cx: 14, cy: 25 },
      center: { cx: 25, cy: 25 },
      midRight: { cx: 36, cy: 25 },
      bottomLeft: { cx: 14, cy: 36 },
      bottomRight: { cx: 36, cy: 36 }
    };

    // Which pips to show for each face value
    const pipConfigs = {
      1: ['center'],
      2: ['topRight', 'bottomLeft'],
      3: ['topRight', 'center', 'bottomLeft'],
      4: ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'],
      5: ['topLeft', 'topRight', 'center', 'bottomLeft', 'bottomRight'],
      6: ['topLeft', 'topRight', 'midLeft', 'midRight', 'bottomLeft', 'bottomRight']
    };

    const pips = pipConfigs[faceValue].map(pos => {
      const p = positions[pos];
      return `<circle cx="${p.cx}" cy="${p.cy}" r="5" fill="${pipColor}"/>`;
    }).join('');

    return `<svg viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">${pips}</svg>`;
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
          <label>Room Code <span class="dice-hint">(click dice to change)</span></label>
          <div class="dice-input-container">
            <div class="room-dice" id="room-dice-0" data-index="0"></div>
            <div class="room-dice" id="room-dice-1" data-index="1"></div>
            <div class="room-dice" id="room-dice-2" data-index="2"></div>
            <div class="room-dice" id="room-dice-3" data-index="3"></div>
          </div>
        </div>
        <div class="join-buttons">
          <button class="btn-create" id="btn-create">Create Room</button>
          <button class="btn-join" id="btn-join">Join Room</button>
        </div>
      </div>
    `;
    this._joinMode = false;

    // Initialize dice with SVGs
    for (let i = 0; i < 4; i++) {
      const die = this.querySelector(`#room-dice-${i}`);
      if (die) die.innerHTML = this.getDiceSvg(this._diceValues[i]);
    }
  }

  setupEventListeners() {
    const createBtn = this.querySelector('#btn-create');
    const joinBtn = this.querySelector('#btn-join');
    const usernameInput = this.querySelector('#username');
    const dismissBtn = this.querySelector('#banner-dismiss');

    createBtn.addEventListener('click', () => this.handleCreate());
    joinBtn.addEventListener('click', () => this.handleJoin());

    // Click handlers for each die
    for (let i = 0; i < 4; i++) {
      const die = this.querySelector(`#room-dice-${i}`);
      die.addEventListener('click', (e) => this.handleDiceClick(e, i));
    }

    // Enter key support
    usernameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.handleCreate();
      }
    });

    // Dismiss banner
    dismissBtn.addEventListener('click', () => {
      this.querySelector('#server-banner').style.display = 'none';
    });

    // Focus username on load
    usernameInput.focus();
  }

  handleDiceClick(e, index) {
    // Cycle to next value (0-5, wrapping around)
    this._diceValues[index] = (this._diceValues[index] + 1) % 6;
    const die = this.querySelector(`#room-dice-${index}`);
    die.innerHTML = this.getDiceSvg(this._diceValues[index]);

    // Add a brief animation
    die.classList.add('flipping');
    setTimeout(() => die.classList.remove('flipping'), 200);
  }

  getRoomIdFromDice() {
    // Room ID is 4 digits from 1-6 (e.g., "3512")
    return this._diceValues.map(v => v + 1).join('');
  }

  setDiceFromRoomId(roomId) {
    // Parse room ID string (e.g., "3512") back to dice values
    for (let i = 0; i < 4 && i < roomId.length; i++) {
      const faceValue = parseInt(roomId[i], 10);
      if (faceValue >= 1 && faceValue <= 6) {
        this._diceValues[i] = faceValue - 1;
        const die = this.querySelector(`#room-dice-${i}`);
        if (die) die.innerHTML = this.getDiceSvg(this._diceValues[i]);
      }
    }
  }

  randomizeDice() {
    for (let i = 0; i < 4; i++) {
      this._diceValues[i] = Math.floor(Math.random() * 6);
      const die = this.querySelector(`#room-dice-${i}`);
      if (die) {
        die.innerHTML = this.getDiceSvg(this._diceValues[i]);
        // Add flip animation
        die.classList.add('flipping');
        setTimeout(() => die.classList.remove('flipping'), 200);
      }
    }
  }

  generateRoomId() {
    // Randomize the dice and return the room ID
    this.randomizeDice();
    return this.getRoomIdFromDice();
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

    if (!username) {
      this.querySelector('#username').focus();
      return;
    }

    // If room ID input is not visible, show it
    if (!this._joinMode) {
      this._joinMode = true;
      roomIdGroup.style.display = 'block';
      this.querySelector('#btn-join').textContent = 'Enter Room';
      return;
    }

    // Room ID input is visible, get room ID from dice and join
    const roomId = this.getRoomIdFromDice();

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
