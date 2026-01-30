/**
 * RoomJoin - Web Component for joining a dice room
 * Supports mode attribute: "create" or "join" to show specific UI directly
 */
import { getDiceSvg } from '../utils/dice-utils.js';

// Predefined color palette (same as dice-config.js)
const DICE_COLORS = [
  { name: 'White', hex: '#ffffff' },
  { name: 'Purple', hex: '#6366f1' },
  { name: 'Green', hex: '#10b981' },
  { name: 'Orange', hex: '#f59e0b' },
  { name: 'Red', hex: '#ef4444' },
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'Cyan', hex: '#06b6d4' },
  { name: 'Yellow', hex: '#eab308' }
];

class RoomJoin extends HTMLElement {
  constructor() {
    super();
    this._diceValues = [0, 0, 0, 0]; // 4 dice, values 0-5 (representing 1-6)
    this._createMode = false;
    this._joinMode = false;
    this._diceSets = [{ id: 'set-1', count: 2, color: '#ffffff' }];
    this._nextSetId = 2;
    this._allowLocking = false;
    this._fixedMode = null; // 'create' or 'join' from attribute
  }

  static get observedAttributes() {
    return ['mode'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'mode' && newValue) {
      this._fixedMode = newValue;
      if (this.isConnected) {
        this.applyFixedMode();
      }
    }
  }

  // Render a die face - converts internal 0-5 value to 1-6 for display
  renderDie(value) {
    return getDiceSvg(value + 1);
  }

  connectedCallback() {
    this._fixedMode = this.getAttribute('mode');
    this.render();
    this.setupEventListeners();
    if (this._fixedMode) {
      this.applyFixedMode();
    }
  }

  applyFixedMode() {
    const createBtn = this.querySelector('#btn-create');
    const joinBtn = this.querySelector('#btn-join');
    const joinButtons = this.querySelector('.join-buttons');

    if (this._fixedMode === 'create') {
      // Show create UI directly
      this._createMode = true;
      const configGroup = this.querySelector('#dice-config-group');
      if (configGroup) configGroup.style.display = 'block';
      if (createBtn) createBtn.textContent = 'Start Room';
      if (joinBtn) joinBtn.style.display = 'none';
      if (joinButtons) joinButtons.style.justifyContent = 'center';
    } else if (this._fixedMode === 'join') {
      // Show join UI directly
      this._joinMode = true;
      const roomIdGroup = this.querySelector('#room-id-group');
      if (roomIdGroup) roomIdGroup.style.display = 'block';
      if (joinBtn) joinBtn.textContent = 'Enter Room';
      if (createBtn) createBtn.style.display = 'none';
      if (joinButtons) joinButtons.style.justifyContent = 'center';
    }
  }

  // Public method to set room code from URL parameter
  setRoomCode(roomCode) {
    if (roomCode && roomCode.length === 4) {
      this.setDiceFromRoomId(roomCode);
    }
  }

  render() {
    this.innerHTML = `
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
        <div class="form-group dice-config-group" id="dice-config-group" style="display: none;">
          <label>Dice Sets</label>
          <div class="dice-sets-config" id="dice-sets-config"></div>
          <button class="add-set-btn" id="add-set-btn">+ Add Set</button>
          <div class="room-options">
            <label class="checkbox-label">
              <input type="checkbox" id="allow-locking">
              <span class="checkbox-text">Allow dice locking</span>
              <span class="checkbox-hint">Players can set aside dice between rolls</span>
            </label>
          </div>
        </div>
        <div class="join-buttons">
          <button class="btn-create" id="btn-create">Create Room</button>
          <button class="btn-join" id="btn-join">Join Room</button>
        </div>
      </div>
    `;
    this._joinMode = false;
    this._createMode = false;

    // Initialize dice with SVGs
    for (let i = 0; i < 4; i++) {
      const die = this.querySelector(`#room-dice-${i}`);
      if (die) die.innerHTML = this.renderDie(this._diceValues[i]);
    }

    // Render dice sets config
    this.renderDiceSetsConfig();
  }

