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
    this.diceSets = [{ id: 'set-1', count: 2, color: '#ffffff' }];

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

  // Get appropriate pip color based on dice background
  getPipColor(diceColor) {
    // White or very light colors get black pips, others get white
    if (diceColor === '#ffffff' || diceColor === '#eab308') {
      return '#0f172a';
    }
    return '#ffffff';
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

    this.innerHTML = `
      <div class="dice-roller-container">
        <div class="dice-sets-area ${allHeld ? 'all-held' : ''}">
          ${this.diceSets.map(set => this.renderDiceSet(set)).join('')}
        </div>
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
    const allHeld = this.allSetsHeld();
    const canRoll = allHeld && this.iAmHoldingAny();

    // Generate a slightly lighter color for the background
    const bgColor = this.hexToRgba(set.color, 0.15);
    const borderColor = isHeld ? set.color : 'transparent';
    const pipColor = this.getPipColor(set.color);

    // When all dice are held, show different UI based on who's holding
    if (allHeld) {
      if (iAmHolder) {
        // I'm holding this set - show "Click to roll"
        return `
          <div class="dice-set card held ready-to-roll my-hold"
               data-set-id="${set.id}"
               style="--set-color: ${set.color}; --set-bg: ${bgColor}; border-color: ${borderColor}">
            <div class="holder-info">
              <span class="holder-name">You</span>
            </div>
            <div class="roll-ready-display">
              <div class="roll-ready-hint">Click to roll</div>
            </div>
          </div>
        `;
      } else {
        // Someone else is holding this set - show "... is about to roll"
        return `
          <div class="dice-set card held ready-to-roll other-hold"
               data-set-id="${set.id}"
               style="--set-color: ${set.color}; --set-bg: ${bgColor}; border-color: ${borderColor}">
            <div class="roll-ready-display">
              <div class="roll-ready-hint waiting">${holder.username} is about to roll</div>
            </div>
          </div>
        `;
      }
    }

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
            values.map(v => `<div class="die">${this.getDiceSvg(v, pipColor)}</div>`).join('') :
            Array(set.count).fill(0).map(() =>
              `<div class="die-placeholder">${this.getDiceSvg(1, pipColor)}</div>`
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
      setEl.addEventListener('click', () => {
        const setId = setEl.dataset.setId;
        this.handleSetClick(setId);
      });
    });
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

    // First, render dice sets with rolling animation (replace roll-ready-display with dice)
    this.diceSets.forEach(set => {
      const setEl = this.querySelector(`.dice-set[data-set-id="${set.id}"]`);
      if (setEl) {
        const pipColor = this.getPipColor(set.color);
        const bgColor = this.hexToRgba(set.color, 0.15);

        // Replace content with rolling dice
        setEl.className = 'dice-set card held rolling-set';
        setEl.style.setProperty('--set-color', set.color);
        setEl.style.setProperty('--set-bg', bgColor);
        setEl.style.borderColor = set.color;
        setEl.innerHTML = `
          <div class="dice-display">
            ${Array(set.count).fill(0).map(() =>
              `<div class="die rolling" data-pip-color="${pipColor}">${this.getDiceSvg(1, pipColor)}</div>`
            ).join('')}
          </div>
        `;
      }
    });

    // Animate for 500ms
    const animate = () => {
      this.querySelectorAll('.die.rolling').forEach(die => {
        const pipColor = die.dataset.pipColor || '#ffffff';
        die.innerHTML = this.getDiceSvg(Math.floor(Math.random() * 6) + 1, pipColor);
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
    this.diceSets.forEach(set => {
      const setEl = this.querySelector(`.dice-set[data-set-id="${set.id}"]`);
      if (setEl) {
        const display = setEl.querySelector('.dice-display');
        if (display) {
          const pipColor = this.getPipColor(set.color);
          const values = rollResults[set.id];
          display.innerHTML = values.map(v =>
            `<div class="die">${this.getDiceSvg(v, pipColor)}</div>`
          ).join('');
        }
      }
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
    const newDiceSets = diceSets || [{ id: 'set-1', count: 2, color: '#ffffff' }];

    // Clear currentValues for sets whose count has changed
    for (const newSet of newDiceSets) {
      const oldSet = this.diceSets.find(s => s.id === newSet.id);
      const oldValues = this.currentValues[newSet.id];
      if (oldValues && (!oldSet || oldSet.count !== newSet.count)) {
        delete this.currentValues[newSet.id];
      }
    }

    this.diceSets = newDiceSets;
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
      if (values.length === 0) return;

      const setEl = this.querySelector(`.dice-set[data-set-id="${set.id}"]`);
      if (setEl) {
        const pipColor = this.getPipColor(set.color);
        const bgColor = this.hexToRgba(set.color, 0.15);

        // Update the set element to show dice results
        setEl.className = 'dice-set card';
        setEl.style.setProperty('--set-color', set.color);
        setEl.style.setProperty('--set-bg', bgColor);
        setEl.style.borderColor = 'transparent';
        setEl.innerHTML = `
          <div class="dice-display">
            ${values.map(v => `<div class="die">${this.getDiceSvg(v, pipColor)}</div>`).join('')}
          </div>
          <div class="grab-hint">Click to grab</div>
        `;
      }
    });
    this.attachEventListeners();
  }
}

customElements.define('dice-roller', DiceRoller);
