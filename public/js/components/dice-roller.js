/**
 * DiceRoller - Displays multiple dice sets with per-set grab/roll interaction
 *
 * Each dice set is displayed in its own area with its color
 * Click a set to grab it -> When all sets are held, any holder can roll
 */
import { getDiceSvg, getPipColor, hexToRgba } from "../utils/dice-utils.js";

class DiceRoller extends HTMLElement {
  constructor() {
    super();
    // Dice configuration: array of { id, count, color }
    this.diceSets = [{ id: "set-1", count: 2, color: "#ffffff" }];

    // Current values per set: { setId: [values] }
    this.currentValues = {};

    // Rolling state
    this.isRolling = false;

    // Holder per set: { setId: { peerId, username } }
    this.holders = new Map();

    this.myPeerId = null;

    // Dice locking
    this.allowLocking = false;
    this.lockedDice = new Map(); // setId -> Map<dieIndex, value>
    this.holderHasRolled = new Map(); // setId -> boolean
    this.lastRoller = new Map(); // setId -> { peerId, username }
  }

  connectedCallback() {
    this.render();
    this._keyHandler = (e) => {
      if (e.key === "r" && !e.target.matches("input")) {
        this.handleRollKey();
      }
    };
    document.addEventListener("keypress", this._keyHandler);
  }

  disconnectedCallback() {
    if (this._keyHandler) {
      document.removeEventListener("keypress", this._keyHandler);
    }
  }

  // Generate random rotation and position offset for a natural dice appearance
  getRandomDiceTransform() {
    const rotation = Math.floor(Math.random() * 31) - 15; // -15 to 15 degrees
    const offsetX = Math.floor(Math.random() * 11) - 5; // -5 to 5 px
    const offsetY = Math.floor(Math.random() * 11) - 5; // -5 to 5 px
    return `transform: rotate(${rotation}deg) translate(${offsetX}px, ${offsetY}px);`;
  }