  renderDiceSetsConfig() {
    const container = this.querySelector('#dice-sets-config');
    if (!container) return;

    container.innerHTML = this._diceSets.map((set, index) => `
      <div class="dice-set-row" data-set-id="${set.id}">
        <div class="color-picker">
          <button class="color-btn" style="background: ${set.color}" data-action="color" data-set-id="${set.id}">
            <span class="color-dropdown-arrow"></span>
          </button>
          <div class="color-dropdown" data-set-id="${set.id}">
            ${DICE_COLORS.map(c => `
              <button class="color-option ${c.hex === set.color ? 'selected' : ''}"
                      data-color="${c.hex}"
                      style="background: ${c.hex}"
                      title="${c.name}"></button>
            `).join('')}
          </div>
        </div>
        <div class="count-controls">
          <button class="config-btn" data-action="decrease" data-set-id="${set.id}">-</button>
          <span class="config-value">${set.count}</span>
          <button class="config-btn" data-action="increase" data-set-id="${set.id}">+</button>
        </div>
        ${this._diceSets.length > 1 ? `
          <button class="remove-set-btn" data-action="remove" data-set-id="${set.id}">×</button>
        ` : ''}
      </div>
    `).join('');

    // Update add button state
    const addBtn = this.querySelector('#add-set-btn');
    if (addBtn) {
      addBtn.disabled = this._diceSets.length >= 4;
    }
  }

