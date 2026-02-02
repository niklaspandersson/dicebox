/**
 * RoomJoin - Component for joining an existing dice room
 */
import "./username-input.js";
import "./room-code-input.js";

class RoomJoin extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div class="card join-form">
        <username-input></username-input>
        <room-code-input></room-code-input>
        <div class="join-buttons">
          <button class="btn-join" id="submit-btn">Enter Room</button>
        </div>
      </div>
    `;

    this.querySelector("#submit-btn").addEventListener("click", () =>
      this._handleSubmit(),
    );
    this.addEventListener("username-submit", () => this._handleSubmit());
    this.querySelector("username-input").focus();
  }

  _handleSubmit() {
    const usernameInput = this.querySelector("username-input");
    if (!usernameInput.value) {
      usernameInput.focus();
      return;
    }

    usernameInput.saveToStorage();
    const roomCodeInput = this.querySelector("room-code-input");

    this.dispatchEvent(
      new CustomEvent("join-room", {
        bubbles: true,
        detail: {
          username: usernameInput.value,
          roomId: roomCodeInput.roomCode,
          isHost: false,
        },
      }),
    );
  }

  setRoomCode(code) {
    const roomCodeInput = this.querySelector("room-code-input");
    if (roomCodeInput) {
      roomCodeInput.setRoomCode(code);
    }
  }
}

customElements.define("room-join", RoomJoin);