  render() {
    const allHeld = this.allSetsHeld();

    this.innerHTML = `
      <div class="dice-roller-container">
        <div class="dice-sets-area ${allHeld ? "all-held" : ""}">
          ${this.diceSets.map((set) => this.renderDiceSet(set)).join("")}
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

    // Locking state - check if I'm the last roller (can lock even when not held)
    const lockedMap = this.lockedDice.get(set.id) || new Map();
    const hasLocked = lockedMap.size > 0;
    const holderRolled = this.holderHasRolled.get(set.id) || false;
    const lastRoller = this.lastRoller.get(set.id);
    const iAmLastRoller = lastRoller && lastRoller.peerId === this.myPeerId;
    // Can lock if: (I'm holder and have rolled) OR (dice not held and I'm last roller)
    const canLock =
      this.allowLocking &&
      ((iAmHolder && holderRolled) || (!isHeld && iAmLastRoller && hasValues));

    // Generate a slightly lighter color for the background
    const bgColor = hexToRgba(set.color, 0.15);
    const borderColor = isHeld ? set.color : "transparent";
    const pipColor = getPipColor(set.color);

    // When all dice are held, show dice with lock state and ready-to-roll overlay
    if (allHeld) {
      const hintText = iAmHolder
        ? "Click to roll"
        : `${holder.username} is about to roll`;
      const hintClass = iAmHolder ? "" : "waiting";
      const lockedCount = lockedMap.size;

      return `
        <div class="dice-set card held ready-to-roll ${iAmHolder ? "my-hold" : "other-hold"} ${hasLocked ? "has-locked" : ""}"
             data-set-id="${set.id}"
             style="--set-color: ${set.color}; --set-bg: ${bgColor}; border-color: ${borderColor}">
          ${
            iAmHolder
              ? `
            <div class="holder-info">
              <span class="holder-name">You</span>
              ${hasLocked ? `<span class="locked-count">${lockedCount} locked</span>` : ""}
            </div>
          `
              : ""
          }
          <div class="dice-display-container">
            <div class="dice-display">
              ${Array(set.count)
                .fill(0)
                .map((_, i) => {
                  const isLocked = lockedMap.has(i);
                  const val = isLocked ? lockedMap.get(i) : values[i] || 1;
                  return `<div class="die-wrapper">
                  <div class="die-placeholder ${isLocked ? "locked" : ""}" data-die-index="${i}">${getDiceSvg(val, pipColor)}</div>
                  ${isLocked ? '<div class="lock-indicator">🔒</div>' : ""}
                </div>`;
                })
                .join("")}
            </div>
            <div class="roll-ready-overlay">
              <div class="roll-ready-hint ${hintClass}">${hintText}</div>
            </div>
          </div>
        </div>
      `;
    }

    // Not all held - show normal dice display
    const renderDice = () => {
      if (hasValues && canLock) {
        // Show lockable dice (holder who has rolled, OR last roller with dice not held)
        return values
          .map((v, i) => {
            const isLocked = lockedMap.has(i);
            return `<div class="die-wrapper">
            <div class="die lockable ${isLocked ? "locked" : ""}"
                 data-die-index="${i}"
                 style="${this.getRandomDiceTransform()}">${getDiceSvg(v, pipColor)}</div>
            ${isLocked ? '<div class="lock-indicator">🔒</div>' : ""}
          </div>`;
          })
          .join("");
      } else if (hasValues && iAmHolder) {
        // Holder but hasn't rolled yet - show dice without lock ability
        return values
          .map((v, i) => {
            const isLocked = lockedMap.has(i);
            return `<div class="die-wrapper">
            <div class="die ${isLocked ? "locked" : ""}"
                 data-die-index="${i}"
                 style="${this.getRandomDiceTransform()}">${getDiceSvg(isLocked ? lockedMap.get(i) : v, pipColor)}</div>
            ${isLocked ? '<div class="lock-indicator">🔒</div>' : ""}
          </div>`;
          })
          .join("");
      } else if (hasValues && !isHeld) {
        // Not held and not last roller - show last values (not lockable)
        return values
          .map((v, i) => {
            const isLocked = lockedMap.has(i);
            return `<div class="die-wrapper">
            <div class="die ${isLocked ? "locked" : ""}" style="${this.getRandomDiceTransform()}">${getDiceSvg(v, pipColor)}</div>
            ${isLocked ? '<div class="lock-indicator">🔒</div>' : ""}
          </div>`;
          })
          .join("");
      } else {
        // Placeholder dice
        return Array(set.count)
          .fill(0)
          .map((_, i) => {
            const isLocked = lockedMap.has(i);
            const val = isLocked ? lockedMap.get(i) : 1;
            return `<div class="die-wrapper">
            <div class="die-placeholder ${isLocked ? "locked" : ""}">${getDiceSvg(val, pipColor)}</div>
            ${isLocked ? '<div class="lock-indicator">🔒</div>' : ""}
          </div>`;
          })
          .join("");
      }
    };

    // Determine hints to show
    let grabHint = "";
    let lockHint = "";
    if (!isHeld) {
      if (canLock) {
        lockHint =
          '<div class="lock-hint">Tap dice to lock/unlock, tap outside to grab</div>';
      } else {
        grabHint = '<div class="hint">Click to grab</div>';
      }
    } else if (canLock) {
      lockHint = '<div class="hint">Click dice to lock/unlock</div>';
    }

    return `
      <div class="dice-set card ${isHeld ? "held" : ""} ${iAmHolder ? "my-hold" : ""} ${hasLocked ? "has-locked" : ""} ${canLock && !isHeld ? "last-roller" : ""}"
           data-set-id="${set.id}"
           style="--set-color: ${set.color}; --set-bg: ${bgColor}; border-color: ${borderColor}">
        ${
          isHeld
            ? `
          <div class="holder-info">
            <span class="holder-name">${iAmHolder ? "You" : holder.username}</span>
            ${hasLocked ? `<span class="locked-count">${lockedMap.size} locked</span>` : ""}
          </div>
        `
            : ""
        }
        <div class="dice-display">
          ${renderDice()}
        </div>
        ${grabHint}
        ${lockHint}
      </div>
    `;
  }

  attachEventListeners() {
    // Handle individual die clicks for locking
    this.querySelectorAll(".die.lockable").forEach((dieEl) => {
      dieEl.addEventListener("click", (e) => {
        e.stopPropagation();
        const setEl = dieEl.closest(".dice-set");
        const setId = setEl.dataset.setId;
        const dieIndex = parseInt(dieEl.dataset.dieIndex, 10);
        this.handleDieLockClick(setId, dieIndex);
      });
    });

    // Handle dice set clicks
    this.querySelectorAll(".dice-set").forEach((setEl) => {
      setEl.addEventListener("click", (e) => {
        // Don't trigger set click if clicking on a lockable die
        if (e.target.closest(".die.lockable")) return;
        const setId = setEl.dataset.setId;
        this.handleSetClick(setId);
      });
    });
  }

  handleDieLockClick(setId, dieIndex) {
    if (this.isRolling) return;

    const holder = this.holders.get(setId);
    const isHeld = holder !== undefined;
    const iAmHolder = isHeld && holder.peerId === this.myPeerId;
    const holderRolled = this.holderHasRolled.get(setId) || false;
    const lastRoller = this.lastRoller.get(setId);
    const iAmLastRoller = lastRoller && lastRoller.peerId === this.myPeerId;
    const values = this.currentValues[setId] || [];
    const hasValues = values.length > 0;

    // Can lock if: (I'm holder and have rolled) OR (dice not held and I'm last roller)
    const canLock =
      this.allowLocking &&
      ((iAmHolder && holderRolled) || (!isHeld && iAmLastRoller && hasValues));

    if (!canLock) return;

    const lockedMap = this.lockedDice.get(setId) || new Map();
    const value = values[dieIndex];

    if (lockedMap.has(dieIndex)) {
      // Unlock
      lockedMap.delete(dieIndex);
      if (lockedMap.size === 0) {
        this.lockedDice.delete(setId);
      }
      this.dispatchEvent(
        new CustomEvent("dice-lock-changed", {
          bubbles: true,
          detail: { setId, dieIndex, locked: false, value },
        }),
      );
    } else {
      // Lock
      if (!this.lockedDice.has(setId)) {
        this.lockedDice.set(setId, new Map());
      }
      this.lockedDice.get(setId).set(dieIndex, value);
      this.dispatchEvent(
        new CustomEvent("dice-lock-changed", {
          bubbles: true,
          detail: { setId, dieIndex, locked: true, value },
        }),
      );
    }

    this.render();
  }

  handleSetClick(setId) {
    if (this.isRolling) return;

    const holder = this.holders.get(setId);
    const isHeld = holder !== undefined;

    if (!isHeld) {
      // Set not held - grab it
      this.dispatchEvent(
        new CustomEvent("dice-grabbed", {
          bubbles: true,
          detail: { setId },
        }),
      );
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
    return this.diceSets.every((set) => this.holders.has(set.id));
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

    // Track which dice are locked (they won't roll)
    const lockedBySet = new Map();
    for (const [setId, lockedMap] of this.lockedDice) {
      lockedBySet.set(setId, new Map(lockedMap));
    }

    // First, render dice sets with rolling animation (except locked dice)
    this.diceSets.forEach((set) => {
      const setEl = this.querySelector(`.dice-set[data-set-id="${set.id}"]`);
      if (setEl) {
        const pipColor = getPipColor(set.color);
        const bgColor = hexToRgba(set.color, 0.15);
        const locked = lockedBySet.get(set.id) || new Map();

        // Replace content with rolling/locked dice
        setEl.className = "dice-set card held rolling-set";
        setEl.style.setProperty("--set-color", set.color);
        setEl.style.setProperty("--set-bg", bgColor);
        setEl.style.borderColor = set.color;
        setEl.innerHTML = `
          <div class="dice-display">
            ${Array(set.count)
              .fill(0)
              .map((_, i) => {
                if (locked.has(i)) {
                  // Locked die - show static with lock indicator
                  const lockedValue = locked.get(i);
                  return `<div class="die-wrapper">
                  <div class="die locked" data-pip-color="${pipColor}">${getDiceSvg(lockedValue, pipColor)}</div>
                  <div class="lock-indicator">🔒</div>
                </div>`;
                } else {
                  // Unlocked die - rolling animation
                  return `<div class="die-wrapper"><div class="die rolling" data-pip-color="${pipColor}" data-die-index="${i}">${getDiceSvg(1, pipColor)}</div></div>`;
                }
              })
              .join("")}
          </div>
        `;
      }
    });

    // Animate for 500ms (only unlocked dice)
    const animate = () => {
      this.querySelectorAll(".die.rolling").forEach((die) => {
        const pipColor = die.dataset.pipColor || "#ffffff";
        die.innerHTML = getDiceSvg(Math.floor(Math.random() * 6) + 1, pipColor);
      });
    };
    const interval = setInterval(animate, 80);
    await new Promise((r) => setTimeout(r, 500));
    clearInterval(interval);

    // Generate final values for each set (keep locked values)
    const rollResults = {};
    let totalSum = 0;

    this.diceSets.forEach((set) => {
      const locked = lockedBySet.get(set.id) || new Map();
      const values = Array(set.count)
        .fill(0)
        .map((_, i) => {
          if (locked.has(i)) {
            return locked.get(i); // Keep locked value
          }
          return Math.floor(Math.random() * 6) + 1; // Roll new value
        });
      rollResults[set.id] = values;
      this.currentValues[set.id] = values;
      totalSum += values.reduce((a, b) => a + b, 0);
    });

    // Show results
    this.diceSets.forEach((set) => {
      const setEl = this.querySelector(`.dice-set[data-set-id="${set.id}"]`);
      if (setEl) {
        const display = setEl.querySelector(".dice-display");
        if (display) {
          const pipColor = getPipColor(set.color);
          const values = rollResults[set.id];
          const locked = lockedBySet.get(set.id) || new Map();
          display.innerHTML = values
            .map(
              (v, i) =>
                `<div class="die-wrapper">
              <div class="die ${locked.has(i) ? "locked" : ""}" style="${this.getRandomDiceTransform()}">${getDiceSvg(v, pipColor)}</div>
              ${locked.has(i) ? '<div class="lock-indicator">🔒</div>' : ""}
            </div>`,
            )
            .join("");
        }
      }
    });

    this.isRolling = false;

    // Mark that holder has rolled (enables locking for next time)
    for (const set of this.diceSets) {
      this.holderHasRolled.set(set.id, true);
    }

    // Emit roll event with per-set results
    this.dispatchEvent(
      new CustomEvent("dice-rolled", {
        bubbles: true,
        detail: {
          diceType: 6,
          rollResults, // { setId: [values] }
          total: totalSum,
          holders: Array.from(this.holders.entries()), // Who held what
          lockedDice: Array.from(lockedBySet.entries()).map(([setId, m]) => ({
            setId,
            lockedIndices: [...m.keys()],
            values: [...m.values()],
          })),
        },
      }),
    );
  }

  // External API
  setConfig({
    diceSets,
    holders,
    myPeerId,
    allowLocking,
    lockedDice,
    holderHasRolled,
    lastRoller,
  }) {
    const newDiceSets = diceSets || [
      { id: "set-1", count: 2, color: "#ffffff" },
    ];

    // Clear currentValues for sets whose count has changed
    for (const newSet of newDiceSets) {
      const oldSet = this.diceSets.find((s) => s.id === newSet.id);
      const oldValues = this.currentValues[newSet.id];
      if (oldValues && (!oldSet || oldSet.count !== newSet.count)) {
        delete this.currentValues[newSet.id];
      }
    }

    this.diceSets = newDiceSets;
    this.myPeerId = myPeerId;
    this.allowLocking = allowLocking || false;

    // Convert holders array back to Map
    this.holders.clear();
    if (holders) {
      for (const [setId, holder] of holders) {
        this.holders.set(setId, holder);
      }
    }

    // Set locked dice state
    this.lockedDice.clear();
    if (lockedDice) {
      for (const [setId, lock] of lockedDice) {
        if (lock instanceof Map) {
          this.lockedDice.set(setId, new Map(lock));
        } else if (lock.lockedIndices) {
          // From mesh-state format
          const lockMap = new Map();
          for (let i = 0; i < lock.lockedIndices.length; i++) {
            const idx = lock.lockedIndices[i];
            const val =
              lock.values instanceof Map
                ? lock.values.get(idx)
                : lock.values[i];
            lockMap.set(idx, val);
          }
          this.lockedDice.set(setId, lockMap);
        }
      }
    }

    // Set holder rolled state
    this.holderHasRolled.clear();
    if (holderHasRolled) {
      for (const [setId, hasRolled] of holderHasRolled) {
        this.holderHasRolled.set(setId, hasRolled);
      }
    }

    // Set last roller state
    this.lastRoller.clear();
    if (lastRoller) {
      for (const [setId, roller] of lastRoller) {
        this.lastRoller.set(setId, roller);
      }
    }

    this.render();
  }

  showRoll(rollResults, lockedDiceInfo) {
    // rollResults: { setId: [values] }
    // lockedDiceInfo: [{ setId, lockedIndices, values }] (optional)
    this.currentValues = { ...rollResults };

    // Update locked dice from roll info
    if (lockedDiceInfo) {
      this.lockedDice.clear();
      for (const lock of lockedDiceInfo) {
        const lockMap = new Map();
        for (let i = 0; i < lock.lockedIndices.length; i++) {
          lockMap.set(lock.lockedIndices[i], lock.values[i]);
        }
        if (lockMap.size > 0) {
          this.lockedDice.set(lock.setId, lockMap);
        }
      }
    }

    this.diceSets.forEach((set) => {
      const values = rollResults[set.id] || [];
      if (values.length === 0) return;

      const setEl = this.querySelector(`.dice-set[data-set-id="${set.id}"]`);
      if (setEl) {
        const pipColor = getPipColor(set.color);
        const bgColor = hexToRgba(set.color, 0.15);
        const locked = this.lockedDice.get(set.id) || new Map();

        // Update the set element to show dice results
        setEl.className = "dice-set card";
        setEl.style.setProperty("--set-color", set.color);
        setEl.style.setProperty("--set-bg", bgColor);
        setEl.style.borderColor = "transparent";
        setEl.innerHTML = `
          <div class="dice-display">
            ${values
              .map(
                (v, i) => `<div class="die-wrapper">
              <div class="die ${locked.has(i) ? "locked" : ""}" style="${this.getRandomDiceTransform()}">${getDiceSvg(v, pipColor)}</div>
              ${locked.has(i) ? '<div class="lock-indicator">🔒</div>' : ""}
            </div>`,
              )
              .join("")}
          </div>
          <div class="hint">Click to grab</div>
        `;
      }
    });
    this.attachEventListeners();
  }

  // Clear all locks (called when holder changes to different user)
  clearLocks() {
    this.lockedDice.clear();
    this.holderHasRolled.clear();
  }

  // Set lock state externally
  setLockState(setId, lockedIndices, values) {
    if (lockedIndices.length === 0) {
      this.lockedDice.delete(setId);
    } else {
      const lockMap = new Map();
      for (let i = 0; i < lockedIndices.length; i++) {
        lockMap.set(lockedIndices[i], values[i]);
      }
      this.lockedDice.set(setId, lockMap);
    }
    this.render();
  }
}

customElements.define("dice-roller", DiceRoller);
