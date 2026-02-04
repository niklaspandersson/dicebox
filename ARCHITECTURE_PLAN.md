# DiceBox Architecture Refactoring Plan

## Executive Summary

This document outlines a complete architectural redesign of the DiceBox application to:
1. Break down the large monolithic classes (DiceRoller: 617 lines, App: 828 lines, WebRTCManager: 669 lines)
2. Support multiple "strategies" for the dice rolling UX
3. Improve maintainability, testability, and extensibility

---

## Current Pain Points

### Large Classes
| Class | Lines | Issues |
|-------|-------|--------|
| `App.js` | 828 | Orchestrates everything, 15+ event handlers, mixed concerns |
| `WebRTCManager` | 669 | Connection creation, signaling, channels all in one |
| `DiceRoller` | 617 | UI rendering, animation, state, locking all intertwined |
| `MeshState` | 474 | Multiple state domains mixed together |

### Architectural Issues
- **Tight coupling**: Components directly import singletons
- **Mixed concerns**: UI components contain business logic
- **Hard to extend**: Adding a new dice rolling strategy requires modifying existing code
- **Hard to test**: No dependency injection, global state

---

## Proposed Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Application Shell                              │
│                    (Thin orchestration layer)                           │
└───────────┬─────────────────────────────────────────────────┬───────────┘
            │                                                 │
            v                                                 v
┌───────────────────────────┐                 ┌───────────────────────────┐
│    Feature Modules        │                 │    Infrastructure         │
│                           │                 │                           │
│  ┌─────────────────────┐  │                 │  ┌─────────────────────┐  │
│  │  Dice Rolling       │  │                 │  │  Network Layer      │  │
│  │  (Strategy Pattern) │  │                 │  │  (P2P & Signaling)  │  │
│  └─────────────────────┘  │                 │  └─────────────────────┘  │
│  ┌─────────────────────┐  │                 │  ┌─────────────────────┐  │
│  │  Room Management    │  │                 │  │  State Management   │  │
│  │                     │  │                 │  │  (Event-Sourced)    │  │
│  └─────────────────────┘  │                 │  └─────────────────────┘  │
│  ┌─────────────────────┐  │                 │  ┌─────────────────────┐  │
│  │  Player Management  │  │                 │  │  Message Bus        │  │
│  │                     │  │                 │  │                     │  │
│  └─────────────────────┘  │                 │  └─────────────────────┘  │
└───────────────────────────┘                 └───────────────────────────┘
            │                                                 │
            └─────────────────────┬───────────────────────────┘
                                  v
┌─────────────────────────────────────────────────────────────────────────┐
│                         UI Components Layer                              │
│              (Dumb components, receive props, emit events)              │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Module Breakdown

### 1. Application Shell (`/src/app/`)

**Purpose**: Thin orchestration layer that wires everything together

```
/src/app/
  ├── App.js              (~100 lines) - Main entry, DI container
  ├── AppConfig.js        - Configuration loading
  └── AppRouter.js        - View routing (lobby, room, etc.)
```

**Responsibilities**:
- Initialize and wire up modules
- Route between views (lobby → room)
- Handle top-level errors

**NOT responsible for**:
- Business logic (delegated to feature modules)
- Direct DOM manipulation
- Message handling details

---

### 2. Dice Rolling Module (`/src/features/dice-rolling/`)

This is the core module that implements the **Strategy Pattern** for different dice rolling UX styles.

```
/src/features/dice-rolling/
  ├── index.js                    - Public API & strategy registry
  │
  ├── strategies/                 - Rolling UX strategies (each with its own view!)
  │   ├── DiceRollingStrategy.js  - Abstract interface
  │   │
  │   ├── grab-and-roll/          - Current "grab sets, then roll" UX
  │   │   ├── GrabAndRollStrategy.js
  │   │   ├── GrabAndRollView.js  - Click-based card UI
  │   │   └── grab-and-roll.css
  │   │
  │   ├── drag-select/            - Drag to select dice UX
  │   │   ├── DragSelectStrategy.js
  │   │   ├── DragSelectView.js   - Canvas with drag selection
  │   │   └── drag-select.css
  │   │
  │   ├── sequential/             - Turn-based rolling
  │   │   ├── SequentialStrategy.js
  │   │   ├── SequentialView.js   - Turn indicator + queue
  │   │   └── sequential.css
  │   │
  │   └── physics-3d/             - 3D dice with physics (optional)
  │       ├── Physics3DStrategy.js
  │       ├── Physics3DView.js    - WebGL canvas
  │       └── physics-3d.css
  │
  ├── state/                      - Shared state management
  │   ├── DiceState.js            - Current dice values
  │   ├── LockState.js            - Locked dice tracking
  │   └── RollHistory.js          - Past rolls
  │
  └── services/                   - Shared services
      ├── DiceAnimationService.js - Animation timing (shared)
      ├── DiceRandomService.js    - RNG (crypto.getRandomValues)
      └── DiceSyncService.js      - State synchronization helpers
```

#### Strategy Interface

The strategy uses a **View Factory pattern** - each strategy provides its own view component.
This allows radically different UX paradigms (click-to-grab, drag-to-select, touch gestures, etc.)
without forcing them into a shared template.

