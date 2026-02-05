/**
 * RoomCreate - Component for creating a new dice room
 */
import "../shared/username-input.js";
import "./dice-config.js";

class RoomCreate extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <username-input></username-input>
      <div class="dice-config-group">
        <dice-config></dice-config>
      </div>
      <div class="join-buttons">
        <button class="btn-create" id="submit-btn">Start Room</button>
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
    const diceConfig = this.querySelector("dice-config");

    this.dispatchEvent(
      new CustomEvent("join-room", {
        bubbles: true,
        detail: {
          username: usernameInput.value,
          roomId: this._generateRoomId(),
          isHost: true,
          diceConfig: {
            diceSets: [...diceConfig.diceSets],
          },
        },
      }),
    );
  }

  _generateRoomId() {
    return Array.from(
      { length: 4 },
      () => Math.floor(Math.random() * 6) + 1,
    ).join("");
  }
}

customElements.define("room-create", RoomCreate);
