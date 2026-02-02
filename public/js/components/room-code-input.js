/**
 * RoomCodeInput - Component for 4 clickable dice to enter room codes
 */
import { getDiceSvg } from "../utils/dice-utils.js";

class RoomCodeInput extends HTMLElement {
  constructor() {
    super();
    this._diceValues = [0, 0, 0, 0];
  }

  connectedCallback() {
    this.innerHTML = `
      <div class="form-group room-id-group">
        <label>Room Code <span class="dice-hint">(click dice to change)</span></label>
        <div class="dice-input-container">
          ${[0, 1, 2, 3]
            .map(
              (i) => `
            <div class="room-dice" data-index="${i}">${getDiceSvg(this._diceValues[i] + 1)}</div>
          `,
            )
            .join("")}
        </div>
      </div>
    `;
    this.addEventListener("click", (e) => this._handleClick(e));
  }

  _handleClick(e) {
    const die = e.target.closest(".room-dice");
    if (!die) return;

    const index = parseInt(die.dataset.index, 10);
    this._diceValues[index] = (this._diceValues[index] + 1) % 6;
    die.innerHTML = getDiceSvg(this._diceValues[index] + 1);
    die.classList.add("flipping");
    setTimeout(() => die.classList.remove("flipping"), 200);

    this.dispatchEvent(
      new CustomEvent("room-code-changed", {
        bubbles: true,
        detail: { roomCode: this.roomCode },
      }),
    );
  }

  get roomCode() {
    return this._diceValues.map((v) => v + 1).join("");
  }

  setRoomCode(code) {
    if (!code || code.length !== 4) return;

    for (let i = 0; i < 4; i++) {
      const val = parseInt(code[i], 10);
      if (val >= 1 && val <= 6) {
        this._diceValues[i] = val - 1;
        const die = this.querySelector(`.room-dice[data-index="${i}"]`);
        if (die) die.innerHTML = getDiceSvg(val);
      }
    }
  }
}

customElements.define("room-code-input", RoomCodeInput);