```javascript
// /src/features/dice-rolling/strategies/DiceRollingStrategy.js

/**
 * Abstract base class for dice rolling UX strategies.
 * Each strategy defines both the LOGIC and the VIEW for dice interaction.
 *
 * This follows the "Widget" pattern where controller + view are bundled together,
 * enabling completely different UX paradigms per strategy.
 */
export class DiceRollingStrategy {
  constructor(context) {
    this.context = context; // { state, network, localPlayer, animationService }
  }

  /** @returns {string} Human-readable name */
  get name() { throw new Error('Not implemented'); }

  /** @returns {string} Description for UI */
  get description() { throw new Error('Not implemented'); }

  // ─────────────────────────────────────────────────────────────
  // VIEW FACTORY - The key extension point for custom UX
  // ─────────────────────────────────────────────────────────────

  /**
   * Factory method: Creates the view component for this strategy.
   *
   * The returned component is a Web Component that:
   * - Receives this strategy instance as its controller
   * - Handles all user interactions (clicks, drags, gestures, etc.)
   * - Renders the dice UI appropriate for this strategy's UX paradigm
   * - Subscribes to state changes and re-renders as needed
   *
   * @returns {HTMLElement} A Web Component instance
   *
   * @example
   * // Click-to-grab strategy returns a grid of clickable dice sets
   * // Drag-to-select strategy returns a canvas with drag selection
   * // 3D strategy returns a WebGL canvas with physics
   */
  createView() {
    throw new Error('Not implemented - each strategy must provide its own view');
  }

  /**
   * Optional: Returns the custom element tag name for this strategy's view.
   * Used for registering the component if not already registered.
   * @returns {string}
   */
  static get viewTagName() {
    throw new Error('Not implemented');
  }

  /**
   * Optional: Returns the view component class for registration.
   * @returns {typeof HTMLElement}
   */
  static get viewComponent() {
    throw new Error('Not implemented');
  }

  // ─────────────────────────────────────────────────────────────
  // CORE LOGIC - Shared interface for all strategies
  // ─────────────────────────────────────────────────────────────

  /**
   * Execute the roll action for given dice.
   * @param {string} playerId - Who is rolling
   * @param {string[]} setIds - Which sets to roll (strategy-dependent)
   * @returns {Promise<RollResult>}
   */
  async roll(playerId, setIds) { throw new Error('Not implemented'); }

  /**
   * Handle incoming network message related to dice.
   * @param {string} type - Message type
   * @param {object} payload - Message data
   * @param {string} fromPeerId - Sender
   */
  handleMessage(type, payload, fromPeerId) { throw new Error('Not implemented'); }

  /**
   * Get the current state for serialization/sync.
   * @returns {object}
   */
  getState() { throw new Error('Not implemented'); }

  /**
   * Load state from a peer (for sync on join).
   * @param {object} state
   */
  loadState(state) { throw new Error('Not implemented'); }

  // ─────────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────────

  /**
   * Called when strategy is activated (view mounted).
   */
  activate() {}

  /**
   * Called when strategy is deactivated (view unmounted).
   * Clean up subscriptions, timers, etc.
   */
  deactivate() {}
}
```

#### Example Strategy: Grab and Roll (Current Behavior)

```javascript
// /src/features/dice-rolling/strategies/grab-and-roll/GrabAndRollStrategy.js

import { DiceRollingStrategy } from '../DiceRollingStrategy.js';
import { GrabAndRollView } from './GrabAndRollView.js';

export class GrabAndRollStrategy extends DiceRollingStrategy {
  get name() { return 'Grab and Roll'; }

  get description() {
    return 'Players grab dice sets, then roll together when all sets are held.';
  }

  // ─────────────────────────────────────────────────────────────
  // VIEW FACTORY - Creates the click-to-grab UI
  // ─────────────────────────────────────────────────────────────

  static get viewTagName() { return 'dice-grab-and-roll'; }
  static get viewComponent() { return GrabAndRollView; }

  createView() {
    const view = document.createElement('dice-grab-and-roll');
    view.setStrategy(this);
    return view;
  }

  // ─────────────────────────────────────────────────────────────
  // STRATEGY-SPECIFIC LOGIC
  // ─────────────────────────────────────────────────────────────

  /** Called by view when user clicks a dice set */
  async handleSetClick(setId) {
    const { state, network, localPlayer } = this.context;
    const holder = state.holders.get(setId);

    if (!holder) {
      // Grab the set
      if (state.tryGrab(setId, localPlayer.id)) {
        network.broadcast('dice:grab', { setId, playerId: localPlayer.id });
      }
    } else if (holder.playerId === localPlayer.id) {
      if (this.canRoll()) {
        // All held and I'm a holder - roll!
        await this.roll(localPlayer.id, this.getMySetIds());
      } else {
        // Drop the set
        state.clearHolder(setId);
        network.broadcast('dice:drop', { setId });
      }
    }
  }

  canRoll() {
    const { state, localPlayer } = this.context;
    const allSetsHeld = state.diceConfig.diceSets.every(
      set => state.holders.has(set.id)
    );
    const playerHoldsAny = [...state.holders.values()].some(
      h => h.playerId === localPlayer.id
    );
    return allSetsHeld && playerHoldsAny;
  }

  getMySetIds() {
    const { state, localPlayer } = this.context;
    return [...state.holders.entries()]
      .filter(([_, h]) => h.playerId === localPlayer.id)
      .map(([setId]) => setId);
  }

  async roll(playerId, setIds) {
    const { state, network, animationService } = this.context;
    const rollResult = await animationService.animateRoll(setIds);

    state.applyRoll(rollResult);
    network.broadcast('dice:roll', rollResult);

    return rollResult;
  }

  handleMessage(type, payload, fromPeerId) {
    const { state, animationService } = this.context;

    switch (type) {
      case 'dice:grab':
        state.setHolder(payload.setId, payload.playerId);
        break;
      case 'dice:drop':
        state.clearHolder(payload.setId);
        break;
      case 'dice:roll':
        state.applyRoll(payload);
        animationService.showRoll(payload);
        break;
      case 'dice:lock':
        state.setLock(payload.setId, payload.dieIndex, payload.locked);
        break;
    }
  }

  getState() {
    return this.context.state.getSnapshot();
  }

  loadState(snapshot) {
    this.context.state.loadSnapshot(snapshot);
  }
}
```

