/**
 * DiceRoller - Web Component for rolling d6 dice
 *
 * New behavior:
 * - Host configures the dice count for the room
 * - Click to "hold" the dice (they become hidden)
 * - Click again to roll (dice become visible with results)
 */
class DiceRoller extends HTMLElement {
  constructor() {
    super();
    this.diceType = 6;
    this.diceCount = 1;
    this.currentValues = [];
    this.isRolling = false;

    // State from room
    this.holderPeerId = null;
    this.holderUsername = null;
    this.myPeerId = null;
    this.isHost = false;
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
    const isHolding = this.holderPeerId !== null;
    const iAmHolder = this.holderPeerId === this.myPeerId;

    this.innerHTML = `
      <div class="card dice-area">
        ${this.isHost ? this.renderHostControls() : ''}

        <div class="dice-display-wrapper ${isHolding ? 'holding' : ''}" id="dice-click-area">
          ${this.renderDiceDisplay(isHolding, iAmHolder)}
        </div>

        <div class="roll-total" id="roll-total"></div>

        <div class="dice-hint" id="dice-hint">
          ${this.getHintText(isHolding, iAmHolder)}
        </div>
      </div>
    `;
  }

  renderHostControls() {
    return `
      <div class="host-dice-controls">
        <label>Dice count:</label>
        <button id="btn-remove-die" class="dice-config-btn" title="Remove die">-</button>
        <span id="dice-count">${this.diceCount}</span>
        <button id="btn-add-die" class="dice-config-btn" title="Add die">+</button>
      </div>
    `;
  }

  renderDiceDisplay(isHolding, iAmHolder) {
    if (isHolding) {
      // Someone is holding - show holding state
      const canDrop = this.isHost && !iAmHolder;
      return `
        <div class="dice-display holding-state">
          <div class="holding-indicator">
            <div class="holding-hand"></div>
            <div class="holding-text">${iAmHolder ? 'You are' : this.holderUsername + ' is'} holding...</div>
            ${iAmHolder ? '<div class="holding-hint">Click to roll!</div>' : ''}
            ${canDrop ? '<button class="drop-dice-btn" id="btn-drop-dice">Drop dice</button>' : ''}
          </div>
        </div>
      `;
    }

    // No one holding - show dice (or placeholders)
    if (this.currentValues.length > 0) {
      return `
        <div class="dice-display">
          ${this.currentValues.map(val =>
            `<div class="die">${this.getDiceSvg(val)}</div>`
          ).join('')}
        </div>
      `;
    }

    // Show placeholder dice
    return `
      <div class="dice-display">
        ${Array(this.diceCount).fill(0).map(() =>
          `<div class="die-placeholder">${this.getDiceSvg(1)}</div>`
        ).join('')}
      </div>
    `;
  }

  getHintText(isHolding, iAmHolder) {
    if (isHolding) {
      if (iAmHolder) {
        return 'Click to roll the dice';
      }
      return `Waiting for ${this.holderUsername} to roll...`;
    }
    return 'Click to grab the dice';
  }

