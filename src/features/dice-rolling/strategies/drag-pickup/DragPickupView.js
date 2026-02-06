import "../../../../ui/components/dice/Die.js";

/**
 * View component for the "Drag to Pick Up" strategy.
 *
 * Interaction model:
 * - Drag finger/mouse across dice to pick them up
 * - Picked dice are visually lifted
 * - Release inside the area to roll picked dice
 * - Drag outside the area and release to cancel
 */
export class DragPickupView extends HTMLElement {
  #strategy = null;
  #unsubscribe = null;

  // Interaction state
  #isDragging = false;
  #isRolling = false;
  #pickedUpDice = new Set(); // Global indices of picked dice
  #isCancelled = false;

  // Store random transforms for visual variety
  #diceTransforms = [];

  setStrategy(strategy) {
    this.#strategy = strategy;
  }

  connectedCallback() {
    this.#unsubscribe = this.#strategy.context.state.subscribe(() => {
      if (!this.#isRolling && !this.#isDragging) {
        this.#render();
      }
    });

    this.#setupEventListeners();
    this.#render();
  }

  disconnectedCallback() {
    this.#unsubscribe?.();
    this.#removeEventListeners();
  }

  // ─────────────────────────────────────────────────────────────
  // EVENT HANDLING
  // ─────────────────────────────────────────────────────────────

  #setupEventListeners() {
    // Touch events
    this.addEventListener("touchstart", this.#handleDragStart, {
      passive: false,
    });
    document.addEventListener("touchmove", this.#handleDragMove, {
      passive: false,
    });
    document.addEventListener("touchend", this.#handleDragEnd);
    document.addEventListener("touchcancel", this.#handleDragEnd);

    // Mouse events (for desktop)
    this.addEventListener("mousedown", this.#handleDragStart);
    document.addEventListener("mousemove", this.#handleDragMove);
    document.addEventListener("mouseup", this.#handleDragEnd);
  }

  #removeEventListeners() {
    this.removeEventListener("touchstart", this.#handleDragStart);
    document.removeEventListener("touchmove", this.#handleDragMove);
    document.removeEventListener("touchend", this.#handleDragEnd);
    document.removeEventListener("touchcancel", this.#handleDragEnd);

    this.removeEventListener("mousedown", this.#handleDragStart);
    document.removeEventListener("mousemove", this.#handleDragMove);
    document.removeEventListener("mouseup", this.#handleDragEnd);
  }

  #getPointFromEvent(e) {
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  }

  #getDieAtPoint(x, y) {
    const elements = document.elementsFromPoint(x, y);
    for (const el of elements) {
      const wrapper = el.closest(".die-wrapper");
      if (wrapper && this.contains(wrapper)) {
        return parseInt(wrapper.dataset.dieIndex, 10);
      }
    }
    return null;
  }

  #isPointInDiceArea(x, y) {
    const diceArea = this.querySelector(".drag-pickup-container");
    if (!diceArea) return false;
    const rect = diceArea.getBoundingClientRect();
    return (
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    );
  }

  #handleDragStart = (e) => {
    if (this.#isRolling) return;

    const point = this.#getPointFromEvent(e);
    if (!this.#isPointInDiceArea(point.x, point.y)) return;

    this.#isDragging = true;
    this.#pickedUpDice.clear();
    this.#isCancelled = false;

    // Check if we started on a die
    const dieIndex = this.#getDieAtPoint(point.x, point.y);
    if (dieIndex !== null) {
      this.#pickedUpDice.add(dieIndex);
    }

    this.#updateDragState();
    e.preventDefault();
  };

  #handleDragMove = (e) => {
    if (!this.#isDragging || this.#isRolling) return;

    const point = this.#getPointFromEvent(e);

    // Check if dragged outside
    if (!this.#isPointInDiceArea(point.x, point.y)) {
      this.#isCancelled = true;
      this.#updateDragState();
      return;
    }

    // Inside - remove cancelled state
    this.#isCancelled = false;

    // Check if touching a die
    const dieIndex = this.#getDieAtPoint(point.x, point.y);
    if (dieIndex !== null && !this.#pickedUpDice.has(dieIndex)) {
      this.#pickedUpDice.add(dieIndex);
    }

    this.#updateDragState();
    e.preventDefault();
  };

  #handleDragEnd = (e) => {
    if (!this.#isDragging || this.#isRolling) return;

    const point = this.#getPointFromEvent(
      e.changedTouches ? e.changedTouches[0] : e,
    );
    const wasCancelled = !this.#isPointInDiceArea(point.x, point.y);

    this.#isDragging = false;

    if (wasCancelled || this.#pickedUpDice.size === 0) {
      // Cancel - clear state
      this.#pickedUpDice.clear();
      this.#isCancelled = false;
      this.#render();
      return;
    }

    // Roll the picked dice
    this.#rollPickedDice();
  };

  #updateDragState() {
    const container = this.querySelector(".drag-pickup-container");
    const hint = this.querySelector(".hint");

    if (container) {
      container.classList.toggle(
        "dragging",
        this.#isDragging && !this.#isCancelled,
      );
      container.classList.toggle("cancelled", this.#isCancelled);
    }

    if (hint) {
      if (this.#isCancelled) {
        hint.textContent = "Release to cancel";
        hint.className = "hint cancelled";
      } else if (this.#pickedUpDice.size > 0) {
        hint.textContent = `${this.#pickedUpDice.size} dice picked up - release to roll`;
        hint.className = "hint active";
      } else if (this.#isDragging) {
        hint.textContent = "Drag across dice...";
        hint.className = "hint active";
      }
    }

    // Update dice visual states
    this.#updateDiceClasses();
  }

  #updateDiceClasses() {
    const wrappers = this.querySelectorAll(".die-wrapper");
    const hasPickedUp = this.#pickedUpDice.size > 0;

    wrappers.forEach((wrapper, index) => {
      const dieEl = wrapper.querySelector("dice-die");
      if (!dieEl) return;

      const isPickedUp = this.#pickedUpDice.has(index);
      dieEl.classList.toggle("picked-up", isPickedUp);
      dieEl.classList.toggle("not-picked", hasPickedUp && !isPickedUp);

      // Clear inline transform when picked up so CSS class transform applies;
      // restore it when not picked up
      if (isPickedUp) {
        dieEl.style.transform = "";
      } else if (this.#diceTransforms[index]) {
        dieEl.style.transform = this.#diceTransforms[index];
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  // ROLLING
  // ─────────────────────────────────────────────────────────────

  async #rollPickedDice() {
    if (this.#isRolling || this.#pickedUpDice.size === 0) return;

    this.#isRolling = true;
    const diceToRoll = new Set(this.#pickedUpDice);
    const allDice = this.#strategy.getAllDice();

    // Show rolling animation
    this.#showRollingAnimation(diceToRoll);

    // Animate random values
    const animateInterval = setInterval(() => {
      this.querySelectorAll("dice-die.rolling").forEach((die) => {
        die.setAttribute("value", Math.floor(Math.random() * 6) + 1);
      });
    }, 80);

    await new Promise((r) => setTimeout(r, 500));
    clearInterval(animateInterval);

    // Actually roll the dice
    await this.#strategy.rollPickedDice(diceToRoll);

    // Generate new transforms for rolled dice
    for (const index of diceToRoll) {
      this.#diceTransforms[index] = this.#getRandomTransform();
    }

    // Clear state and re-render
    this.#pickedUpDice.clear();
    this.#isRolling = false;
    this.#render();
  }

  #showRollingAnimation(diceToRoll) {
    const wrappers = this.querySelectorAll(".die-wrapper");
    const allDice = this.#strategy.getAllDice();

    wrappers.forEach((wrapper, index) => {
      const dieEl = wrapper.querySelector("dice-die");
      if (!dieEl) return;

      if (diceToRoll.has(index)) {
        const die = allDice[index];
        dieEl.setAttribute("rolling", "");
        dieEl.classList.add("rolling");
        dieEl.classList.remove("picked-up", "not-picked", "placeholder");
      } else {
        dieEl.classList.remove("picked-up", "not-picked");
      }
    });

    const hint = this.querySelector(".hint");
    if (hint) {
      hint.textContent = "Rolling...";
      hint.className = "hint active";
    }
  }

  #getRandomTransform() {
    const rotation = Math.floor(Math.random() * 31) - 15;
    const offsetX = Math.floor(Math.random() * 11) - 5;
    const offsetY = Math.floor(Math.random() * 11) - 5;
    return `rotate(${rotation}deg) translate(${offsetX}px, ${offsetY}px)`;
  }

  // ─────────────────────────────────────────────────────────────
  // RENDERING
  // ─────────────────────────────────────────────────────────────

  #render() {
    const allDice = this.#strategy.getAllDice();
    const hasPickedUp = this.#pickedUpDice.size > 0;
    const hasValues = allDice.some((d) => d.value !== null);

    // Ensure transforms array is sized correctly
    while (this.#diceTransforms.length < allDice.length) {
      this.#diceTransforms.push("");
    }

    const diceHtml = allDice
      .map((die, index) => {
        const isPickedUp = this.#pickedUpDice.has(index);
        const transform = isPickedUp ? "" : this.#diceTransforms[index] || "";

        if (die.value === null) {
          // Placeholder state
          const classes = ["placeholder"];
          if (isPickedUp) classes.push("picked-up");
          else if (hasPickedUp) classes.push("not-picked");

          return `
            <div class="die-wrapper" data-die-index="${index}">
              <dice-die class="${classes.join(" ")}" color="${die.color}" value="1"></dice-die>
            </div>
          `;
        }

        // Show actual value
        const classes = [];
        if (isPickedUp) classes.push("picked-up");
        else if (hasPickedUp) classes.push("not-picked");

        const styleAttr = transform ? `style="transform: ${transform}"` : "";
        return `
          <div class="die-wrapper" data-die-index="${index}">
            <dice-die class="${classes.join(" ")}" color="${die.color}" value="${die.value}" ${styleAttr}></dice-die>
          </div>
        `;
      })
      .join("");

    this.innerHTML = `
      <div class="drag-pickup-container">
        <div class="dice-display">
          ${diceHtml}
        </div>
        <div class="hint">Drag across dice to pick up</div>
      </div>
    `;
  }
}

// Register the custom element
customElements.define("dice-drag-pickup", DragPickupView);