```javascript
// /src/features/dice-rolling/strategies/grab-and-roll/GrabAndRollView.js

/**
 * View component for the "Grab and Roll" strategy.
 * Uses a click-based interaction model with dice sets displayed as cards.
 */
export class GrabAndRollView extends HTMLElement {
  #strategy = null;
  #unsubscribe = null;

  setStrategy(strategy) {
    this.#strategy = strategy;
  }

  connectedCallback() {
    // Subscribe to state changes
    this.#unsubscribe = this.#strategy.context.state.subscribe(() => this.render());
    this.render();
    this.addEventListener('click', this.#handleClick);
  }

  disconnectedCallback() {
    this.#unsubscribe?.();
    this.removeEventListener('click', this.#handleClick);
  }

  #handleClick = (e) => {
    const setEl = e.target.closest('[data-set-id]');
    if (setEl) {
      this.#strategy.handleSetClick(setEl.dataset.setId);
    }

    const lockEl = e.target.closest('[data-lock-die]');
    if (lockEl) {
      // Handle die locking...
    }
  }

  render() {
    const { state, localPlayer } = this.#strategy.context;
    const canRoll = this.#strategy.canRoll();

    this.innerHTML = `
      <div class="grab-and-roll">
        <div class="dice-sets">
          ${state.diceConfig.diceSets.map(set => this.#renderSet(set, canRoll)).join('')}
        </div>
      </div>
    `;
  }

  #renderSet(set, canRoll) {
    const { state, localPlayer } = this.#strategy.context;
    const holder = state.holders.get(set.id);
    const values = state.diceValues.get(set.id) || [];
    const isHeldByMe = holder?.playerId === localPlayer.id;
    const isReady = canRoll && isHeldByMe;

    return `
      <div class="dice-set ${isReady ? 'ready-to-roll' : ''} ${holder ? 'held' : ''}"
           data-set-id="${set.id}"
           style="--set-color: ${set.color}">
        <div class="dice-set__holder">
          ${holder ? holder.username : 'Click to grab'}
        </div>
        <div class="dice-set__dice">
          ${Array.from({ length: set.count }, (_, i) =>
            `<dice-die value="${values[i] || ''}" color="${set.color}"></dice-die>`
          ).join('')}
        </div>
        ${isReady ? '<div class="dice-set__roll-hint">Click to roll!</div>' : ''}
      </div>
    `;
  }
}

customElements.define('dice-grab-and-roll', GrabAndRollView);
```

#### Alternative Strategy: Drag to Select (Different UX Paradigm)

This example shows how a completely different interaction model works with the view factory pattern.
Instead of clicking sets, users drag to select individual dice, then roll the selection.

```javascript
// /src/features/dice-rolling/strategies/drag-select/DragSelectStrategy.js

import { DiceRollingStrategy } from '../DiceRollingStrategy.js';
import { DragSelectView } from './DragSelectView.js';

/**
 * Drag-to-select strategy: All dice are in a pool, users drag to select
 * which dice to roll. Completely different UX from grab-and-roll.
 */
export class DragSelectStrategy extends DiceRollingStrategy {
  #selectedDice = new Set(); // Local selection state

  get name() { return 'Drag to Select'; }

  get description() {
    return 'Drag to select dice, then roll your selection. Any player can roll anytime.';
  }

  // ─────────────────────────────────────────────────────────────
  // VIEW FACTORY - Creates a canvas-based drag selection UI
  // ─────────────────────────────────────────────────────────────

  static get viewTagName() { return 'dice-drag-select'; }
  static get viewComponent() { return DragSelectView; }

  createView() {
    const view = document.createElement('dice-drag-select');
    view.setStrategy(this);
    return view;
  }

  // ─────────────────────────────────────────────────────────────
  // SELECTION LOGIC (strategy-specific)
  // ─────────────────────────────────────────────────────────────

  /** Called by view during drag - dice under the selection rect */
  updateSelection(diceIds) {
    this.#selectedDice = new Set(diceIds);
    // Trigger view update
    this.context.state.dispatchEvent(new CustomEvent('selection-change'));
  }

  getSelection() {
    return this.#selectedDice;
  }

  clearSelection() {
    this.#selectedDice.clear();
  }

  /** Called by view when user releases drag with selection */
  async rollSelection() {
    if (this.#selectedDice.size === 0) return;

    const { localPlayer } = this.context;
    const diceToRoll = [...this.#selectedDice];

    await this.roll(localPlayer.id, diceToRoll);
    this.clearSelection();
  }

  async roll(playerId, diceIds) {
    const { state, network, animationService } = this.context;

    const rollResult = await animationService.animateRoll(diceIds);

    state.applyRoll(rollResult);
    network.broadcast('dice:roll', rollResult);

    return rollResult;
  }

  handleMessage(type, payload, fromPeerId) {
    if (type === 'dice:roll') {
      this.context.state.applyRoll(payload);
      this.context.animationService.showRoll(payload);
    }
  }

  getState() {
    return { values: this.context.state.diceValues };
  }

  loadState(snapshot) {
    this.context.state.loadValues(snapshot.values);
  }
}
```

```javascript
// /src/features/dice-rolling/strategies/drag-select/DragSelectView.js

/**
 * View component for drag-to-select strategy.
 * Uses pointer events for drag selection - completely different from click-based UI.
 */
export class DragSelectView extends HTMLElement {
  #strategy = null;
  #unsubscribe = null;
  #isDragging = false;
  #dragStart = { x: 0, y: 0 };
  #dragEnd = { x: 0, y: 0 };
  #dicePositions = new Map(); // dieId -> {x, y, width, height}

  setStrategy(strategy) {
    this.#strategy = strategy;
  }

  connectedCallback() {
    this.#unsubscribe = this.#strategy.context.state.subscribe(() => this.render());

    // Drag selection events
    this.addEventListener('pointerdown', this.#onPointerDown);
    this.addEventListener('pointermove', this.#onPointerMove);
    this.addEventListener('pointerup', this.#onPointerUp);

    this.render();
    this.#calculateDicePositions();
  }

  disconnectedCallback() {
    this.#unsubscribe?.();
    this.removeEventListener('pointerdown', this.#onPointerDown);
    this.removeEventListener('pointermove', this.#onPointerMove);
    this.removeEventListener('pointerup', this.#onPointerUp);
  }

  #onPointerDown = (e) => {
    this.#isDragging = true;
    this.#dragStart = { x: e.clientX, y: e.clientY };
    this.#dragEnd = { x: e.clientX, y: e.clientY };
    this.setPointerCapture(e.pointerId);
  }

  #onPointerMove = (e) => {
    if (!this.#isDragging) return;

    this.#dragEnd = { x: e.clientX, y: e.clientY };
    this.#updateSelectionFromDrag();
    this.#renderSelectionRect();
  }

  #onPointerUp = (e) => {
    if (!this.#isDragging) return;

    this.#isDragging = false;
    this.releasePointerCapture(e.pointerId);
    this.#hideSelectionRect();

    // If we have a selection, show roll button or auto-roll
    if (this.#strategy.getSelection().size > 0) {
      this.#strategy.rollSelection();
    }
  }

  #updateSelectionFromDrag() {
    const rect = this.#getSelectionRect();
    const selectedIds = [];

    for (const [dieId, pos] of this.#dicePositions) {
      if (this.#rectsIntersect(rect, pos)) {
        selectedIds.push(dieId);
      }
    }

    this.#strategy.updateSelection(selectedIds);
  }

  #getSelectionRect() {
    return {
      x: Math.min(this.#dragStart.x, this.#dragEnd.x),
      y: Math.min(this.#dragStart.y, this.#dragEnd.y),
      width: Math.abs(this.#dragEnd.x - this.#dragStart.x),
      height: Math.abs(this.#dragEnd.y - this.#dragStart.y),
    };
  }

  #rectsIntersect(a, b) {
    return !(a.x + a.width < b.x || b.x + b.width < a.x ||
             a.y + a.height < b.y || b.y + b.height < a.y);
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
      left: ${r.x - bounds.left}px;
      top: ${r.y - bounds.top}px;
      width: ${r.width}px;
      height: ${r.height}px;
      display: block;
    `;
  }

  #hideSelectionRect() {
    this.querySelector('.selection-rect')?.remove();
  }

  #calculateDicePositions() {
    this.querySelectorAll('[data-die-id]').forEach(el => {
      const rect = el.getBoundingClientRect();
      this.#dicePositions.set(el.dataset.dieId, {
        x: rect.x, y: rect.y, width: rect.width, height: rect.height
      });
    });
  }

  render() {
    const { state } = this.#strategy.context;
    const selection = this.#strategy.getSelection();
    const allDice = this.#getAllDice();

    this.innerHTML = `
      <div class="drag-select-pool">
        <div class="instructions">Drag to select dice, then release to roll</div>
        <div class="dice-pool">
          ${allDice.map(die => `
            <dice-die
              data-die-id="${die.id}"
              value="${die.value || ''}"
              color="${die.color}"
              ${selection.has(die.id) ? 'selected' : ''}
            ></dice-die>
          `).join('')}
        </div>
      </div>
    `;

    // Recalculate positions after render
    requestAnimationFrame(() => this.#calculateDicePositions());
  }

  #getAllDice() {
    const { state } = this.#strategy.context;
    const dice = [];
    for (const set of state.diceConfig.diceSets) {
      const values = state.diceValues.get(set.id) || [];
      for (let i = 0; i < set.count; i++) {
        dice.push({
          id: `${set.id}-${i}`,
          setId: set.id,
          index: i,
          value: values[i],
          color: set.color,
        });
      }
    }
    return dice;
  }
}