  setupEventListeners() {
    // Host dice count controls
    if (this.isHost) {
      const addBtn = this.querySelector('#btn-add-die');
      const removeBtn = this.querySelector('#btn-remove-die');

      if (addBtn) {
        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.diceCount < 10) {
            this.diceCount++;
            this.querySelector('#dice-count').textContent = this.diceCount;
            this.dispatchEvent(new CustomEvent('dice-config-changed', {
              bubbles: true,
              detail: { count: this.diceCount }
            }));
            // Re-render to update placeholder count
            this.updateDisplay();
          }
        });
      }

      if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.diceCount > 1) {
            this.diceCount--;
            this.querySelector('#dice-count').textContent = this.diceCount;
            this.dispatchEvent(new CustomEvent('dice-config-changed', {
              bubbles: true,
              detail: { count: this.diceCount }
            }));
            // Re-render to update placeholder count
            this.updateDisplay();
          }
        });
      }
    }

    // Click on dice area to grab or roll
    const clickArea = this.querySelector('#dice-click-area');
    if (clickArea) {
      clickArea.addEventListener('click', () => this.handleClick());
    }

    // Keyboard shortcut
    this.keyHandler = (e) => {
      if (e.key === 'r' && !e.target.matches('input')) {
        this.handleClick();
      }
    };
    document.addEventListener('keypress', this.keyHandler);
  }

  disconnectedCallback() {
    if (this.keyHandler) {
      document.removeEventListener('keypress', this.keyHandler);
    }
  }

  handleClick() {
    if (this.isRolling) return;

    const iAmHolder = this.holderPeerId === this.myPeerId;

    if (this.holderPeerId === null) {
      // No one holding - grab the dice
      this.dispatchEvent(new CustomEvent('dice-grabbed', { bubbles: true }));
    } else if (iAmHolder) {
      // I'm holding - roll!
      this.roll();
    }
    // If someone else is holding, ignore clicks
  }

  async roll() {
    if (this.isRolling) return;
    this.isRolling = true;

    const display = this.querySelector('.dice-display');
    const totalEl = this.querySelector('#roll-total');
    const hintEl = this.querySelector('#dice-hint');

    // Show rolling animation with SVG dice
    display.innerHTML = Array(this.diceCount).fill(0).map(() =>
      `<div class="die rolling">${this.getDiceSvg(1, true)}</div>`
    ).join('');
    display.classList.remove('holding-state');

    if (hintEl) {
      hintEl.textContent = 'Rolling...';
    }

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

    // Update hint (will be updated properly via setConfig)
    if (hintEl) {
      hintEl.textContent = 'Click to grab the dice';
    }
  }

  // Update display without full re-render
  updateDisplay() {
    const wrapper = this.querySelector('.dice-display-wrapper');
    const hintEl = this.querySelector('#dice-hint');

    if (!wrapper) return;

    const isHolding = this.holderPeerId !== null;
    const iAmHolder = this.holderPeerId === this.myPeerId;

    wrapper.className = `dice-display-wrapper ${isHolding ? 'holding' : ''}`;
    wrapper.innerHTML = this.renderDiceDisplay(isHolding, iAmHolder);

    if (hintEl) {
      hintEl.textContent = this.getHintText(isHolding, iAmHolder);
    }

    // Re-attach click handler
    wrapper.addEventListener('click', (e) => {
      // Don't trigger grab/roll when clicking the drop button
      if (e.target.id === 'btn-drop-dice') return;
      this.handleClick();
    });

    // Attach drop button handler if present
    const dropBtn = wrapper.querySelector('#btn-drop-dice');
    if (dropBtn) {
      dropBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dispatchEvent(new CustomEvent('dice-dropped', { bubbles: true }));
      });
    }
  }

  // Called by app.js to update state
  setConfig({ diceCount, holderPeerId, holderUsername, myPeerId, isHost }) {
    const needsRender = this.isHost !== isHost;

    this.diceCount = diceCount;
    this.holderPeerId = holderPeerId;
    this.holderUsername = holderUsername;
    this.myPeerId = myPeerId;
    this.isHost = isHost;

    if (needsRender) {
      // Full re-render if host status changed
      this.render();
      this.setupEventListeners();
    } else {
      // Just update the display
      this.updateDisplay();

      // Update dice count display if host
      if (this.isHost) {
        const countEl = this.querySelector('#dice-count');
        if (countEl) {
          countEl.textContent = this.diceCount;
        }
      }
    }
  }

  // Display a roll from another player
  displayExternalRoll(values) {
    this.currentValues = values;
    const display = this.querySelector('.dice-display');
    const totalEl = this.querySelector('#roll-total');

    if (!display) return;

    display.classList.remove('holding-state');
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
