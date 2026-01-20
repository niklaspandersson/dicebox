/**
 * DiceRoller - Displays multiple dice sets with per-set grab/roll interaction
 *
 * Each dice set is displayed in its own area with its color
 * Click a set to grab it -> When all sets are held, any holder can roll
 */
class DiceRoller extends HTMLElement {
  constructor() {
    super();
    // Dice configuration: array of { id, count, color }
    this.diceSets = [{ id: 'set-1', count: 2, color: '#6366f1' }];

    // Current values per set: { setId: [values] }
    this.currentValues = {};

    // Rolling state
    this.isRolling = false;

    // Holder per set: { setId: { peerId, username } }
    this.holders = new Map();

    this.myPeerId = null;
    this.isHost = false;
  }

  connectedCallback() {
    this.render();
    this._keyHandler = (e) => {
      if (e.key === 'r' && !e.target.matches('input')) {
        this.handleRollKey();
      }
    };
    document.addEventListener('keypress', this._keyHandler);
  }

  disconnectedCallback() {
    if (this._keyHandler) {
      document.removeEventListener('keypress', this._keyHandler);
    }
  }

  getDiceSvg(value, pipColor = '#0f172a') {
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
    const allHeld = this.allSetsHeld();
    const canRoll = allHeld && this.iAmHoldingAny();
    const canDrop = this.isHost && this.holders.size > 0;

    this.innerHTML = `
      <div class="dice-roller-container">
        <div class="dice-sets-area ${allHeld ? 'all-held' : ''}">
          ${this.diceSets.map(set => this.renderDiceSet(set)).join('')}
        </div>
        ${allHeld ? `
          <div class="roll-prompt">
            ${canRoll ? '<div class="roll-hint">All dice held! Click to roll or press R</div>' :
                       '<div class="roll-hint waiting">Waiting for roll...</div>'}
          </div>
        ` : ''}
        ${canDrop ? '<button class="drop-all-btn">Drop All</button>' : ''}
      </div>
    `;

    this.attachEventListeners();
  }

  renderDiceSet(set) {
    const holder = this.holders.get(set.id);
    const isHeld = holder !== undefined;
    const iAmHolder = isHeld && holder.peerId === this.myPeerId;
    const values = this.currentValues[set.id] || [];
    const hasValues = values.length > 0;

    // Generate a slightly lighter color for the background
    const bgColor = this.hexToRgba(set.color, 0.15);
    const borderColor = isHeld ? set.color : 'transparent';

    return `
      <div class="dice-set card ${isHeld ? 'held' : ''} ${iAmHolder ? 'my-hold' : ''}"
           data-set-id="${set.id}"
           style="--set-color: ${set.color}; --set-bg: ${bgColor}; border-color: ${borderColor}">
        ${isHeld ? `
          <div class="holder-info">
            <span class="holder-name">${iAmHolder ? 'You' : holder.username}</span>
          </div>
        ` : ''}
        <div class="dice-display">
          ${hasValues && !isHeld ?
            values.map(v => `<div class="die">${this.getDiceSvg(v)}</div>`).join('') :
            Array(set.count).fill(0).map(() =>
              `<div class="die-placeholder">${this.getDiceSvg(1)}</div>`
            ).join('')
          }
        </div>
        ${!isHeld ? '<div class="grab-hint">Click to grab</div>' : ''}
      </div>
    `;
  }

  hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  attachEventListeners() {
    // Handle dice set clicks
    this.querySelectorAll('.dice-set').forEach(setEl => {
      setEl.addEventListener('click', (e) => {
        if (e.target.closest('.drop-all-btn')) return;
        const setId = setEl.dataset.setId;
        this.handleSetClick(setId);
      });
    });

    // Handle drop all button
    this.querySelector('.drop-all-btn')?.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('dice-dropped', { bubbles: true }));
    });

    // Handle roll area click when all sets held
    if (this.allSetsHeld() && this.iAmHoldingAny()) {
      this.querySelector('.dice-sets-area')?.addEventListener('click', (e) => {
        if (!e.target.closest('.dice-set')) {
          this.roll();
        }
      });
    }
  }

  handleSetClick(setId) {
    if (this.isRolling) return;

    const holder = this.holders.get(setId);
    const isHeld = holder !== undefined;

    if (!isHeld) {
      // Set not held - grab it
      this.dispatchEvent(new CustomEvent('dice-grabbed', {
        bubbles: true,
        detail: { setId }
      }));
    } else if (this.allSetsHeld() && this.iAmHoldingAny()) {
      // All sets held and I'm holding at least one - roll
      this.roll();
    }
  }

  handleRollKey() {
    if (this.isRolling) return;
    if (this.allSetsHeld() && this.iAmHoldingAny()) {
      this.roll();
    }
  }

  allSetsHeld() {
    return this.diceSets.every(set => this.holders.has(set.id));
  }

  iAmHoldingAny() {
    for (const [setId, holder] of this.holders) {
      if (holder.peerId === this.myPeerId) return true;
    }
    return false;
  }

  async roll() {
    if (this.isRolling) return;
    this.isRolling = true;

    // Animate all dice sets
    const displays = this.querySelectorAll('.dice-display');
    displays.forEach((display, index) => {
      const set = this.diceSets[index];
      display.innerHTML = Array(set.count).fill(0).map(() =>
        `<div class="die rolling">${this.getDiceSvg(1)}</div>`
      ).join('');
    });

    // Animate for 500ms
    const animate = () => {
      this.querySelectorAll('.die.rolling').forEach(die => {
        const color = die.style.getPropertyValue('--die-color');
        die.innerHTML = this.getDiceSvg(Math.floor(Math.random() * 6) + 1);
      });
    };
    const interval = setInterval(animate, 80);
    await new Promise(r => setTimeout(r, 500));
    clearInterval(interval);

    // Generate final values for each set
    const rollResults = {};
    let totalSum = 0;

    this.diceSets.forEach(set => {
      const values = Array(set.count).fill(0).map(() =>
        Math.floor(Math.random() * 6) + 1
      );
      rollResults[set.id] = values;
      this.currentValues[set.id] = values;
      totalSum += values.reduce((a, b) => a + b, 0);
    });

    // Show results
    displays.forEach((display, index) => {
      const set = this.diceSets[index];
      const values = rollResults[set.id];
      display.innerHTML = values.map(v =>
        `<div class="die">${this.getDiceSvg(v)}</div>`
      ).join('');
    });

    this.isRolling = false;

    // Emit roll event with per-set results
    this.dispatchEvent(new CustomEvent('dice-rolled', {
      bubbles: true,
      detail: {
        diceType: 6,
        rollResults,  // { setId: [values] }
        total: totalSum,
        holders: Array.from(this.holders.entries()) // Who held what
      }
    }));
  }

  // External API
  setConfig({ diceSets, holders, myPeerId, isHost }) {
    this.diceSets = diceSets || [{ id: 'set-1', count: 2, color: '#6366f1' }];
    this.myPeerId = myPeerId;
    this.isHost = isHost;

    // Convert holders array back to Map
    this.holders.clear();
    if (holders) {
      for (const [setId, holder] of holders) {
        this.holders.set(setId, holder);
      }
    }

    this.render();
  }

  showRoll(rollResults) {
    // rollResults: { setId: [values] }
    this.currentValues = rollResults;
    this.diceSets.forEach(set => {
      const values = rollResults[set.id] || [];
      const setEl = this.querySelector(`.dice-set[data-set-id="${set.id}"]`);
      if (setEl) {
        const display = setEl.querySelector('.dice-display');
        if (display && values.length > 0) {
          display.innerHTML = values.map(v =>
            `<div class="die">${this.getDiceSvg(v)}</div>`
          ).join('');
        }
      }
    });
  }
}

customElements.define('dice-roller', DiceRoller);