  setupEventListeners() {
    const createBtn = this.querySelector('#btn-create');
    const joinBtn = this.querySelector('#btn-join');
    const usernameInput = this.querySelector('#username');

    // Pre-fill username from localStorage if available
    const savedUsername = localStorage.getItem('dicebox-username');
    if (savedUsername) {
      usernameInput.value = savedUsername;
    }

    createBtn.addEventListener('click', () => this.handleCreate());
    joinBtn.addEventListener('click', () => this.handleJoin());

    // Click handlers for each die
    for (let i = 0; i < 4; i++) {
      const die = this.querySelector(`#room-dice-${i}`);
      die.addEventListener('click', (e) => this.handleDiceClick(e, i));
    }

    // Dice config event listeners
    this.setupDiceConfigListeners();

    // Enter key support
    usernameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.handleCreate();
      }
    });

    // Focus username on load
    usernameInput.focus();
  }

  setupDiceConfigListeners() {
    const addSetBtn = this.querySelector('#add-set-btn');
    if (addSetBtn) {
      addSetBtn.addEventListener('click', () => this.addDiceSet());
    }

    const lockingCheckbox = this.querySelector('#allow-locking');
    if (lockingCheckbox) {
      lockingCheckbox.checked = this._allowLocking;
      lockingCheckbox.addEventListener('change', (e) => {
        this._allowLocking = e.target.checked;
      });
    }

    // Delegate clicks for dice config controls
    const configGroup = this.querySelector('#dice-config-group');
    if (configGroup) {
      configGroup.addEventListener('click', (e) => {
        // Handle color option selection
        const colorOption = e.target.closest('.color-option');
        if (colorOption) {
          e.stopPropagation();
          const color = colorOption.dataset.color;
          const dropdown = colorOption.closest('.color-dropdown');
          const setId = dropdown.dataset.setId;
          this.updateSetColor(setId, color);
          return;
        }

        // Handle action buttons
        const btn = e.target.closest('[data-action]');
        if (btn) {
          const action = btn.dataset.action;
          const setId = btn.dataset.setId;

          switch (action) {
            case 'increase':
              this.updateSetCount(setId, 1);
              break;
            case 'decrease':
              this.updateSetCount(setId, -1);
              break;
            case 'remove':
              this.removeDiceSet(setId);
              break;
            case 'color':
              this.toggleColorDropdown(setId);
              break;
          }
        }
      });
    }

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.color-picker')) {
        this.closeAllDropdowns();
      }
    });
  }

  toggleColorDropdown(setId) {
    const dropdown = this.querySelector(`.color-dropdown[data-set-id="${setId}"]`);
    const btn = this.querySelector(`.color-btn[data-set-id="${setId}"]`);
    const wasOpen = dropdown?.classList.contains('open');
    this.closeAllDropdowns();
    if (!wasOpen && btn && dropdown) {
      const rect = btn.getBoundingClientRect();
      dropdown.style.left = `${rect.left}px`;
      dropdown.style.top = `${rect.bottom + 4}px`;
      dropdown.classList.add('open');
    }
  }

  closeAllDropdowns() {
    this.querySelectorAll('.color-dropdown.open').forEach(d => d.classList.remove('open'));
  }

  addDiceSet() {
    if (this._diceSets.length >= 4) return;

    const usedColors = new Set(this._diceSets.map(s => s.color));
    const availableColor = DICE_COLORS.find(c => !usedColors.has(c.hex)) || DICE_COLORS[0];

    this._diceSets.push({
      id: `set-${this._nextSetId++}`,
      count: 2,
      color: availableColor.hex
    });
    this.renderDiceSetsConfig();
    this.setupDiceConfigListeners();
  }

  removeDiceSet(setId) {
    if (this._diceSets.length <= 1) return;
    this._diceSets = this._diceSets.filter(s => s.id !== setId);
    this.renderDiceSetsConfig();
    this.setupDiceConfigListeners();
  }

  updateSetCount(setId, delta) {
    const set = this._diceSets.find(s => s.id === setId);
    if (!set) return;

    const newCount = set.count + delta;
    if (newCount >= 1 && newCount <= 10) {
      set.count = newCount;
      const row = this.querySelector(`.dice-set-row[data-set-id="${setId}"]`);
      if (row) {
        const valueEl = row.querySelector('.config-value');
        if (valueEl) valueEl.textContent = newCount;
      }
    }
  }

  updateSetColor(setId, color) {
    const set = this._diceSets.find(s => s.id === setId);
    if (!set) return;

    set.color = color;
    this.closeAllDropdowns();
    this.renderDiceSetsConfig();
    this.setupDiceConfigListeners();
  }

  handleDiceClick(e, index) {
    // Cycle to next value (0-5, wrapping around)
    this._diceValues[index] = (this._diceValues[index] + 1) % 6;
    const die = this.querySelector(`#room-dice-${index}`);
    die.innerHTML = this.renderDie(this._diceValues[index]);

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
        if (die) die.innerHTML = this.renderDie(this._diceValues[i]);
      }
    }
  }

  randomizeDice() {
    for (let i = 0; i < 4; i++) {
      this._diceValues[i] = Math.floor(Math.random() * 6);
      const die = this.querySelector(`#room-dice-${i}`);
      if (die) {
        die.innerHTML = this.renderDie(this._diceValues[i]);
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

    // If not in create mode, show dice config first
    if (!this._createMode) {
      this._createMode = true;
      const configGroup = this.querySelector('#dice-config-group');
      const createBtn = this.querySelector('#btn-create');
      if (configGroup) configGroup.style.display = 'block';
      if (createBtn) createBtn.textContent = 'Start Room';
      return;
    }

    // Save username to localStorage
    localStorage.setItem('dicebox-username', username);

    const roomId = this.generateRoomId();

    this.dispatchEvent(new CustomEvent('join-room', {
      bubbles: true,
      detail: {
        username,
        roomId,
        isHost: true,
        diceConfig: {
          diceSets: [...this._diceSets],
          allowLocking: this._allowLocking
        }
      }
    }));
  }

  resetCreateMode() {
    this._createMode = false;
    const configGroup = this.querySelector('#dice-config-group');
    const createBtn = this.querySelector('#btn-create');
    if (configGroup) configGroup.style.display = 'none';
    if (createBtn) createBtn.textContent = 'Create Room';
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

    // Reset create mode if active
    this.resetCreateMode();

    // If room ID input is not visible, show it
    if (!this._joinMode) {
      this._joinMode = true;
      roomIdGroup.style.display = 'block';
      this.querySelector('#btn-join').textContent = 'Enter Room';
      return;
    }

    // Save username to localStorage
    localStorage.setItem('dicebox-username', username);

    // Room ID input is visible, get room ID from dice and join
    const roomId = this.getRoomIdFromDice();

    this.dispatchEvent(new CustomEvent('join-room', {
      bubbles: true,
      detail: { username, roomId, isHost: false }
    }));
  }

}

customElements.define('room-join', RoomJoin);