customElements.define('dice-drag-select', DragSelectView);
```

#### Other Strategy Ideas (Sketches)

```javascript
// /src/features/dice-rolling/strategies/SequentialRollStrategy.js

/**
 * Turn-based rolling. Shows whose turn it is prominently.
 * Has its own view with turn indicator and "End Turn" button.
 */
export class SequentialRollStrategy extends DiceRollingStrategy {
  get name() { return 'Take Turns'; }

  static get viewTagName() { return 'dice-sequential'; }
  static get viewComponent() { return SequentialView; }

  createView() {
    const view = document.createElement('dice-sequential');
    view.setStrategy(this);
    return view;
  }

  // View shows: "It's [Player]'s turn!" banner
  // Only active player sees roll button
  // "Pass" button to skip without rolling
}
```

```javascript
// /src/features/dice-rolling/strategies/Physics3DStrategy.js

/**
 * 3D dice with physics! Uses WebGL/Three.js for rendering.
 * Dice tumble realistically when rolled.
 */
export class Physics3DStrategy extends DiceRollingStrategy {
  get name() { return '3D Physics'; }

  static get viewTagName() { return 'dice-3d-physics'; }
  static get viewComponent() { return Physics3DView; }

  createView() {
    const view = document.createElement('dice-3d-physics');
    view.setStrategy(this);
    return view;
  }

