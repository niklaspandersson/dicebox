/**
 * DiceHistory - Web Component for displaying roll history
 * Shows each dice set with its holder and color
 */
import { getDiceSvg, getPipColor } from "../../../utils/dice-utils.js";
import { escapeHtml } from "../../../utils/html-utils.js";

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
        timestamp: roll.timestamp || Date.now(),
      };
    }

    // Legacy single-set format - convert to new format
    return {
      setResults: [
        {
          setId: "set-1",
          color: "#ffffff",
          values: roll.values || [],
          holderId: roll.peerId,
          holderUsername: roll.username,
        },
      ],
      total: roll.total || (roll.values || []).reduce((a, b) => a + b, 0),
      rollId: roll.rollId,
      timestamp: roll.timestamp || Date.now(),
    };
  }

  renderHistory() {
    const listEl = this.querySelector(".history-list");

    if (this.history.length === 0) {
      listEl.innerHTML =
        '<div class="empty-message">No rolls yet. Be the first to roll!</div>';
      return;
    }

    listEl.innerHTML = this.history
      .map((roll) => this.renderRollEntry(roll))
      .join("");
  }

  renderRollEntry(roll) {
    // Helper to render a single die
    const renderDie = (value, color, pipColor) => {
      return `<span class="history-die-wrapper">
        <span class="history-die" style="background: ${color}">${getDiceSvg(value, pipColor)}</span>
      </span>`;
    };

    // Group set results by holder for cleaner display
    const holderGroups = new Map();

    for (const setResult of roll.setResults) {
      const holderId = setResult.holderId;
      if (!holderGroups.has(holderId)) {
        holderGroups.set(holderId, {
          username: setResult.holderUsername,
          sets: [],
        });
      }
      holderGroups.get(holderId).sets.push(setResult);
    }

    // If single holder, use compact format
    if (holderGroups.size === 1) {
      const [holderId, group] = holderGroups.entries().next().value;
      const isSelf = holderId === this.selfPeerId;

      const diceHtml = roll.setResults
        .map((setResult) => {
          const pipColor = getPipColor(setResult.color);
          return `
          <span class="history-dice-group" style="--group-color: ${setResult.color}">
            ${setResult.values
              .map((v) =>
                renderDie(v, setResult.color, pipColor),
              )
              .join("")}
          </span>
        `;
        })
        .join("");

      return `
        <div class="history-item single-holder">
          <span class="username ${isSelf ? "self" : ""}">${escapeHtml(group.username)}</span>
          <span class="history-dice">${diceHtml}</span>
        </div>
      `;
    }

    // Multiple holders - show each set/holder pair
    const setEntries = roll.setResults
      .map((setResult) => {
        const isSelf = setResult.holderId === this.selfPeerId;
        const pipColor = getPipColor(setResult.color);
        const diceHtml = setResult.values
          .map((v) =>
            renderDie(v, setResult.color, pipColor),
          )
          .join("");

        return `
        <div class="history-set-entry">
          <span class="set-indicator" style="background: ${setResult.color}"></span>
          <span class="username ${isSelf ? "self" : ""}">${escapeHtml(setResult.holderUsername)}</span>
          <span class="history-dice">${diceHtml}</span>
        </div>
      `;
      })
      .join("");

    return `
      <div class="history-item multi-holder">
        ${setEntries}
      </div>
    `;
  }

  clear() {
    this.history = [];
    this.renderHistory();
  }
}

customElements.define("dice-history", DiceHistory);
