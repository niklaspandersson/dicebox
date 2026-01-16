/**
 * DiceHistory - Web Component for displaying roll history
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

  addRoll({ username, peerId, diceType, count, values, total }) {
    const roll = {
      username,
      peerId,
      diceType,
      count,
      values,
      total,
      timestamp: Date.now()
    };

    this.history.unshift(roll);

    // Keep history limited
    if (this.history.length > this.maxItems) {
      this.history = this.history.slice(0, this.maxItems);
    }

    this.renderHistory();
  }

  renderHistory() {
    const listEl = this.querySelector('.history-list');

    if (this.history.length === 0) {
      listEl.innerHTML = '<div class="empty-message">No rolls yet. Be the first to roll!</div>';
      return;
    }

    listEl.innerHTML = this.history.map(roll => {
      const isSelf = roll.peerId === this.selfPeerId;
      const valuesStr = roll.values.join(', ');
      const diceNotation = roll.count > 1 ? `${roll.count}d${roll.diceType}` : `d${roll.diceType}`;

      return `
        <div class="history-item">
          <div>
            <span class="username ${isSelf ? 'self' : ''}">${this.escapeHtml(roll.username)}</span>
            <span class="roll-info">rolled ${diceNotation}</span>
          </div>
          <div class="roll-result">${roll.total}</div>
          ${roll.count > 1 ? `<div class="roll-values">[${valuesStr}]</div>` : ''}
        </div>
      `;
    }).join('');
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
