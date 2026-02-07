import { createApp } from '../app/App.js';

// ─────────────────────────────────────────────────────────────
// LOGGING
// ─────────────────────────────────────────────────────────────

const logEl = document.getElementById('event-log');

function log(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
}

document.getElementById('clear-log').addEventListener('click', () => {
  logEl.innerHTML = '';
});

// ─────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────

// Players (simulated)
const players = {
  alice: { id: 'player-alice', username: 'Alice' },
  bob: { id: 'player-bob', username: 'Bob' },
  carol: { id: 'player-carol', username: 'Carol' },
};

let currentPlayer = players.alice;

// Mock network service
const mockNetwork = {
  broadcast: (type, payload) => {
    log(`${type}: ${JSON.stringify(payload)}`, 'info');
  },
};

// Create app
const app = createApp({
  diceConfig: {
    diceSets: [
      { id: 'red', count: 5, color: '#ef4444' },
      { id: 'blue', count: 5, color: '#3b82f6' },
    ],
  },
  localPlayer: currentPlayer,
  network: mockNetwork,
  strategyId: 'drag-pickup',
});

// Mount dice roller
app.mount('#dice-mount');

log('App initialized with DragPickup strategy', 'success');

// ─────────────────────────────────────────────────────────────
// STRATEGY SWITCHER
// ─────────────────────────────────────────────────────────────

const strategySelectorEl = document.getElementById('strategy-selector');
const btn = document.createElement('button');
btn.className = 'strategy-btn active';
btn.innerHTML = `
  <span class="strategy-btn__name">Drag to Pick Up</span>
  <span class="strategy-btn__desc">Drag across dice to pick them up, release to roll.</span>
`;
strategySelectorEl.appendChild(btn);

// ─────────────────────────────────────────────────────────────
// STATE DISPLAY
// ─────────────────────────────────────────────────────────────

function updateStateDisplay() {
  const store = app.diceStore;

  // Strategy
  document.getElementById('strategy-display').textContent = app.currentStrategyId;

  // Holders
  const holdersEl = document.getElementById('holders-display');
  if (store.holders.size === 0) {
    holdersEl.textContent = 'No holders';
  } else {
    holdersEl.textContent = [...store.holders.entries()]
      .map(([setId, h]) => `${setId}: ${h.username}`)
      .join('\n');
  }

  // Values
  const valuesEl = document.getElementById('values-display');
  if (store.diceValues.size === 0) {
    valuesEl.textContent = 'No values';
  } else {
    valuesEl.textContent = [...store.diceValues.entries()]
      .map(([setId, v]) => `${setId}: [${v.join(', ')}]`)
      .join('\n');
  }

  // Last Roller
  const rollerEl = document.getElementById('roller-display');
  if (store.lastRoller.size === 0) {
    rollerEl.textContent = 'None';
  } else {
    rollerEl.textContent = [...store.lastRoller.entries()]
      .map(([setId, r]) => `${setId}: ${r.username}`)
      .join('\n');
  }
}

// Subscribe to state changes
app.diceStore.subscribe(() => {
  updateStateDisplay();
});

updateStateDisplay();

// ─────────────────────────────────────────────────────────────
// PLAYER SWITCHING
// ─────────────────────────────────────────────────────────────

document.querySelectorAll('.player-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    // Update UI
    document.querySelectorAll('.player-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    // Switch player
    const playerId = btn.dataset.player;
    currentPlayer = players[playerId];

    // Update app's local player reference
    app.container.registerInstance('localPlayer', currentPlayer);

    // Recreate strategy with new player context
    app.setStrategy(app.currentStrategyId);

    log(`Switched to player: ${currentPlayer.username}`, 'warn');
  });
});

// ─────────────────────────────────────────────────────────────
// EXPOSE FOR DEBUGGING
// ─────────────────────────────────────────────────────────────

window.app = app;
window.players = players;

log('Access window.app in console for debugging', 'info');
