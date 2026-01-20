/**
 * DiceHistory - Web Component for displaying roll history
 * Shows each dice set with its holder and color
 */
class DiceHistory extends HTMLElement {
  constructor() {
    super();
    this.history = [];
    this.maxItems = 50;
    this.selfPeerId = null;
  }

  connectedCallback() {
    this.render();
  }

  set peerId(value) {
    this.selfPeerId = value;
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
    this.innerHTML = `
      <div class="card">
        <h3>Roll History</h3>
        <div class="history-list">
          <div class="empty-message">No rolls yet. Be the first to roll!</div>
        </div>
      </div>
    `;
  }

  /**
   * Add a roll to history
   * New format: { setResults: [{ setId, color, values, holderId, holderUsername }], total, rollId, timestamp }
   * Legacy format: { username, peerId, values, total }
   */
  addRoll(roll) {
    // Normalize roll format
    const normalizedRoll = this.normalizeRoll(roll);

    this.history.unshift(normalizedRoll);

    // Keep history limited
    if (this.history.length > this.maxItems) {
      this.history = this.history.slice(0, this.maxItems);
    }

    this.renderHistory();
  }

  normalizeRoll(roll) {
    // New multi-set format
    if (roll.setResults) {
      return {
        setResults: roll.setResults,
        total: roll.total,
        rollId: roll.rollId,
        timestamp: roll.timestamp || Date.now()
      };
    }

    // Legacy single-set format - convert to new format
    return {
      setResults: [{
        setId: 'set-1',
        color: '#6366f1',
        values: roll.values || [],
        holderId: roll.peerId,
        holderUsername: roll.username
      }],
      total: roll.total || (roll.values || []).reduce((a, b) => a + b, 0),
      rollId: roll.rollId,
      timestamp: roll.timestamp || Date.now()
    };
  }

  renderHistory() {
    const listEl = this.querySelector('.history-list');

    if (this.history.length === 0) {
      listEl.innerHTML = '<div class="empty-message">No rolls yet. Be the first to roll!</div>';
      return;
    }

    listEl.innerHTML = this.history.map(roll => this.renderRollEntry(roll)).join('');
  }

  renderRollEntry(roll) {
    // Group set results by holder for cleaner display
    const holderGroups = new Map();

    for (const setResult of roll.setResults) {
      const holderId = setResult.holderId;
      if (!holderGroups.has(holderId)) {
        holderGroups.set(holderId, {
          username: setResult.holderUsername,
          sets: []
        });
      }
      holderGroups.get(holderId).sets.push(setResult);
    }

    // If single holder, use compact format
    if (holderGroups.size === 1) {
      const [holderId, group] = holderGroups.entries().next().value;
      const isSelf = holderId === this.selfPeerId;

      const diceHtml = roll.setResults.map(setResult => `
        <span class="history-dice-group" style="--group-color: ${setResult.color}">
          ${setResult.values.map(v =>
            `<span class="history-die" style="border-color: ${setResult.color}">${this.getDiceSvg(v)}</span>`
          ).join('')}
        </span>
      `).join('');

      return `
        <div class="history-item single-holder">
          <span class="username ${isSelf ? 'self' : ''}">${this.escapeHtml(group.username)}</span>
          <span class="history-dice">${diceHtml}</span>
        </div>
      `;
    }

    // Multiple holders - show each set/holder pair
    const setEntries = roll.setResults.map(setResult => {
      const isSelf = setResult.holderId === this.selfPeerId;
      const diceHtml = setResult.values.map(v =>
        `<span class="history-die" style="border-color: ${setResult.color}">${this.getDiceSvg(v)}</span>`
      ).join('');

      return `
        <div class="history-set-entry">
          <span class="set-indicator" style="background: ${setResult.color}"></span>
          <span class="username ${isSelf ? 'self' : ''}">${this.escapeHtml(setResult.holderUsername)}</span>
          <span class="history-dice">${diceHtml}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="history-item multi-holder">
        ${setEntries}
      </div>
    `;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  clear() {
    this.history = [];
    this.renderHistory();
  }
}

customElements.define('dice-history', DiceHistory);
