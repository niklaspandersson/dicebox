import '../../../../ui/components/dice/Die.js';

/**
 * View component for the "Drag to Select" strategy.
 *
 * Completely different UX from GrabAndRoll:
 * - All dice displayed in a flat pool (not grouped by set)
 * - Drag rectangle to select multiple dice
 * - Click individual dice to toggle selection
 * - Release drag or click "Roll" to roll selected dice
 * - "Roll All" button for convenience
 */
export class DragSelectView extends HTMLElement {
  #strategy = null;
  #unsubscribeState = null;
  #unsubscribeSelection = null;

  // Drag state
  #isDragging = false;
  #dragStart = { x: 0, y: 0 };
  #dragEnd = { x: 0, y: 0 };
  #diceElements = new Map(); // dieId -> element reference

  setStrategy(strategy) {
    this.#strategy = strategy;
  }

  connectedCallback() {
    // Subscribe to state changes
    this.#unsubscribeState = this.#strategy.context.state.subscribe(() =>
      this.render()
    );

    // Subscribe to selection changes
    this.#unsubscribeSelection = this.#strategy.onSelectionChange(() =>
      this.#updateSelectionUI()
    );

    // Pointer events for drag selection
    this.addEventListener('pointerdown', this.#onPointerDown);
    this.addEventListener('pointermove', this.#onPointerMove);
    this.addEventListener('pointerup', this.#onPointerUp);
    this.addEventListener('pointercancel', this.#onPointerUp);

    // Click events
    this.addEventListener('click', this.#onClick);

    this.render();
  }

  disconnectedCallback() {
    this.#unsubscribeState?.();
    this.#unsubscribeSelection?.();
    this.removeEventListener('pointerdown', this.#onPointerDown);
    this.removeEventListener('pointermove', this.#onPointerMove);
    this.removeEventListener('pointerup', this.#onPointerUp);
    this.removeEventListener('pointercancel', this.#onPointerUp);
    this.removeEventListener('click', this.#onClick);
  }

  // ─────────────────────────────────────────────────────────────
  // POINTER EVENTS (Drag Selection)
  // ─────────────────────────────────────────────────────────────

  #onPointerDown = (e) => {
    // Ignore if clicking on a button
    if (e.target.closest('button')) return;

    // Ignore if clicking on a die (handled by click event)
    if (e.target.closest('[data-die-id]')) return;

    this.#isDragging = true;
    this.#dragStart = { x: e.clientX, y: e.clientY };
    this.#dragEnd = { x: e.clientX, y: e.clientY };
    this.setPointerCapture(e.pointerId);

    // Clear previous selection when starting new drag
    this.#strategy.clearSelection();
  };

  #onPointerMove = (e) => {
    if (!this.#isDragging) return;

    this.#dragEnd = { x: e.clientX, y: e.clientY };
    this.#updateDragSelection();
    this.#renderSelectionRect();
  };

  #onPointerUp = (e) => {
    if (!this.#isDragging) return;

    this.#isDragging = false;
    this.releasePointerCapture(e.pointerId);
    this.#hideSelectionRect();

    // If we have a selection and dragged more than a small threshold, roll
    const dragDistance = Math.hypot(
      this.#dragEnd.x - this.#dragStart.x,
      this.#dragEnd.y - this.#dragStart.y
    );

    if (dragDistance > 20 && this.#strategy.getSelection().size > 0) {
      this.#strategy.rollSelection();
    }
  };

  #updateDragSelection() {
    const rect = this.#getSelectionRect();
    const selectedIds = [];

    // Check which dice intersect with selection rectangle
    const dicePool = this.querySelector('.dice-pool');
    if (!dicePool) return;

    const diceWrappers = dicePool.querySelectorAll('[data-die-id]');
    diceWrappers.forEach((wrapper) => {
      const dieRect = wrapper.getBoundingClientRect();
      if (this.#rectsIntersect(rect, dieRect)) {
        selectedIds.push(wrapper.dataset.dieId);
      }
    });

    this.#strategy.updateSelection(selectedIds);
  }

  #getSelectionRect() {
    return {
      left: Math.min(this.#dragStart.x, this.#dragEnd.x),
      top: Math.min(this.#dragStart.y, this.#dragEnd.y),
      right: Math.max(this.#dragStart.x, this.#dragEnd.x),
      bottom: Math.max(this.#dragStart.y, this.#dragEnd.y),
      width: Math.abs(this.#dragEnd.x - this.#dragStart.x),
      height: Math.abs(this.#dragEnd.y - this.#dragStart.y),
    };
  }

  #rectsIntersect(a, b) {
    return !(
      a.right < b.left ||
      a.left > b.right ||
      a.bottom < b.top ||
      a.top > b.bottom
    );
  }

  #renderSelectionRect() {
    let rect = this.querySelector('.selection-rect');
    if (!rect) {
      rect = document.createElement('div');
      rect.className = 'selection-rect';
      this.appendChild(rect);
    }

    const r = this.#getSelectionRect();
    const bounds = this.getBoundingClientRect();

    rect.style.cssText = `
      position: fixed;
      left: ${r.left}px;
      top: ${r.top}px;
      width: ${r.width}px;
      height: ${r.height}px;
      display: block;
      pointer-events: none;
    `;
  }

  #hideSelectionRect() {
    this.querySelector('.selection-rect')?.remove();
  }

  // ─────────────────────────────────────────────────────────────
  // CLICK EVENTS
  // ─────────────────────────────────────────────────────────────

  #onClick = (e) => {
    // Roll selected button
    if (e.target.closest('.roll-selected-btn')) {
      this.#strategy.rollSelection();
      return;
    }

    // Roll all button
    if (e.target.closest('.roll-all-btn')) {
      this.#strategy.rollAll();
      return;
    }

    // Clear selection button
    if (e.target.closest('.clear-selection-btn')) {
      this.#strategy.clearSelection();
      return;
    }

    // Click on die to toggle selection
    const dieWrapper = e.target.closest('[data-die-id]');
    if (dieWrapper) {
      this.#strategy.toggleSelection(dieWrapper.dataset.dieId);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // RENDERING
  // ─────────────────────────────────────────────────────────────

  render() {
    const allDice = this.#strategy.getAllDice();
    const selection = this.#strategy.getSelection();
    const hasSelection = selection.size > 0;

    this.innerHTML = `
      <style>
        .drag-select {
          padding: 16px;
          user-select: none;
        }

        .instructions {
          text-align: center;
          color: #64748b;
          font-size: 14px;
          margin-bottom: 16px;
        }

        .controls {
          display: flex;
          gap: 12px;
          justify-content: center;
          margin-bottom: 20px;
        }

        .controls button {
          padding: 10px 20px;
          border-radius: 8px;
          border: none;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .roll-selected-btn {
          background: #22c55e;
          color: white;
        }

        .roll-selected-btn:hover {
          background: #16a34a;
        }

        .roll-selected-btn:disabled {
          background: #475569;
          cursor: not-allowed;
        }

        .roll-all-btn {
          background: #3b82f6;
          color: white;
        }

        .roll-all-btn:hover {
          background: #2563eb;
        }

        .clear-selection-btn {
          background: #475569;
          color: white;
        }

        .clear-selection-btn:hover {
          background: #64748b;
        }

        .clear-selection-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .dice-pool {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          justify-content: center;
          padding: 20px;
          background: #1e293b;
          border-radius: 12px;
          min-height: 120px;
        }

        .die-wrapper {
          cursor: pointer;
          transition: transform 0.15s ease;
          border-radius: 10px;
          padding: 4px;
        }

        .die-wrapper:hover {
          transform: scale(1.1);
          background: rgba(59, 130, 246, 0.2);
        }

        .die-wrapper--selected {
          background: rgba(59, 130, 246, 0.3);
          box-shadow: 0 0 0 2px #3b82f6;
        }

        .selection-rect {
          border: 2px dashed #3b82f6;
          background: rgba(59, 130, 246, 0.1);
          border-radius: 4px;
          z-index: 1000;
        }

        .selection-count {
          text-align: center;
          color: #94a3b8;
          font-size: 13px;
          margin-top: 12px;
        }

        .set-labels {
          display: flex;
          gap: 16px;
          justify-content: center;
          margin-top: 16px;
        }

        .set-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: #94a3b8;
        }

        .set-label__color {
          width: 12px;
          height: 12px;
          border-radius: 3px;
        }
      </style>

      <div class="drag-select">
        <div class="instructions">
          Click dice to select, or drag to select multiple. Then click "Roll Selected".
        </div>

        <div class="controls">
          <button class="roll-selected-btn" ${!hasSelection ? 'disabled' : ''}>
            Roll Selected (${selection.size})
          </button>
          <button class="roll-all-btn">Roll All</button>
          <button class="clear-selection-btn" ${!hasSelection ? 'disabled' : ''}>
            Clear
          </button>
        </div>

        <div class="dice-pool">
          ${allDice.map((die) => this.#renderDie(die, selection.has(die.id))).join('')}
        </div>

        <div class="selection-count">
          ${hasSelection ? `${selection.size} dice selected` : 'No dice selected'}
        </div>

        <div class="set-labels">
          ${this.#renderSetLabels()}
        </div>
      </div>
    `;
  }

  #renderDie(die, isSelected) {
    return `
      <div class="die-wrapper ${isSelected ? 'die-wrapper--selected' : ''}"
           data-die-id="${die.id}">
        <dice-die
          value="${die.value || ''}"
          color="${die.color}"
          ${isSelected ? 'selected' : ''}
        ></dice-die>
      </div>
    `;
  }

  #renderSetLabels() {
    const { state } = this.#strategy.context;
    return state.diceConfig.diceSets
      .map(
        (set) => `
      <div class="set-label">
        <div class="set-label__color" style="background: ${set.color}"></div>
        <span>${set.id}</span>
      </div>
    `
      )
      .join('');
  }

  #updateSelectionUI() {
    const selection = this.#strategy.getSelection();

    // Update die wrapper classes
    this.querySelectorAll('[data-die-id]').forEach((wrapper) => {
      const isSelected = selection.has(wrapper.dataset.dieId);
      wrapper.classList.toggle('die-wrapper--selected', isSelected);

      // Update the dice-die element's selected attribute
      const dieEl = wrapper.querySelector('dice-die');
      if (dieEl) {
        if (isSelected) {
          dieEl.setAttribute('selected', '');
        } else {
          dieEl.removeAttribute('selected');
        }
      }
    });

    // Update buttons
    const rollSelectedBtn = this.querySelector('.roll-selected-btn');
    const clearBtn = this.querySelector('.clear-selection-btn');
    const countEl = this.querySelector('.selection-count');

    if (rollSelectedBtn) {
      rollSelectedBtn.disabled = selection.size === 0;
      rollSelectedBtn.textContent = `Roll Selected (${selection.size})`;
    }

    if (clearBtn) {
      clearBtn.disabled = selection.size === 0;
    }

    if (countEl) {
      countEl.textContent =
        selection.size > 0
          ? `${selection.size} dice selected`
          : 'No dice selected';
    }
  }
}

// Register the component
if (!customElements.get('dice-drag-select')) {
  customElements.define('dice-drag-select', DragSelectView);
}
