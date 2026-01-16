/**
 * DiceRoller - Web Component for rolling dice
 */
class DiceRoller extends HTMLElement {
  constructor() {
    super();
    this.diceType = 20;
    this.diceCount = 1;
    this.currentValues = [];
    this.isRolling = false;
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
  }

  render() {
    this.innerHTML = `
      <div class="card dice-area">
        <div class="dice-display">
          <div class="die-placeholder">?</div>
        </div>

        <div class="dice-selector">
          <button data-dice="4">d4</button>
          <button data-dice="6">d6</button>
          <button data-dice="8">d8</button>
          <button data-dice="10">d10</button>
          <button data-dice="12">d12</button>
          <button data-dice="20" class="selected">d20</button>
          <button data-dice="100">d100</button>
        </div>

        <div class="dice-controls">
          <button id="btn-remove-die" title="Remove die">-</button>
          <span id="dice-count">1</span>
          <button id="btn-add-die" title="Add die">+</button>
          <button id="btn-roll" class="roll-btn">Roll d20</button>
        </div>

        <div class="roll-total" id="roll-total"></div>
      </div>
    `;
    this.updateRollButton();
  }

  setupEventListeners() {
    // Dice type selection
    this.querySelectorAll('.dice-selector button').forEach(btn => {
      btn.addEventListener('click', () => {
        this.querySelectorAll('.dice-selector button').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.diceType = parseInt(btn.dataset.dice);
        this.updateRollButton();
      });
    });

    // Dice count controls
    this.querySelector('#btn-add-die').addEventListener('click', () => {
      if (this.diceCount < 10) {
        this.diceCount++;
        this.querySelector('#dice-count').textContent = this.diceCount;
        this.updateRollButton();
      }
    });

    this.querySelector('#btn-remove-die').addEventListener('click', () => {
      if (this.diceCount > 1) {
        this.diceCount--;
        this.querySelector('#dice-count').textContent = this.diceCount;
        this.updateRollButton();
      }
    });

    // Roll button
    this.querySelector('#btn-roll').addEventListener('click', () => this.roll());

    // Keyboard shortcut
    document.addEventListener('keypress', (e) => {
      if (e.key === 'r' && !e.target.matches('input')) {
        this.roll();
      }
    });
  }

  updateRollButton() {
    const btn = this.querySelector('#btn-roll');
    if (this.diceCount === 1) {
      btn.textContent = `Roll d${this.diceType}`;
    } else {
      btn.textContent = `Roll ${this.diceCount}d${this.diceType}`;
    }
  }

  async roll() {
    if (this.isRolling) return;
    this.isRolling = true;

    const display = this.querySelector('.dice-display');
    const totalEl = this.querySelector('#roll-total');

    // Show rolling animation
    display.innerHTML = Array(this.diceCount).fill(0).map(() =>
      `<div class="die rolling">?</div>`
    ).join('');

    // Simulate rolling time
    await new Promise(resolve => setTimeout(resolve, 500));

    // Generate random values
    this.currentValues = Array(this.diceCount).fill(0).map(() =>
      Math.floor(Math.random() * this.diceType) + 1
    );

    const total = this.currentValues.reduce((sum, val) => sum + val, 0);

    // Display results
    display.innerHTML = this.currentValues.map(val =>
      `<div class="die">${val}</div>`
    ).join('');

    if (this.diceCount > 1) {
      totalEl.textContent = `Total: ${total}`;
    } else {
      totalEl.textContent = '';
    }

    // Dispatch roll event
    this.dispatchEvent(new CustomEvent('dice-rolled', {
      bubbles: true,
      detail: {
        diceType: this.diceType,
        count: this.diceCount,
        values: this.currentValues,
        total
      }
    }));

    this.isRolling = false;
  }

  // Display a roll from another player
  displayExternalRoll(values, diceType) {
    const display = this.querySelector('.dice-display');
    const totalEl = this.querySelector('#roll-total');

    display.innerHTML = values.map(val =>
      `<div class="die">${val}</div>`
    ).join('');

    if (values.length > 1) {
      const total = values.reduce((sum, val) => sum + val, 0);
      totalEl.textContent = `Total: ${total}`;
    } else {
      totalEl.textContent = '';
    }
  }
}

customElements.define('dice-roller', DiceRoller);
