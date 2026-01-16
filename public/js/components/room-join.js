/**
 * RoomJoin - Web Component for joining a dice room
 */
class RoomJoin extends HTMLElement {
  constructor() {
    super();
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
  }

  render() {
    this.innerHTML = `
      <div class="card join-form">
        <div class="form-group">
          <label for="username">Your Name</label>
          <input type="text" id="username" placeholder="Enter your name" maxlength="20" autocomplete="off">
        </div>
        <div class="form-group">
          <label for="room-id">Room Code</label>
          <input type="text" id="room-id" placeholder="Enter room code or leave empty for new room" maxlength="20" autocomplete="off">
        </div>
        <button class="btn-join" id="btn-join">Join Room</button>
      </div>
    `;
  }

  setupEventListeners() {
    const joinBtn = this.querySelector('#btn-join');
    const usernameInput = this.querySelector('#username');
    const roomIdInput = this.querySelector('#room-id');

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
}

customElements.define('room-join', RoomJoin);
