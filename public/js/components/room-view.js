/**
 * RoomView - Web Component for the main room interface
 * Contains the peer list, dice roller, and dice history components
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
      <play-frame>
        <div class="room-content">
          <peer-list></peer-list>
          <div class="main-area">
            <dice-roller></dice-roller>
            <dice-history></dice-history>
          </div>
        </div>
      </play-frame>
    `;
  }

  show() {
    this.classList.add('active');
  }

  hide() {
    this.classList.remove('active');
  }
}

customElements.define('room-view', RoomView);
