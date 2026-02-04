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
  ├── index.js                    - Public API
  │
  ├── strategies/                 - Rolling UX strategies
  │   ├── DiceRollingStrategy.js  - Abstract interface
  │   ├── GrabAndRollStrategy.js  - Current "grab sets, then roll" UX
  │   ├── IndividualRollStrategy.js - Each player rolls their own dice
  │   ├── SequentialRollStrategy.js - Players take turns rolling
  │   └── DicePoolStrategy.js     - Shared pool, anyone can roll
  │
  ├── state/                      - State management
  │   ├── DiceState.js            - Current dice values, locks
  │   ├── HolderState.js          - Who holds which sets
  │   └── RollHistory.js          - Past rolls
  │
  ├── services/                   - Business logic
  │   ├── DiceRollingService.js   - Coordinates rolling
  │   ├── DiceLockingService.js   - Lock/unlock logic
  │   └── DiceAnimationService.js - Animation timing
  │
  └── components/                 - UI components
      ├── DiceRollerContainer.js  - Smart component, connects to state
      ├── DiceSet.js              - Single set of dice (dumb)
      ├── Die.js                  - Single die (dumb)
      ├── RollButton.js           - Roll action button
      ├── DiceHolder.js           - Shows who holds dice
      └── LockIndicator.js        - Lock state display
```

#### Strategy Interface

```javascript
// /src/features/dice-rolling/strategies/DiceRollingStrategy.js

/**
 * Abstract base class for dice rolling UX strategies.
 * Each strategy defines how players interact with dice.
 */
export class DiceRollingStrategy {
  constructor(context) {
    this.context = context; // { state, network, localPlayer }
  }

  /** @returns {string} Human-readable name */
  get name() { throw new Error('Not implemented'); }

  /** @returns {string} Description for UI */
  get description() { throw new Error('Not implemented'); }

  /**
   * Called when a player clicks on a dice set.
   * @param {string} setId - The dice set that was clicked
   * @param {string} playerId - The player who clicked
   * @returns {Promise<void>}
   */
  async onSetClick(setId, playerId) { throw new Error('Not implemented'); }

  /**
   * Determines if a player can interact with a set.
   * @param {string} setId
   * @param {string} playerId
   * @returns {boolean}
   */
  canInteract(setId, playerId) { throw new Error('Not implemented'); }

  /**
   * Determines if the roll button should be shown.
   * @param {string} playerId
   * @returns {boolean}
   */
  canRoll(playerId) { throw new Error('Not implemented'); }

  /**
   * Execute the roll action.
   * @param {string} playerId
   * @returns {Promise<RollResult>}
   */
  async roll(playerId) { throw new Error('Not implemented'); }

  /**
   * Get display state for UI rendering.
   * @returns {DiceDisplayState}
   */
  getDisplayState() { throw new Error('Not implemented'); }

  /**
   * Handle incoming network message related to dice.
   * @param {string} type - Message type
   * @param {object} payload - Message data
   * @param {string} fromPeerId - Sender
   */
  handleMessage(type, payload, fromPeerId) { throw new Error('Not implemented'); }
}
```

#### Example Strategy: Grab and Roll (Current Behavior)

```javascript
// /src/features/dice-rolling/strategies/GrabAndRollStrategy.js

import { DiceRollingStrategy } from './DiceRollingStrategy.js';

export class GrabAndRollStrategy extends DiceRollingStrategy {
  get name() { return 'Grab and Roll'; }

  get description() {
    return 'Players grab dice sets, then roll together when all sets are held.';
  }

  async onSetClick(setId, playerId) {
    const { state, network } = this.context;
    const holder = state.holders.get(setId);

    if (!holder) {
      // Grab the set
      if (state.tryGrab(setId, playerId)) {
        network.broadcast('dice:grab', { setId, playerId });
      }
    } else if (holder.playerId === playerId && this.canRoll(playerId)) {
      // All held and I'm a holder - roll!
      await this.roll(playerId);
    }
  }

  canInteract(setId, playerId) {
    const holder = this.context.state.holders.get(setId);
    return !holder || holder.playerId === playerId;
  }

  canRoll(playerId) {
    const { state } = this.context;
    const allSetsHeld = state.diceConfig.diceSets.every(
      set => state.holders.has(set.id)
    );
    const playerHoldsAny = [...state.holders.values()].some(
      h => h.playerId === playerId
    );
    return allSetsHeld && playerHoldsAny;
  }

  async roll(playerId) {
    const { state, network } = this.context;

    // Only roll sets I hold
    const mySets = [...state.holders.entries()]
      .filter(([_, h]) => h.playerId === playerId)
      .map(([setId]) => setId);

    const rollResult = await this.context.animationService.animateRoll(mySets);

    state.applyRoll(rollResult);
    network.broadcast('dice:roll', rollResult);

    return rollResult;
  }

  getDisplayState() {
    const { state, localPlayer } = this.context;

    return {
      sets: state.diceConfig.diceSets.map(set => ({
        ...set,
        holder: state.holders.get(set.id),
        values: state.diceValues.get(set.id),
        lockedIndices: state.lockedDice.get(set.id),
        canClick: this.canInteract(set.id, localPlayer.id),
        isReadyToRoll: this.canRoll(localPlayer.id),
      })),
      showRollButton: this.canRoll(localPlayer.id),
    };
  }

