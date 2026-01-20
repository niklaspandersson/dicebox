/**
 * DiceConfig - Host-only component for configuring room dice settings
 * Supports multiple dice sets with different colors
 */

// Predefined color palette
const DICE_COLORS = [
  { name: 'Purple', hex: '#6366f1' },
  { name: 'Green', hex: '#10b981' },
  { name: 'Orange', hex: '#f59e0b' },
  { name: 'Red', hex: '#ef4444' },
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'Cyan', hex: '#06b6d4' },
  { name: 'Yellow', hex: '#eab308' }
];

class DiceConfig extends HTMLElement {
  constructor() {
    super();
    this.diceSets = [
      { id: 'set-1', count: 2, color: '#6366f1' }
    ];
    this.nextSetId = 2;
    this._listenersAttached = false;
    this._boundDocClickHandler = null;
  }

  connectedCallback() {
    this.render();
    this.attachEventListeners();
  }

  disconnectedCallback() {
    // Clean up document listener when component is removed
    if (this._boundDocClickHandler) {
      document.removeEventListener('click', this._boundDocClickHandler);
      this._boundDocClickHandler = null;
    }
  }

  render() {
    this.innerHTML = `
      <div class="dice-config card">
        <div class="dice-sets-header">
          <span class="config-label">Dice Sets</span>
          <button class="add-set-btn" ${this.diceSets.length >= 4 ? 'disabled' : ''}>+ Add Set</button>
        </div>
        <div class="dice-sets-list">
          ${this.diceSets.map((set, index) => this.renderDiceSet(set, index)).join('')}
        </div>
      </div>
    `;
  }

  renderDiceSet(set, index) {
    const colorIndex = DICE_COLORS.findIndex(c => c.hex === set.color);
    return `
      <div class="dice-set-row" data-set-id="${set.id}">
        <div class="color-picker">
          <button class="color-btn" style="background: ${set.color}" data-action="color" data-set-id="${set.id}">
            <span class="color-dropdown-arrow"></span>
          </button>
          <div class="color-dropdown" data-set-id="${set.id}">
            ${DICE_COLORS.map(c => `
              <button class="color-option ${c.hex === set.color ? 'selected' : ''}"
                      data-color="${c.hex}"
                      style="background: ${c.hex}"
                      title="${c.name}"></button>
            `).join('')}
          </div>
        </div>
        <div class="count-controls">
          <button class="config-btn" data-action="decrease" data-set-id="${set.id}">-</button>
          <span class="config-value">${set.count}</span>
          <button class="config-btn" data-action="increase" data-set-id="${set.id}">+</button>
        </div>
        ${this.diceSets.length > 1 ? `
          <button class="remove-set-btn" data-action="remove" data-set-id="${set.id}">×</button>
        ` : ''}
      </div>
    `;
  }

  attachEventListeners() {
    // Only attach listeners once
    if (this._listenersAttached) return;
    this._listenersAttached = true;

    // Handle all clicks via delegation on the component
    this.addEventListener('click', (e) => {
      // Handle color option selection first (highest priority)
      const colorOption = e.target.closest('.color-option');
      if (colorOption) {
        e.stopPropagation();
        const color = colorOption.dataset.color;
        const dropdown = colorOption.closest('.color-dropdown');
        const setId = dropdown.dataset.setId;
        this.updateColor(setId, color);
        return;
      }

      // Handle add set button
      if (e.target.closest('.add-set-btn')) {
        this.addDiceSet();
        return;
      }

      // Handle action buttons (increase, decrease, remove, color toggle)
      const btn = e.target.closest('[data-action]');
      if (btn) {
        const action = btn.dataset.action;
        const setId = btn.dataset.setId;

        switch (action) {
          case 'increase':
            this.updateCount(setId, 1);
            break;
          case 'decrease':
            this.updateCount(setId, -1);
            break;
          case 'remove':
            this.removeDiceSet(setId);
            break;
          case 'color':
            this.toggleColorDropdown(setId);
            break;
        }
      }
    });

    // Close dropdowns when clicking outside - store reference for cleanup
    this._boundDocClickHandler = (e) => {
      if (!e.target.closest('.color-picker')) {
        this.closeAllDropdowns();
      }
    };
    document.addEventListener('click', this._boundDocClickHandler);
  }

  toggleColorDropdown(setId) {
    const dropdown = this.querySelector(`.color-dropdown[data-set-id="${setId}"]`);
    const btn = this.querySelector(`.color-btn[data-set-id="${setId}"]`);
    const wasOpen = dropdown.classList.contains('open');
    this.closeAllDropdowns();
    if (!wasOpen && btn) {
      // Position the dropdown relative to the button
      const rect = btn.getBoundingClientRect();
      dropdown.style.left = `${rect.left}px`;
      dropdown.style.top = `${rect.bottom + 4}px`;
      dropdown.classList.add('open');
    }
  }

  closeAllDropdowns() {
    this.querySelectorAll('.color-dropdown.open').forEach(d => d.classList.remove('open'));
  }

  addDiceSet() {
    if (this.diceSets.length >= 4) return;

    // Pick a color that isn't used yet
    const usedColors = new Set(this.diceSets.map(s => s.color));
    const availableColor = DICE_COLORS.find(c => !usedColors.has(c.hex)) || DICE_COLORS[0];

    this.diceSets.push({
      id: `set-${this.nextSetId++}`,
      count: 2,
      color: availableColor.hex
    });
    this.render();
    this.emitChange();
  }

  removeDiceSet(setId) {
    if (this.diceSets.length <= 1) return;
    this.diceSets = this.diceSets.filter(s => s.id !== setId);
    this.render();
    this.emitChange();
  }

  updateCount(setId, delta) {
    const set = this.diceSets.find(s => s.id === setId);
    if (!set) return;

    const newCount = set.count + delta;
    if (newCount >= 1 && newCount <= 10) {
      set.count = newCount;
      this.updateDisplay();
      this.emitChange();
    }
  }

  updateColor(setId, color) {
    const set = this.diceSets.find(s => s.id === setId);
    if (!set) return;

    set.color = color;
    this.closeAllDropdowns();
    this.render();
    this.emitChange();
  }

  updateDisplay() {
    this.diceSets.forEach(set => {
      const row = this.querySelector(`.dice-set-row[data-set-id="${set.id}"]`);
      if (row) {
        const valueEl = row.querySelector('.config-value');
        if (valueEl) valueEl.textContent = set.count;
      }
    });
  }

  emitChange() {
    this.dispatchEvent(new CustomEvent('dice-config-changed', {
      bubbles: true,
      detail: { diceSets: [...this.diceSets] }
    }));
  }

  // Called externally to set the config (e.g., when syncing state)
  setConfig(config) {
    if (config.diceSets) {
      this.diceSets = config.diceSets;
      // Update nextSetId to avoid collisions
      const maxId = this.diceSets.reduce((max, s) => {
        const num = parseInt(s.id.replace('set-', ''), 10);
        return isNaN(num) ? max : Math.max(max, num);
      }, 0);
      this.nextSetId = maxId + 1;
    } else if (config.count !== undefined) {
      // Legacy support: convert old format
      this.diceSets = [{ id: 'set-1', count: config.count, color: '#6366f1' }];
    }
    this.render();
  }

  // Legacy method for backward compatibility
  setCount(count) {
    this.setConfig({ count });
  }
}

customElements.define('dice-config', DiceConfig);
