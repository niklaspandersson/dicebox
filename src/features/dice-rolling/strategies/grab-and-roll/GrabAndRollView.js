import '../../../../ui/components/dice/Die.js';

/**
 * View component for the "Grab and Roll" strategy.
 *
 * Uses a click-based interaction model:
 * - Click unheld set to grab it
 * - Click held set to drop (or roll if all held)
 * - Click individual die to toggle lock (when allowed)
 */
export class GrabAndRollView extends HTMLElement {
  #strategy = null;
  #unsubscribe = null;

  setStrategy(strategy) {
    this.#strategy = strategy;
  }

  connectedCallback() {
    // Subscribe to state changes
    this.#unsubscribe = this.#strategy.context.state.subscribe(() =>
      this.render()
    );

    // Event delegation for clicks
    this.addEventListener('click', this.#handleClick);

    this.render();
  }

  disconnectedCallback() {
    this.#unsubscribe?.();
    this.removeEventListener('click', this.#handleClick);
  }

  #handleClick = (e) => {
    // Handle die lock click
    const dieEl = e.target.closest('[data-die-index]');
    if (dieEl) {
      const setId = dieEl.dataset.setId;
      const dieIndex = parseInt(dieEl.dataset.dieIndex);
      this.#strategy.handleDieLockClick(setId, dieIndex);
      return;
    }

    // Handle set click (grab/drop/roll)
    const setEl = e.target.closest('[data-set-id]');
    if (setEl) {
      this.#strategy.handleSetClick(setEl.dataset.setId);
    }
  };

  render() {
    const { state, localPlayer } = this.#strategy.context;
    const canRoll = this.#strategy.canRoll();
    const diceSets = state.diceConfig.diceSets || [];

    this.innerHTML = `
      <style>
        .grab-and-roll {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 16px;
        }

        .dice-sets {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
          justify-content: center;
        }

        .dice-set {
          background: #1e293b;
          border-radius: 12px;
          padding: 16px;
          min-width: 180px;
          cursor: pointer;
          transition: all 0.2s ease;
          border: 2px solid transparent;
        }

        .dice-set:hover {
          background: #334155;
        }

        .dice-set--held {
          border-color: var(--set-color, #3b82f6);
        }

        .dice-set--held-by-me {
          background: #1e3a5f;
        }

        .dice-set--ready-to-roll {
          border-color: #22c55e;
          animation: pulse 1.5s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
          50% { box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); }
        }

        .dice-set__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .dice-set__holder {
          font-size: 14px;
          color: #94a3b8;
        }

        .dice-set__holder--me {
          color: #60a5fa;
          font-weight: 500;
        }

        .dice-set__dice {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: center;
        }

        .dice-set__die-wrapper {
          cursor: pointer;
          transition: transform 0.15s ease;
        }

        .dice-set__die-wrapper--can-lock:hover {
          transform: scale(1.1);
        }

        .dice-set__roll-hint {
          margin-top: 12px;
          text-align: center;
          color: #22c55e;
          font-size: 14px;
          font-weight: 500;
        }

        .dice-set__grab-hint {
          margin-top: 12px;
          text-align: center;
          color: #64748b;
          font-size: 13px;
        }
      </style>

      <div class="grab-and-roll">
        <div class="dice-sets">
          ${diceSets.map((set) => this.#renderSet(set, canRoll)).join('')}
        </div>
      </div>
    `;
  }

  #renderSet(set, canRoll) {
    const { state, localPlayer } = this.#strategy.context;
    const holder = state.holders.get(set.id);
    const values = state.diceValues.get(set.id) || [];
    const lockedIndices = state.lockedDice.get(set.id) || new Set();

    const isHeld = !!holder;
    const isHeldByMe = holder?.playerId === localPlayer.id;
    const isReadyToRoll = canRoll && isHeldByMe;
    const canLock = this.#strategy.canLock(set.id);

    const holderText = holder
      ? isHeldByMe
        ? 'You'
        : holder.username
      : 'Available';

    const classes = [
      'dice-set',
      isHeld ? 'dice-set--held' : '',
      isHeldByMe ? 'dice-set--held-by-me' : '',
      isReadyToRoll ? 'dice-set--ready-to-roll' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return `
      <div class="${classes}"
           data-set-id="${set.id}"
           style="--set-color: ${set.color}">
        <div class="dice-set__header">
          <span class="dice-set__holder ${isHeldByMe ? 'dice-set__holder--me' : ''}">
            ${holderText}
          </span>
        </div>
        <div class="dice-set__dice">
          ${Array.from({ length: set.count }, (_, i) =>
            this.#renderDie(set, i, values[i], lockedIndices.has(i), canLock)
          ).join('')}
        </div>
        ${isReadyToRoll ? '<div class="dice-set__roll-hint">Click to roll!</div>' : ''}
        ${!isHeld ? '<div class="dice-set__grab-hint">Click to grab</div>' : ''}
      </div>
    `;
  }

  #renderDie(set, index, value, isLocked, canLock) {
    const wrapperClass = [
      'dice-set__die-wrapper',
      canLock ? 'dice-set__die-wrapper--can-lock' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return `
      <div class="${wrapperClass}"
           data-set-id="${set.id}"
           data-die-index="${index}">
        <dice-die
          value="${value || ''}"
          color="${set.color}"
          ${isLocked ? 'locked' : ''}
        ></dice-die>
      </div>
    `;
  }
}

// Register the component
if (!customElements.get('dice-grab-and-roll')) {
  customElements.define('dice-grab-and-roll', GrabAndRollView);
}
