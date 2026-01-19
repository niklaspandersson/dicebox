/**
 * RoomView - Web Component for the main room interface
 */
class RoomView extends HTMLElement {
  constructor() {
    super();
    this._isHost = false;
  }

  connectedCallback() {
    this.render();
  }

  render() {
    this.innerHTML = `
      <div class="room-header">
        <div class="room-info">
          <div class="room-id">Room: <span id="current-room-id"></span></div>
          <div class="host-badge" id="host-badge" style="display: none;">HOST</div>
        </div>
        <button class="btn-leave" id="btn-leave">Leave Room</button>
      </div>
      <div class="room-content">
        <div class="main-area">
          <dice-config id="dice-config" style="display: none;"></dice-config>
          <dice-roller></dice-roller>
          <dice-history></dice-history>
        </div>
        <div class="sidebar">
          <peer-list></peer-list>
        </div>
      </div>
    `;

    this.querySelector('#btn-leave').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('leave-room', { bubbles: true }));
    });
  }

  setRoomId(roomId) {
    const el = this.querySelector('#current-room-id');
    if (el) {
      el.textContent = roomId;
    }
  }

  setHostStatus(isHost) {
    this._isHost = isHost;
    const badge = this.querySelector('#host-badge');
    const config = this.querySelector('#dice-config');
    if (badge) {
      badge.style.display = isHost ? 'inline-block' : 'none';
    }
    if (config) {
      config.style.display = isHost ? 'block' : 'none';
    }
  }

  show() {
    this.classList.add('active');
  }

  hide() {
    this.classList.remove('active');
  }
}

customElements.define('room-view', RoomView);
