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
      <div class="room-content">
        <peer-list></peer-list>
        <div class="main-area">
          <dice-config id="dice-config" style="display: none;"></dice-config>
          <dice-roller></dice-roller>
          <dice-history></dice-history>
        </div>
      </div>
    `;

    // Set up leave button handler in main header
    const leaveBtn = document.getElementById('header-leave-btn');
    if (leaveBtn) {
      leaveBtn.onclick = () => {
        this.dispatchEvent(new CustomEvent('leave-room', { bubbles: true }));
      };
    }
  }

  setRoomId(roomId) {
    const el = document.getElementById('header-room-id');
    if (el) {
      el.textContent = roomId;
    }
  }

  setHostStatus(isHost) {
    this._isHost = isHost;
    const badge = document.getElementById('header-host-badge');
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
    // Show room info in header, hide tagline
    document.getElementById('app').classList.add('in-room');
    document.getElementById('header-room-info').style.display = 'flex';
    document.getElementById('header-leave-btn').style.display = 'block';
  }

  hide() {
    this.classList.remove('active');
    // Hide room info, show tagline
    document.getElementById('app').classList.remove('in-room');
    document.getElementById('header-room-info').style.display = 'none';
    document.getElementById('header-leave-btn').style.display = 'none';
    document.getElementById('header-host-badge').style.display = 'none';
  }
}

customElements.define('room-view', RoomView);
