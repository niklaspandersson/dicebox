/**
 * UsernameInput - Component for username text input with localStorage persistence
 */
class UsernameInput extends HTMLElement {
  connectedCallback() {
    const saved = localStorage.getItem("dicebox-username") || "";
    this.innerHTML = `
      <div class="form-group">
        <label for="username">Your Name</label>
        <input type="text" id="username" placeholder="Enter your name"
               maxlength="20" autocomplete="off" value="${saved}">
      </div>
    `;
    this._input = this.querySelector("input");
    this._input.addEventListener("input", () => this._emitChange());
    this._input.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        this.dispatchEvent(
          new CustomEvent("username-submit", { bubbles: true }),
        );
      }
    });
  }

  get value() {
    return this._input?.value.trim() || "";
  }

  focus() {
    this._input?.focus();
  }

  saveToStorage() {
    localStorage.setItem("dicebox-username", this.value);
  }

  _emitChange() {
    this.dispatchEvent(
      new CustomEvent("username-changed", {
        bubbles: true,
        detail: { username: this.value },
      }),
    );
  }
}

customElements.define("username-input", UsernameInput);