  // View is a WebGL canvas with Three.js
  // Dice are 3D models with physics simulation
  // Click and drag to "throw" dice
  // Results determined by physics, synced via network
}
```

```javascript
// /src/features/dice-rolling/strategies/TouchGestureStrategy.js

/**
 * Mobile-optimized with swipe gestures.
 * Swipe up to roll, pinch to select, etc.
 */
export class TouchGestureStrategy extends DiceRollingStrategy {
  get name() { return 'Touch Gestures'; }

  static get viewTagName() { return 'dice-touch'; }
  static get viewComponent() { return TouchGestureView; }

  createView() {
    const view = document.createElement('dice-touch');
    view.setStrategy(this);
    return view;
  }

  // View uses Hammer.js or similar for gesture recognition
  // Swipe up = roll all
  // Tap dice = toggle lock
  // Pinch = zoom in on dice
}

---

### 3. Network Layer (`/src/infrastructure/network/`)

Break down the 669-line WebRTCManager into focused modules.

```
/src/infrastructure/network/
  ├── index.js                    - Public API
  │
  ├── signaling/                  - Server communication
  │   ├── SignalingClient.js      - WebSocket to server
  │   └── SignalingProtocol.js    - Message format/parsing
  │
  ├── webrtc/                     - P2P connections
  │   ├── PeerConnectionFactory.js - Creates RTCPeerConnection
  │   ├── DataChannelManager.js   - Manages data channels
  │   ├── IceManager.js           - ICE candidate handling
  │   └── TurnCredentialManager.js - TURN auth
  │
  ├── mesh/                       - Mesh topology
  │   ├── MeshManager.js          - Manages peer mesh (~150 lines)
  │   └── PeerConnection.js       - Single peer abstraction
  │
  └── NetworkService.js           - High-level API (~100 lines)
      // Methods: connect(), broadcast(), send(), onMessage()
```

#### NetworkService API

```javascript
// /src/infrastructure/network/NetworkService.js

export class NetworkService extends EventTarget {
  constructor(signalingClient, meshManager) {
    this.signaling = signalingClient;
    this.mesh = meshManager;
  }

  /** Connect to a room */
  async joinRoom(roomId, username) { }

  /** Leave current room */
  async leaveRoom() { }

  /** Broadcast message to all peers */
  broadcast(type, payload) {
    this.mesh.broadcast({ type, payload });
  }

  /** Send message to specific peer */
  send(peerId, type, payload) {
    this.mesh.send(peerId, { type, payload });
  }

  /** Register message handler */
  onMessage(type, handler) {
    this.messageHandlers.set(type, handler);
  }
}
```

---

### 4. State Management (`/src/infrastructure/state/`)

Replace the 474-line MeshState with smaller, focused state stores.

```
/src/infrastructure/state/
  ├── index.js                    - Public API
  │
  ├── core/                       - State infrastructure
  │   ├── Store.js                - Base reactive store
  │   ├── EventLog.js             - Event sourcing (optional)
  │   └── StateSync.js            - P2P state synchronization
  │
  ├── stores/                     - Domain-specific stores
  │   ├── PeerStore.js            - Connected peers (~50 lines)
  │   ├── RoomStore.js            - Room configuration (~30 lines)
  │   ├── DiceStore.js            - Dice state (~100 lines)
  │   └── HistoryStore.js         - Roll history (~50 lines)
  │
  └── selectors/                  - Derived state
      ├── diceSelectors.js        - Computed dice state
      └── peerSelectors.js        - Computed peer state
```

#### Reactive Store Pattern

```javascript
// /src/infrastructure/state/core/Store.js

export class Store extends EventTarget {
  #state;
  #subscribers = new Set();

  constructor(initialState) {
    super();
    this.#state = initialState;
  }

  get state() {
    return this.#state;
  }

  update(updater) {
    const oldState = this.#state;
    this.#state = typeof updater === 'function'
      ? updater(oldState)
      : { ...oldState, ...updater };

    this.dispatchEvent(new CustomEvent('change', {
      detail: { oldState, newState: this.#state }
    }));
  }

  subscribe(callback) {
    const handler = (e) => callback(e.detail.newState, e.detail.oldState);
    this.addEventListener('change', handler);
    return () => this.removeEventListener('change', handler);
  }
}
```

#### Domain Store Example

```javascript
// /src/infrastructure/state/stores/DiceStore.js

import { Store } from '../core/Store.js';

const initialState = {
  config: { diceSets: [], allowLocking: false },
  values: new Map(),      // setId -> number[]
  holders: new Map(),     // setId -> { playerId, username }
  lockedDice: new Map(),  // setId -> Set<index>
  lastRoller: new Map(),  // setId -> { playerId, username }
};

export class DiceStore extends Store {
  constructor() {
    super(initialState);
  }

  setConfig(config) {
    this.update({ config });
  }

  setHolder(setId, playerId, username) {
    this.update(state => ({
      ...state,
      holders: new Map(state.holders).set(setId, { playerId, username })
    }));
  }

  clearHolder(setId) {
    this.update(state => {
      const holders = new Map(state.holders);
      holders.delete(setId);
      return { ...state, holders };
    });
  }

  applyRoll(rollResult) {
    this.update(state => ({
      ...state,
      values: new Map([...state.values, ...Object.entries(rollResult.values)]),
      lastRoller: new Map([...state.lastRoller, ...Object.entries(rollResult.rollers)])
    }));
  }

  toggleLock(setId, dieIndex) {
    this.update(state => {
      const lockedDice = new Map(state.lockedDice);
      const setLocks = new Set(lockedDice.get(setId) || []);

      if (setLocks.has(dieIndex)) {
        setLocks.delete(dieIndex);
      } else {
        setLocks.add(dieIndex);
      }

      lockedDice.set(setId, setLocks);
      return { ...state, lockedDice };
    });
  }
}
```

