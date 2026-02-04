/**
 * RoomView - Web Component for the main room interface
 * Contains the peer list, dice roller, and dice history components
 *
 * Now uses the new strategy-based dice-roller-container.
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
      <div class="room-content">
        <peer-list></peer-list>
        <div class="main-area">
          <dice-roller-container></dice-roller-container>
          <dice-history></dice-history>
        </div>
      </div>
    `;
  }
}

customElements.define("room-view", RoomView);
