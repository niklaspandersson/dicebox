/**
 * DiceConfig - Host-only component for configuring room dice settings
 */
class DiceConfig extends HTMLElement {
  constructor() {
    super();
    this.diceCount = 1;
  }

  connectedCallback() {
    this.render();
  }

  render() {
    this.innerHTML = `
      <div class="dice-config card">
        <div class="config-row">
          <label>Number of dice:</label>
          <div class="config-controls">
            <button class="config-btn" id="btn-decrease">-</button>
            <span class="config-value" id="dice-count">${this.diceCount}</span>
            <button class="config-btn" id="btn-increase">+</button>
          </div>
        </div>
      </div>
    `;

    this.querySelector('#btn-decrease').addEventListener('click', () => {
      if (this.diceCount > 1) {
        this.diceCount--;
        this.updateDisplay();
        this.emitChange();
      }
    });

    this.querySelector('#btn-increase').addEventListener('click', () => {
      if (this.diceCount < 10) {
        this.diceCount++;
        this.updateDisplay();
        this.emitChange();
      }
    });
  }

  updateDisplay() {
    const countEl = this.querySelector('#dice-count');
    if (countEl) {
      countEl.textContent = this.diceCount;
    }
  }

  emitChange() {
    this.dispatchEvent(new CustomEvent('dice-config-changed', {
      bubbles: true,
      detail: { count: this.diceCount }
    }));
  }

  // Called externally to set the count (e.g., when syncing state)
  setCount(count) {
    this.diceCount = count;
    this.updateDisplay();
  }
}

customElements.define('dice-config', DiceConfig);