---

### 5. Message Bus (`/src/infrastructure/messaging/`)

Centralized message routing with type safety and handler registration.

```
/src/infrastructure/messaging/
  ├── MessageBus.js               - Central message router (~80 lines)
  ├── MessageTypes.js             - Type definitions
  └── MessageSerializer.js        - JSON encode/decode
```

```javascript
// /src/infrastructure/messaging/MessageBus.js

export class MessageBus {
  #handlers = new Map();
  #middlewares = [];

  /** Register a handler for a message type */
  on(type, handler) {
    if (!this.#handlers.has(type)) {
      this.#handlers.set(type, new Set());
    }
    this.#handlers.get(type).add(handler);

    return () => this.#handlers.get(type).delete(handler);
  }

  /** Add middleware (logging, validation, etc.) */
  use(middleware) {
    this.#middlewares.push(middleware);
  }

  /** Dispatch a message to handlers */
  async dispatch(message, context = {}) {
    // Run through middlewares
    for (const middleware of this.#middlewares) {
      message = await middleware(message, context);
      if (!message) return; // Middleware can halt dispatch
    }

    const handlers = this.#handlers.get(message.type) || [];
    for (const handler of handlers) {
      await handler(message.payload, context);
    }
  }
}

// Usage:
// messageBus.on('dice:roll', (payload, { fromPeerId }) => { ... });
// messageBus.dispatch({ type: 'dice:roll', payload: {...} }, { fromPeerId: '123' });
```

---

### 6. UI Components (`/src/ui/`)

Separate smart containers from dumb presentational components.

```
/src/ui/
  ├── components/                 - Dumb, reusable components
  │   ├── dice/
  │   │   ├── Die.js              - Single die display
  │   │   ├── DiceSet.js          - Group of dice
  │   │   └── DiceValue.js        - Animated value display
  │   │
  │   ├── players/
  │   │   ├── PlayerBadge.js      - Player name/avatar
  │   │   ├── PlayerList.js       - List of players
  │   │   └── HolderIndicator.js  - Who holds dice
  │   │
  │   ├── room/
  │   │   ├── RoomCode.js         - Room code display
  │   │   ├── JoinForm.js         - Join room form
  │   │   └── CreateForm.js       - Create room form
  │   │
  │   └── common/
  │       ├── Button.js
  │       ├── Input.js
  │       └── Modal.js
  │
  ├── containers/                 - Smart components (connect to state)
  │   ├── DiceRollerContainer.js  - Connects dice UI to strategy
  │   ├── PlayerListContainer.js  - Connects to peer store
  │   ├── RoomContainer.js        - Main room view
  │   └── LobbyContainer.js       - Room selection/creation
  │
  └── views/                      - Full page views
      ├── LobbyView.js
      ├── RoomView.js
      └── ErrorView.js
```

#### Dumb Component Example

```javascript
// /src/ui/components/dice/Die.js

export class Die extends HTMLElement {
  static get observedAttributes() {
    return ['value', 'locked', 'color', 'rolling'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const value = this.getAttribute('value') || '';
    const locked = this.hasAttribute('locked');
    const color = this.getAttribute('color') || '#ffffff';
    const rolling = this.hasAttribute('rolling');

    this.innerHTML = `
      <div class="die ${locked ? 'locked' : ''} ${rolling ? 'rolling' : ''}"
           style="--die-color: ${color}">
        ${this.renderFace(value)}
        ${locked ? '<span class="lock-icon">🔒</span>' : ''}
      </div>
    `;
  }

  renderFace(value) {
    // SVG dice face rendering
  }
}

customElements.define('dice-die', Die);
```

#### Strategy View Mounting

The `DiceRollerContainer` is now a thin wrapper that delegates to the strategy's view.
It handles strategy lifecycle and view swapping.

```javascript
// /src/ui/containers/DiceRollerContainer.js

/**
 * Container that mounts the appropriate strategy view.
 * This is the ONLY place that knows about strategy views.
 * The rest of the app just knows about strategies.
 */
export class DiceRollerContainer extends HTMLElement {
  #strategy = null;
  #currentView = null;

  /**
   * Set the active strategy. Can be called to switch strategies at runtime.
   * @param {DiceRollingStrategy} strategy
   */
  setStrategy(strategy) {
    // Deactivate old strategy
    if (this.#strategy) {
      this.#strategy.deactivate();
    }

    // Remove old view
    if (this.#currentView) {
      this.#currentView.remove();
      this.#currentView = null;
    }

    this.#strategy = strategy;

    if (strategy) {
      // Register view component if needed
      this.#ensureViewRegistered(strategy);

      // Create and mount new view
      this.#currentView = strategy.createView();
      this.appendChild(this.#currentView);

      // Activate new strategy
      strategy.activate();
    }
  }

  #ensureViewRegistered(strategy) {
    const tagName = strategy.constructor.viewTagName;
    if (!customElements.get(tagName)) {
      customElements.define(tagName, strategy.constructor.viewComponent);
    }
  }

  disconnectedCallback() {
    this.#strategy?.deactivate();
  }
}

customElements.define('dice-roller-container', DiceRollerContainer);
```

