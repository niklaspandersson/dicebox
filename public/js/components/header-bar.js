/**
 * HeaderBar - Web Component for the application header
 * Manages header state for join view vs room view
 */
class HeaderBar extends HTMLElement {
  constructor() {
    super();
    this._roomId = null;
    this._inRoom = false;
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
  }

  render() {
    this.innerHTML = `
      <div class="header-left">
        <div class="header-title-row">
          <h1>Call to Roll</h1>
        </div>
        <p class="tagline">Roll dice with friends in real-time</p>
        <div class="room-info" style="display: none;">
          <span class="room-id">Room <span class="room-id-value"></span></span>
        </div>
      </div>
      <div class="header-right">
        <button class="btn-leave" style="display: none;" title="Leave room">Leave</button>
      </div>
    `;
  }

  setupEventListeners() {
    const leaveBtn = this.querySelector(".btn-leave");
    if (leaveBtn) {
      leaveBtn.addEventListener("click", () => {
        this.dispatchEvent(new CustomEvent("leave-room", { bubbles: true }));
      });
    }
  }

  showRoomView(roomId) {
    this._inRoom = true;
    this._roomId = roomId;

    // Update app container class for compact header styling
    const appContainer = document.getElementById("app");
    if (appContainer) appContainer.classList.add("in-room");

    // Show room info
    const roomInfo = this.querySelector(".room-info");
    if (roomInfo) roomInfo.style.display = "flex";

    // Set room ID
    const roomIdEl = this.querySelector(".room-id-value");
    if (roomIdEl) roomIdEl.textContent = roomId;

    // Show leave button
    const leaveBtn = this.querySelector(".btn-leave");
    if (leaveBtn) leaveBtn.style.display = "block";
  }

  showJoinView() {
    this._inRoom = false;
    this._roomId = null;

    // Update app container class
    const appContainer = document.getElementById("app");
    if (appContainer) appContainer.classList.remove("in-room");

    // Hide room info
    const roomInfo = this.querySelector(".room-info");
    if (roomInfo) roomInfo.style.display = "none";

    // Hide leave button
    const leaveBtn = this.querySelector(".btn-leave");
    if (leaveBtn) leaveBtn.style.display = "none";
  }
}

customElements.define("header-bar", HeaderBar);