  handleMessage(type, payload, fromPeerId) {
    switch (type) {
      case 'dice:grab':
        this.context.state.setHolder(payload.setId, payload.playerId);
        break;
      case 'dice:drop':
        this.context.state.clearHolder(payload.setId);
        break;
      case 'dice:roll':
        this.context.state.applyRoll(payload);
        this.context.animationService.showRoll(payload);
        break;
      case 'dice:lock':
        this.context.state.setLock(payload.setId, payload.dieIndex, payload.locked);
        break;
    }
  }
}
```

#### Alternative Strategies (Examples)

```javascript
// /src/features/dice-rolling/strategies/IndividualRollStrategy.js

/**
 * Each player has their own dice set that only they can roll.
 * Good for games where each player needs their own dice.
 */
export class IndividualRollStrategy extends DiceRollingStrategy {
  get name() { return 'Individual Roll'; }

  get description() {
    return 'Each player has their own dice set to roll independently.';
  }

  canInteract(setId, playerId) {
    // Each player can only interact with their assigned set
    return this.getAssignedSet(playerId) === setId;
  }

  canRoll(playerId) {
    // Players can always roll their own dice
    return true;
  }

  // ... implementation
}
```

```javascript
// /src/features/dice-rolling/strategies/SequentialRollStrategy.js

/**
 * Players take turns rolling. Only the current player can roll.
 * Good for turn-based games.
 */
export class SequentialRollStrategy extends DiceRollingStrategy {
  get name() { return 'Sequential Roll'; }

  get description() {
    return 'Players take turns rolling dice in order.';
  }

  canRoll(playerId) {
    return this.context.state.currentTurn === playerId;
  }

  async roll(playerId) {
    const result = await super.roll(playerId);
    this.context.state.advanceTurn();
    this.context.network.broadcast('dice:turn-advance', {
      nextPlayer: this.context.state.currentTurn
    });
    return result;
  }

  // ... implementation
}
```

```javascript
// /src/features/dice-rolling/strategies/DicePoolStrategy.js

/**
 * All dice are in a shared pool. Any player can roll at any time.
 * Simple, no coordination needed.
 */
export class DicePoolStrategy extends DiceRollingStrategy {
  get name() { return 'Dice Pool'; }

  get description() {
    return 'Anyone can roll all dice at any time.';
  }

  canInteract(setId, playerId) {
    return true; // Everyone can interact
  }

  canRoll(playerId) {
    return true; // Anyone can roll
  }

  // ... implementation
}
```

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

#### Smart Container Example

```javascript
// /src/ui/containers/DiceRollerContainer.js

export class DiceRollerContainer extends HTMLElement {
  constructor() {
    super();
    this.strategy = null;
    this.unsubscribe = null;
  }

  connectedCallback() {
    // Get injected dependencies
    this.strategy = this.closest('[data-dice-strategy]')?.diceStrategy;
    this.store = window.app.stores.dice;

    // Subscribe to state changes
    this.unsubscribe = this.store.subscribe(() => this.render());
    this.render();
  }

  disconnectedCallback() {
    this.unsubscribe?.();
  }

  render() {
    const displayState = this.strategy.getDisplayState();

    this.innerHTML = `
      <div class="dice-roller">
        ${displayState.sets.map(set => `
          <dice-set
            id="${set.id}"
            color="${set.color}"
            values="${JSON.stringify(set.values || [])}"
            locked="${JSON.stringify([...set.lockedIndices || []])}"
            holder="${set.holder?.username || ''}"
            ${set.canClick ? 'interactive' : ''}
            ${set.isReadyToRoll ? 'ready-to-roll' : ''}
          ></dice-set>
        `).join('')}

        ${displayState.showRollButton ? `
          <button class="roll-button" onclick="this.closest('dice-roller-container').handleRoll()">
            Roll Dice
          </button>
        ` : ''}
      </div>
    `;
  }

  async handleRoll() {
    await this.strategy.roll(window.app.localPlayer.id);
  }

  handleSetClick(setId) {
    this.strategy.onSetClick(setId, window.app.localPlayer.id);
  }
}

customElements.define('dice-roller-container', DiceRollerContainer);
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

With this architecture, adding a new dice rolling strategy is straightforward:

1. **Create strategy file**:
   ```javascript
   // /src/features/dice-rolling/strategies/MyNewStrategy.js
   export class MyNewStrategy extends DiceRollingStrategy {
     // Implement abstract methods
   }
   ```

2. **Register in factory**:
   ```javascript
   // /src/features/dice-rolling/strategies/index.js
   export const strategies = {
     'grab-and-roll': GrabAndRollStrategy,
     'individual': IndividualRollStrategy,
     'sequential': SequentialRollStrategy,
     'dice-pool': DicePoolStrategy,
     'my-new-strategy': MyNewStrategy,  // Add here
   };
   ```

3. **No other changes needed!**

The UI components automatically adapt because they use `strategy.getDisplayState()` and delegate actions to `strategy.onSetClick()` and `strategy.roll()`.

---

## Conclusion

This architecture provides:

1. **Smaller, focused modules** - No file over 150 lines
2. **Strategy pattern for extensibility** - Easy to add new dice rolling UX styles
3. **Clear separation of concerns** - UI, state, network, and business logic are separate
4. **Dependency injection** - Testable and configurable
5. **Reactive state** - UI automatically updates when state changes
6. **Type safety ready** - Structure supports TypeScript adoption

The migration can be done incrementally, one module at a time, allowing for continuous deployment throughout the refactoring process.
