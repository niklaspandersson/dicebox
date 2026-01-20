/**
 * RoomView - Web Component for the main room interface
 */
class RoomView extends HTMLElement {
  constructor() {
    super();
    this._isHost = false;
    this._modalOpen = false;
  }

  connectedCallback() {
    this.render();
  }

  render() {
    this.innerHTML = `
      <div class="room-content">
        <peer-list></peer-list>
        <div class="main-area">
          <dice-roller></dice-roller>
          <dice-history></dice-history>
        </div>
      </div>

      <!-- Dice Config Modal -->
      <div class="modal-overlay" id="dice-config-modal" style="display: none;">
        <div class="modal-content">
          <div class="modal-header">
            <h2>Dice Settings</h2>
            <button class="modal-close-btn" id="modal-close-btn">&times;</button>
          </div>
          <dice-config id="dice-config"></dice-config>
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

    // Set up settings button handler
    const settingsBtn = document.getElementById('header-settings-btn');
    if (settingsBtn) {
      settingsBtn.onclick = () => this.toggleModal();
    }

    // Set up modal close handlers
    const modal = this.querySelector('#dice-config-modal');
    const closeBtn = this.querySelector('#modal-close-btn');

    closeBtn?.addEventListener('click', () => this.closeModal());
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.closeModal();
      }
    });

    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._modalOpen) {
        this.closeModal();
      }
    });
  }

  toggleModal() {
    if (this._modalOpen) {
      this.closeModal();
    } else {
      this.openModal();
    }
  }

  openModal() {
    const modal = this.querySelector('#dice-config-modal');
    if (modal) {
      modal.style.display = 'flex';
      this._modalOpen = true;
    }
  }

  closeModal() {
    const modal = this.querySelector('#dice-config-modal');
    if (modal) {
      modal.style.display = 'none';
      this._modalOpen = false;
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
    const settingsBtn = document.getElementById('header-settings-btn');
    if (badge) {
      badge.style.display = isHost ? 'inline-block' : 'none';
    }
    if (settingsBtn) {
      settingsBtn.style.display = isHost ? 'flex' : 'none';
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
    this.closeModal();
    // Hide room info, show tagline
    document.getElementById('app').classList.remove('in-room');
    document.getElementById('header-room-info').style.display = 'none';
    document.getElementById('header-leave-btn').style.display = 'none';
    document.getElementById('header-host-badge').style.display = 'none';
    const settingsBtn = document.getElementById('header-settings-btn');
    if (settingsBtn) {
      settingsBtn.style.display = 'none';
    }
  }
}

customElements.define('room-view', RoomView);
