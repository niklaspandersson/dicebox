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
| `DiceRoller` | 617 | UI rendering, animation, state all intertwined |
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
  │   └── drag-pickup/            - Drag across dice to pick up and roll
  │       ├── DragPickupStrategy.js
  │       └── DragPickupView.js   - Touch/mouse drag UI
  │
  ├── state/                      - Shared state management
  │   ├── DiceState.js            - Current dice values
  │   └── RollHistory.js          - Past rolls
  │
  └── services/                   - Shared services
      ├── DiceAnimationService.js - Animation timing (shared)
      ├── DiceRandomService.js    - RNG (crypto.getRandomValues)
      └── DiceSyncService.js      - State synchronization helpers
```

#### Strategy Interface

The strategy uses a **View Factory pattern** - each strategy provides its own view component.

The `DiceRollingStrategy` abstract base class defines the interface that any strategy must implement:
- `name` / `description` - Metadata
- `createView()` - Factory method returning a Web Component
- `static viewTagName` / `static viewComponent` - For custom element registration
- `roll()` / `handleMessage()` / `getState()` / `loadState()` - Core logic
- `activate()` / `deactivate()` - Lifecycle hooks

The current implementation uses the **Drag to Pick Up** strategy (`DragPickupStrategy`), which provides a touch/mouse-friendly interaction where users drag across dice to pick them up and release to roll.

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
  config: { diceSets: [] },
  values: new Map(),      // setId -> number[]
  holders: new Map(),     // setId -> { playerId, username }
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
    return ['value', 'color', 'rolling', 'selected'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const value = this.getAttribute('value') || '';
    const color = this.getAttribute('color') || '#ffffff';
    const selected = this.hasAttribute('selected');
    const rolling = this.hasAttribute('rolling');

    this.innerHTML = `
      <div class="die ${selected ? 'die--selected' : ''} ${rolling ? 'die--rolling' : ''}"
           style="--die-color: ${color}">
        ${this.renderFace(value)}
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
    return ['value', 'color', 'rolling', 'selected'];
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const value = this.getAttribute('value') || '';
    const selected = this.hasAttribute('selected');
    const color = this.getAttribute('color') || '#ffffff';
    const rolling = this.hasAttribute('rolling');

    this.innerHTML = `
      <div class="die
                  ${selected ? 'die--selected' : ''}
                  ${rolling ? 'die--rolling' : ''}"
           style="--die-color: ${color}">
        ${this.#renderFace(value)}
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
container.register('diceStrategy', (c) => new DragPickupStrategy({
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
  │   │   ├── strategies/         (strategy + view files, ~150 lines each)
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
| Dice strategy | 3 | 150 | 450 |
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
2. Implement DragPickupStrategy (current behavior)
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

import { DragPickupStrategy } from './drag-pickup/DragPickupStrategy.js';
import { MyNewStrategy } from './my-new-strategy/MyNewStrategy.js';

export const strategies = {
  'drag-pickup': DragPickupStrategy,
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

By letting each strategy provide its own view, we get:

- **Maximum flexibility** - Any UX paradigm is possible
- **Clean encapsulation** - Strategy + view are a cohesive unit
- **Easy testing** - Test strategy logic and view separately
- **Independent evolution** - Change one strategy without touching others

The migration can be done incrementally, one module at a time, allowing for continuous deployment throughout the refactoring process.
