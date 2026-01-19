/**
 * DiceRoller - Web Component for rolling d6 dice
 */
class DiceRoller extends HTMLElement {
  constructor() {
    super();
    this.diceType = 6;
    this.diceCount = 1;
    this.currentValues = [];
    this.isRolling = false;
  }

  // Generate SVG for a die face with proper pip arrangement
  getDiceSvg(value, isRolling = false) {
    const pipColor = '#0f172a';

    // Pip positions for a standard die (relative to 50x50 viewBox)
    const positions = {
      topLeft: { cx: 14, cy: 14 },
      topRight: { cx: 36, cy: 14 },
      midLeft: { cx: 14, cy: 25 },
      center: { cx: 25, cy: 25 },
      midRight: { cx: 36, cy: 25 },
      bottomLeft: { cx: 14, cy: 36 },
      bottomRight: { cx: 36, cy: 36 }
    };

    // Which pips to show for each face value
    const pipConfigs = {
      1: ['center'],
      2: ['topRight', 'bottomLeft'],
      3: ['topRight', 'center', 'bottomLeft'],
      4: ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'],
      5: ['topLeft', 'topRight', 'center', 'bottomLeft', 'bottomRight'],
      6: ['topLeft', 'topRight', 'midLeft', 'midRight', 'bottomLeft', 'bottomRight']
    };

    // For rolling animation, show a random face
    const displayValue = isRolling ? Math.floor(Math.random() * 6) + 1 : value;

    const pips = pipConfigs[displayValue].map(pos => {
      const p = positions[pos];
      return `<circle cx="${p.cx}" cy="${p.cy}" r="5" fill="${pipColor}"/>`;
    }).join('');

    return `<svg viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">${pips}</svg>`;
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
  }

  render() {
    this.innerHTML = `
      <div class="card dice-area">
        <div class="dice-display">
          <div class="die-placeholder">
            ${this.getDiceSvg(1)}
          </div>
        </div>

        <div class="dice-controls">
          <button id="btn-remove-die" title="Remove die">-</button>
          <span id="dice-count">1</span>
          <button id="btn-add-die" title="Add die">+</button>
          <button id="btn-roll" class="roll-btn">Roll</button>
        </div>

        <div class="roll-total" id="roll-total"></div>
      </div>
    `;
  }

  setupEventListeners() {
    // Dice count controls
    this.querySelector('#btn-add-die').addEventListener('click', () => {
      if (this.diceCount < 10) {
        this.diceCount++;
        this.querySelector('#dice-count').textContent = this.diceCount;
      }
    });

    this.querySelector('#btn-remove-die').addEventListener('click', () => {
      if (this.diceCount > 1) {
        this.diceCount--;
        this.querySelector('#dice-count').textContent = this.diceCount;
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

  async roll() {
    if (this.isRolling) return;
    this.isRolling = true;

    const display = this.querySelector('.dice-display');
    const totalEl = this.querySelector('#roll-total');

    // Show rolling animation with SVG dice
    display.innerHTML = Array(this.diceCount).fill(0).map(() =>
      `<div class="die rolling">${this.getDiceSvg(1, true)}</div>`
    ).join('');

    // Animate the dice during roll
    const rollDuration = 500;
    const frameInterval = 80;
    let elapsed = 0;

    const animateRoll = () => {
      if (elapsed < rollDuration) {
        display.querySelectorAll('.die').forEach(die => {
          die.innerHTML = this.getDiceSvg(Math.floor(Math.random() * 6) + 1);
        });
        elapsed += frameInterval;
        setTimeout(animateRoll, frameInterval);
      }
    };
    animateRoll();

    // Wait for animation to complete
    await new Promise(resolve => setTimeout(resolve, rollDuration));

    // Generate random values
    this.currentValues = Array(this.diceCount).fill(0).map(() =>
      Math.floor(Math.random() * this.diceType) + 1
    );

    const total = this.currentValues.reduce((sum, val) => sum + val, 0);

    // Display results with SVG dice
    display.innerHTML = this.currentValues.map(val =>
      `<div class="die">${this.getDiceSvg(val)}</div>`
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
  displayExternalRoll(values) {
    const display = this.querySelector('.dice-display');
    const totalEl = this.querySelector('#roll-total');

    display.innerHTML = values.map(val =>
      `<div class="die">${this.getDiceSvg(val)}</div>`
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
