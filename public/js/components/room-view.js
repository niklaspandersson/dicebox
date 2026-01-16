/**
 * RoomView - Web Component for the main room interface
 */
class RoomView extends HTMLElement {
  constructor() {
    super();
  }

  connectedCallback() {
    this.render();
  }

  render() {
    this.innerHTML = `
      <div class="room-header">
        <div class="room-id">Room: <span id="current-room-id"></span></div>
        <button class="btn-leave" id="btn-leave">Leave Room</button>
      </div>
      <div class="room-content">
        <div class="main-area">
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

  show() {
    this.classList.add('active');
  }

  hide() {
    this.classList.remove('active');
  }
}

customElements.define('room-view', RoomView);