```javascript
// Usage in Room View:

class RoomView extends HTMLElement {
  connectedCallback() {
    const container = window.app.container;
    const strategy = container.get('diceStrategy');

    this.innerHTML = `
      <header-bar></header-bar>
      <dice-roller-container></dice-roller-container>
      <dice-history></dice-history>
      <peer-list></peer-list>
    `;

    // Mount the strategy's view
    this.querySelector('dice-roller-container').setStrategy(strategy);
  }
}
```

#### Shared Primitive Components

Even though strategies provide their own views, they can reuse shared primitive components
like `<dice-die>` for rendering individual dice. This avoids duplication.

```javascript
// /src/ui/components/dice/Die.js
// Shared by all strategies that want standard die rendering

export class Die extends HTMLElement {
  static get observedAttributes() {
    return ['value', 'locked', 'color', 'rolling', 'selected'];
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const value = this.getAttribute('value') || '';
    const locked = this.hasAttribute('locked');
    const selected = this.hasAttribute('selected');
    const color = this.getAttribute('color') || '#ffffff';
    const rolling = this.hasAttribute('rolling');

    this.innerHTML = `
      <div class="die
                  ${locked ? 'die--locked' : ''}
                  ${selected ? 'die--selected' : ''}
                  ${rolling ? 'die--rolling' : ''}"
           style="--die-color: ${color}">
        ${this.#renderFace(value)}
        ${locked ? '<span class="die__lock-icon"></span>' : ''}
      </div>
    `;
  }

  #renderFace(value) {
    // SVG rendering of die face...
  }
}

customElements.define('dice-die', Die);
```

---

### 7. Room Management (`/src/features/room/`)

```
/src/features/room/
  ├── index.js
  ├── RoomService.js              - Room lifecycle (~100 lines)
  ├── RoomConfig.js               - Room configuration
  └── components/
      ├── RoomHeader.js
      ├── ShareLink.js
      └── LeaveButton.js
```

---

### 8. Player Management (`/src/features/players/`)

```
/src/features/players/
  ├── index.js
  ├── PlayerService.js            - Player lifecycle
  ├── LocalPlayer.js              - Current user state
  └── components/
      ├── UsernameInput.js
      └── PlayerCard.js
```

---

## Dependency Injection

Instead of importing singletons, use a simple DI container.

```javascript
// /src/app/Container.js

export class Container {
  #services = new Map();
  #factories = new Map();

  register(name, factory) {
    this.#factories.set(name, factory);
  }

  registerInstance(name, instance) {
    this.#services.set(name, instance);
  }

  get(name) {
    if (!this.#services.has(name)) {
      const factory = this.#factories.get(name);
      if (!factory) throw new Error(`Service not found: ${name}`);
      this.#services.set(name, factory(this));
    }
    return this.#services.get(name);
  }
}

// Usage in App.js:
const container = new Container();

// Register services
container.register('signaling', () => new SignalingClient(config.wsUrl));
container.register('mesh', (c) => new MeshManager(c.get('signaling')));
container.register('network', (c) => new NetworkService(c.get('signaling'), c.get('mesh')));
container.register('diceStore', () => new DiceStore());
container.register('diceStrategy', (c) => new GrabAndRollStrategy({
  state: c.get('diceStore'),
  network: c.get('network'),
  localPlayer: c.get('localPlayer'),
}));
```

---

## File Structure Summary

```
/src/
  ├── app/
  │   ├── App.js                  (~100 lines)
  │   ├── AppConfig.js
  │   ├── AppRouter.js
  │   └── Container.js
  │
  ├── features/
  │   ├── dice-rolling/
  │   │   ├── strategies/         (4-5 strategy files, ~150 lines each)
  │   │   ├── state/              (3 files, ~50-100 lines each)
  │   │   ├── services/           (3 files, ~80 lines each)
  │   │   └── components/         (6 files, ~50 lines each)
  │   │
  │   ├── room/
  │   │   ├── RoomService.js      (~100 lines)
  │   │   └── components/         (3 files)
  │   │
  │   └── players/
  │       ├── PlayerService.js    (~80 lines)
  │       └── components/         (2 files)
  │
  ├── infrastructure/
  │   ├── network/
  │   │   ├── signaling/          (2 files, ~100 lines each)
  │   │   ├── webrtc/             (4 files, ~100 lines each)
  │   │   ├── mesh/               (2 files, ~150 lines each)
  │   │   └── NetworkService.js   (~100 lines)
  │   │
  │   ├── state/
  │   │   ├── core/               (3 files, ~50 lines each)
  │   │   ├── stores/             (4 files, ~50-100 lines each)
  │   │   └── selectors/          (2 files)
  │   │
  │   └── messaging/
  │       ├── MessageBus.js       (~80 lines)
  │       └── MessageTypes.js
  │
  └── ui/
      ├── components/             (15+ small components)
      ├── containers/             (4-5 smart containers)
      └── views/                  (3 views)
```

---

## Size Comparison

### Before
| File | Lines |
|------|-------|
| App.js | 828 |
| WebRTCManager | 669 |
| DiceRoller | 617 |
| MeshState | 474 |
| **Total large files** | **2,588** |

### After (Estimated)
| Module | Files | Avg Lines | Total |
|--------|-------|-----------|-------|
| App shell | 4 | 60 | 240 |
| Dice strategies | 5 | 150 | 750 |
| Dice state/services | 6 | 80 | 480 |
| Network layer | 8 | 100 | 800 |
| State management | 9 | 50 | 450 |
| UI components | 20 | 50 | 1,000 |
| **Total** | **52** | - | **~3,720** |

The total lines increase slightly due to clearer boundaries, but:
- **Max file size**: ~150 lines (vs 828 before)
- **Single responsibility**: Each file has one clear purpose
- **Testable**: Dependencies are injected
- **Extensible**: New strategies don't modify existing code

---

## Migration Path

### Phase 1: Infrastructure (Week 1)
1. Create new `/src/` directory structure
2. Extract state stores from MeshState
3. Extract network modules from WebRTCManager
4. Set up dependency injection container

### Phase 2: Core Features (Week 2)
1. Implement Strategy pattern for dice rolling
2. Create GrabAndRollStrategy (current behavior)
3. Extract dice-related services
4. Create message bus

### Phase 3: UI Refactoring (Week 3)
1. Create dumb UI components
2. Create smart containers
3. Wire up to new state management
4. Remove old monolithic components

### Phase 4: Polish & New Strategies (Week 4)
1. Add new rolling strategies
2. Add strategy selection to room creation
3. End-to-end testing
4. Remove legacy code

---

## Adding a New Strategy

With the view factory pattern, adding a new dice rolling strategy with a completely custom UX:

### 1. Create strategy folder with strategy + view

```
/src/features/dice-rolling/strategies/my-new-strategy/
  ├── MyNewStrategy.js    - Logic
  ├── MyNewView.js        - Custom UI component
  └── my-new-strategy.css - Styles
```

### 2. Implement the strategy

```javascript
// /src/features/dice-rolling/strategies/my-new-strategy/MyNewStrategy.js

import { DiceRollingStrategy } from '../DiceRollingStrategy.js';
import { MyNewView } from './MyNewView.js';

export class MyNewStrategy extends DiceRollingStrategy {
  get name() { return 'My Custom UX'; }
  get description() { return 'Description shown in strategy picker.'; }

  // View factory - return YOUR custom component
  static get viewTagName() { return 'dice-my-new'; }
  static get viewComponent() { return MyNewView; }

  createView() {
    const view = document.createElement('dice-my-new');
    view.setStrategy(this);
    return view;
  }

  // Implement your custom logic...
  async roll(playerId, setIds) { /* ... */ }
  handleMessage(type, payload, fromPeerId) { /* ... */ }
}
```

### 3. Implement the view

```javascript
// /src/features/dice-rolling/strategies/my-new-strategy/MyNewView.js

export class MyNewView extends HTMLElement {
  #strategy = null;

  setStrategy(strategy) {
    this.#strategy = strategy;
  }

  connectedCallback() {
    // Your custom DOM structure
    // Your custom event handling (clicks, drags, gestures, WebGL, etc.)
    // Subscribe to state changes
  }

  // You can reuse shared components like <dice-die>
  // or create entirely custom rendering
}
```

### 4. Register in strategy registry

```javascript
// /src/features/dice-rolling/strategies/index.js

import { GrabAndRollStrategy } from './grab-and-roll/GrabAndRollStrategy.js';
import { DragSelectStrategy } from './drag-select/DragSelectStrategy.js';
import { MyNewStrategy } from './my-new-strategy/MyNewStrategy.js';

export const strategies = {
  'grab-and-roll': GrabAndRollStrategy,
  'drag-select': DragSelectStrategy,
  'my-new-strategy': MyNewStrategy,  // Add here
};

export function createStrategy(type, context) {
  const Strategy = strategies[type];
  if (!Strategy) throw new Error(`Unknown strategy: ${type}`);
  return new Strategy(context);
}
```

### 5. Done!

No changes needed to:
- The app shell
- The room view
- The container component
- Any other strategies
- Network/state infrastructure

The new strategy is completely self-contained with its own view.

---

## Conclusion

This architecture provides:

1. **Smaller, focused modules** - No file over 150 lines
2. **Strategy + View Factory pattern** - Each strategy bundles its own UI, enabling radically different UX paradigms (click, drag, touch gestures, 3D physics, etc.)
3. **Clear separation of concerns** - UI, state, network, and business logic are separate
4. **Dependency injection** - Testable and configurable
5. **Reactive state** - UI automatically updates when state changes
6. **Shared primitives** - Common components like `<dice-die>` can be reused across strategies
7. **Type safety ready** - Structure supports TypeScript adoption

### Why View Factory?

The key insight is that some UX paradigms are fundamentally incompatible with a shared template:

| Strategy | DOM Structure | Event Model | Rendering |
|----------|---------------|-------------|-----------|
| Grab & Roll | Card grid | Click events | HTML/CSS |
| Drag Select | Flat pool + selection rect | Pointer events + drag | HTML + canvas overlay |
| Sequential | Turn queue + active area | Click + timers | HTML/CSS |
| 3D Physics | WebGL canvas | Raycasting + physics | Three.js |
| Touch Gestures | Full-screen touch area | Hammer.js gestures | HTML/CSS |

Forcing these into a single template would result in complex conditionals and brittle code.
By letting each strategy provide its own view, we get:

- **Maximum flexibility** - Any UX paradigm is possible
- **Clean encapsulation** - Strategy + view are a cohesive unit
- **Easy testing** - Test strategy logic and view separately
- **Independent evolution** - Change one strategy without touching others

The migration can be done incrementally, one module at a time, allowing for continuous deployment throughout the refactoring process.
