/**
 * DiceRoller - Displays dice and handles grab/roll interaction
 *
 * Click to grab (dice hidden) → Click again to roll (dice visible)
 */
class DiceRoller extends HTMLElement {
  constructor() {
    super();
    this.diceCount = 1;
    this.currentValues = [];
    this.isRolling = false;

    // Holding state
    this.holderPeerId = null;
    this.holderUsername = null;
    this.myPeerId = null;
    this.isHost = false;
  }

  connectedCallback() {
    this.render();
    this._keyHandler = (e) => {
      if (e.key === 'r' && !e.target.matches('input')) {
        this.handleClick();
      }
    };
    document.addEventListener('keypress', this._keyHandler);
  }

  disconnectedCallback() {
    if (this._keyHandler) {
      document.removeEventListener('keypress', this._keyHandler);
    }
  }

  getDiceSvg(value) {
    const pipColor = '#0f172a';
    const positions = {
      topLeft: { cx: 14, cy: 14 },
      topRight: { cx: 36, cy: 14 },
      midLeft: { cx: 14, cy: 25 },
      center: { cx: 25, cy: 25 },
      midRight: { cx: 36, cy: 25 },
      bottomLeft: { cx: 14, cy: 36 },
      bottomRight: { cx: 36, cy: 36 }
    };
    const pipConfigs = {
      1: ['center'],
      2: ['topRight', 'bottomLeft'],
      3: ['topRight', 'center', 'bottomLeft'],
      4: ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'],
      5: ['topLeft', 'topRight', 'center', 'bottomLeft', 'bottomRight'],
      6: ['topLeft', 'topRight', 'midLeft', 'midRight', 'bottomLeft', 'bottomRight']
    };
    const pips = pipConfigs[value].map(pos => {
      const p = positions[pos];
      return `<circle cx="${p.cx}" cy="${p.cy}" r="5" fill="${pipColor}"/>`;
    }).join('');
    return `<svg viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">${pips}</svg>`;
  }

  render() {
    const isHolding = this.holderPeerId !== null;
    const iAmHolder = this.myPeerId && this.holderPeerId === this.myPeerId;
    const canDrop = this.isHost && isHolding && !iAmHolder;

    this.innerHTML = `
      <div class="card dice-area">
        <div class="dice-display-wrapper ${isHolding ? 'holding' : ''}">
          ${this.renderContent(isHolding, iAmHolder, canDrop)}
        </div>
        <div class="roll-total"></div>
        <div class="dice-hint">${this.getHint(isHolding, iAmHolder)}</div>
      </div>
    `;

    // Attach click handler to the wrapper
    this.querySelector('.dice-display-wrapper').onclick = (e) => {
      if (e.target.closest('.drop-btn')) {
        this.dispatchEvent(new CustomEvent('dice-dropped', { bubbles: true }));
      } else {
        this.handleClick();
      }
    };
  }

  renderContent(isHolding, iAmHolder, canDrop) {
    if (isHolding) {
      return `
        <div class="dice-display holding-state">
          <div class="holding-indicator">
            <div class="holding-hand"></div>
            <div class="holding-text">${iAmHolder ? 'You are' : this.holderUsername + ' is'} holding...</div>
            ${iAmHolder ? '<div class="holding-hint">Click to roll!</div>' : ''}
            ${canDrop ? '<button class="drop-btn">Drop</button>' : ''}
          </div>
        </div>
      `;
    }

    if (this.currentValues.length > 0) {
      return `
        <div class="dice-display">
          ${this.currentValues.map(v => `<div class="die">${this.getDiceSvg(v)}</div>`).join('')}
        </div>
      `;
    }

    return `
      <div class="dice-display">
        ${Array(this.diceCount).fill(0).map(() =>
          `<div class="die-placeholder">${this.getDiceSvg(1)}</div>`
        ).join('')}
      </div>
    `;
  }

  getHint(isHolding, iAmHolder) {
    if (isHolding) {
      return iAmHolder ? 'Click to roll the dice' : `Waiting for ${this.holderUsername} to roll...`;
    }
    return 'Click to grab the dice';
  }

  handleClick() {
    if (this.isRolling) return;

    const iAmHolder = this.myPeerId && this.holderPeerId === this.myPeerId;

    if (!this.holderPeerId) {
      // No one holding - grab
      this.dispatchEvent(new CustomEvent('dice-grabbed', { bubbles: true }));
    } else if (iAmHolder) {
      // I'm holding - roll
      this.roll();
    }
  }

  async roll() {
    if (this.isRolling) return;
    this.isRolling = true;

    const display = this.querySelector('.dice-display');
    const hint = this.querySelector('.dice-hint');
    const total = this.querySelector('.roll-total');

    // Rolling animation
    display.classList.remove('holding-state');
    display.innerHTML = Array(this.diceCount).fill(0).map(() =>
      `<div class="die rolling">${this.getDiceSvg(1)}</div>`
    ).join('');
    hint.textContent = 'Rolling...';

    // Animate for 500ms
    const animate = () => {
      display.querySelectorAll('.die').forEach(die => {
        die.innerHTML = this.getDiceSvg(Math.floor(Math.random() * 6) + 1);
      });
    };
    const interval = setInterval(animate, 80);
    await new Promise(r => setTimeout(r, 500));
    clearInterval(interval);

    // Generate final values
    this.currentValues = Array(this.diceCount).fill(0).map(() =>
      Math.floor(Math.random() * 6) + 1
    );
    const sum = this.currentValues.reduce((a, b) => a + b, 0);

    // Show result
    display.innerHTML = this.currentValues.map(v =>
      `<div class="die">${this.getDiceSvg(v)}</div>`
    ).join('');
    total.textContent = this.diceCount > 1 ? `Total: ${sum}` : '';
    hint.textContent = 'Click to grab the dice';

    this.isRolling = false;

    // Emit roll event
    this.dispatchEvent(new CustomEvent('dice-rolled', {
      bubbles: true,
      detail: { diceType: 6, count: this.diceCount, values: this.currentValues, total: sum }
    }));
  }

  // External API
  setConfig({ diceCount, holderPeerId, holderUsername, myPeerId, isHost }) {
    this.diceCount = diceCount;
    this.holderPeerId = holderPeerId;
    this.holderUsername = holderUsername;
    this.myPeerId = myPeerId;
    this.isHost = isHost;
    this.render();
  }

  showRoll(values) {
    this.currentValues = values;
    const display = this.querySelector('.dice-display');
    const total = this.querySelector('.roll-total');
    if (!display) return;

    display.classList.remove('holding-state');
    display.innerHTML = values.map(v => `<div class="die">${this.getDiceSvg(v)}</div>`).join('');
    total.textContent = values.length > 1 ? `Total: ${values.reduce((a, b) => a + b, 0)}` : '';
  }
}

customElements.define('dice-roller', DiceRoller);
