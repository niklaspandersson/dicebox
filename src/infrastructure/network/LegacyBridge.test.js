import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LegacyBridge } from './LegacyBridge.js';
import { DiceStore } from '../../features/dice-rolling/state/DiceStore.js';

// Mock MeshState for testing
function createMockMeshState() {
  const state = {
    peers: new Map(),
    rollHistory: [],
    diceConfig: null,
    holders: new Map(),
    lockedDice: new Map(),
    holderHasRolled: new Map(),
    savedDiceState: new Map(),
    lastRoller: new Map(),
    eventListeners: new Map(),

    setDiceConfig(config) {
      this.diceConfig = config;
    },
    getDiceConfig() {
      return this.diceConfig;
    },
    setHolder(setId, peerId, username) {
      this.holders.set(setId, { peerId, username });
    },
    clearAllHolders() {
      this.holders.clear();
    },
    setLastRoller(setId, peerId, username) {
      this.lastRoller.set(setId, { peerId, username });
    },
    clearLocksForSet(setId) {
      this.lockedDice.delete(setId);
    },
    lockDie(setId, dieIndex, value) {
      if (!this.lockedDice.has(setId)) {
        this.lockedDice.set(setId, {
          lockedIndices: new Set(),
          values: new Map(),
        });
      }
      const lock = this.lockedDice.get(setId);
      lock.lockedIndices.add(dieIndex);
      lock.values.set(dieIndex, value);
    },
    getSnapshot() {
      const lockedDiceSnapshot = [];
      for (const [setId, lock] of this.lockedDice) {
        lockedDiceSnapshot.push({
          setId,
          lockedIndices: [...lock.lockedIndices],
          values: [...lock.values.entries()].map(([idx, val]) => ({ idx, val })),
        });
      }

      return {
        peers: [],
        rollHistory: this.rollHistory,
        diceConfig: this.diceConfig,
        holders: Array.from(this.holders.entries()),
        lockedDice: lockedDiceSnapshot,
        holderHasRolled: Array.from(this.holderHasRolled.entries()),
        savedDiceState: [],
        lastRoller: Array.from(this.lastRoller.entries()),
      };
    },
    addEventListener(type, handler) {
      if (!this.eventListeners.has(type)) {
        this.eventListeners.set(type, new Set());
      }
      this.eventListeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      const handlers = this.eventListeners.get(type);
      if (handlers) {
        handlers.delete(handler);
      }
    },
  };

  return state;
}

describe('LegacyBridge', () => {
  let meshState;
  let diceStore;
  let bridge;

  beforeEach(() => {
    meshState = createMockMeshState();
    diceStore = new DiceStore();
    bridge = new LegacyBridge(meshState, diceStore);
  });

  describe('syncFromLegacy', () => {
    it('should sync dice config from legacy', () => {
      meshState.diceConfig = {
        diceSets: [{ id: 'red', count: 5, color: '#ff0000' }],
        allowLocking: true,
      };

      bridge.syncFromLegacy();

      expect(diceStore.diceConfig.diceSets).toHaveLength(1);
      expect(diceStore.diceConfig.diceSets[0].id).toBe('red');
    });

    it('should sync holders from legacy', () => {
      meshState.holders.set('red', { peerId: 'player-1', username: 'Alice' });

      bridge.syncFromLegacy();

      expect(diceStore.holders.get('red')).toEqual({
        playerId: 'player-1',
        username: 'Alice',
      });
    });

    it('should sync values from roll history', () => {
      meshState.diceConfig = {
        diceSets: [{ id: 'red', count: 3, color: '#ff0000' }],
      };
      meshState.rollHistory = [
        {
          setResults: [
            {
              setId: 'red',
              values: [1, 2, 3],
              holderId: 'player-1',
              holderUsername: 'Alice',
            },
          ],
        },
      ];

      bridge.syncFromLegacy();

      expect(diceStore.diceValues.get('red')).toEqual([1, 2, 3]);
      expect(diceStore.lastRoller.get('red')).toEqual({
        playerId: 'player-1',
        username: 'Alice',
      });
    });

    it('should sync locked dice from legacy', () => {
      meshState.diceConfig = {
        diceSets: [{ id: 'red', count: 3, color: '#ff0000' }],
      };
      meshState.lockedDice.set('red', {
        lockedIndices: new Set([0, 2]),
        values: new Map([
          [0, 6],
          [2, 4],
        ]),
      });

      bridge.syncFromLegacy();

      // DiceStore stores locks as Set<index>, not Map<index, value>
      expect(diceStore.lockedDice.get('red').has(0)).toBe(true);
      expect(diceStore.lockedDice.get('red').has(2)).toBe(true);
      expect(diceStore.lockedDice.get('red').has(1)).toBe(false);
    });
  });

  describe('syncToLegacy', () => {
    it('should sync dice config to legacy', () => {
      diceStore.setConfig({
        diceSets: [{ id: 'blue', count: 4, color: '#0000ff' }],
        allowLocking: false,
      });

      bridge.syncToLegacy();

      expect(meshState.diceConfig.diceSets).toHaveLength(1);
      expect(meshState.diceConfig.diceSets[0].id).toBe('blue');
    });

    it('should sync holders to legacy', () => {
      diceStore.setConfig({
        diceSets: [{ id: 'red', count: 3, color: '#ff0000' }],
      });
      diceStore.setHolder('red', 'player-2', 'Bob');

      bridge.syncToLegacy();

      expect(meshState.holders.get('red')).toEqual({
        peerId: 'player-2',
        username: 'Bob',
      });
    });

    it('should sync last roller to legacy', () => {
      diceStore.setConfig({
        diceSets: [{ id: 'red', count: 3, color: '#ff0000' }],
      });
      // Use applyRoll to set lastRoller (DiceStore doesn't have setLastRoller)
      diceStore.applyRoll({
        setId: 'red',
        values: [1, 2, 3],
        playerId: 'player-1',
        username: 'Alice',
      });

      bridge.syncToLegacy();

      expect(meshState.lastRoller.get('red')).toEqual({
        peerId: 'player-1',
        username: 'Alice',
      });
    });

    it('should sync locks to legacy', () => {
      diceStore.setConfig({
        diceSets: [{ id: 'red', count: 3, color: '#ff0000' }],
      });
      // Set values first, then lock (values are used for the lock value)
      diceStore.setValues('red', [3, 5, 2]);
      diceStore.setLock('red', 1, true);

      bridge.syncToLegacy();

      const lock = meshState.lockedDice.get('red');
      expect(lock.lockedIndices.has(1)).toBe(true);
      expect(lock.values.get(1)).toBe(5); // Value from diceValues[1]
    });
  });

  describe('enableTwoWaySync', () => {
    it('should sync to legacy when dice store changes', () => {
      diceStore.setConfig({
        diceSets: [{ id: 'red', count: 3, color: '#ff0000' }],
      });

      bridge.enableTwoWaySync();

      // Make a change in the new store
      diceStore.setHolder('red', 'player-1', 'Alice');

      // Check that legacy was updated
      expect(meshState.holders.get('red')).toEqual({
        peerId: 'player-1',
        username: 'Alice',
      });
    });

    it('should not create infinite loops during sync', () => {
      diceStore.setConfig({
        diceSets: [{ id: 'red', count: 3, color: '#ff0000' }],
      });

      bridge.enableTwoWaySync();

      // This should not cause infinite recursion
      diceStore.setHolder('red', 'player-1', 'Alice');
      diceStore.setHolder('red', 'player-2', 'Bob');

      expect(meshState.holders.get('red').peerId).toBe('player-2');
    });
  });

  describe('disableSync', () => {
    it('should stop syncing after disable', () => {
      diceStore.setConfig({
        diceSets: [{ id: 'red', count: 3, color: '#ff0000' }],
      });

      bridge.enableTwoWaySync();
      bridge.disableSync();

      // Changes should no longer sync
      diceStore.setHolder('red', 'player-1', 'Alice');

      expect(meshState.holders.has('red')).toBe(false);
    });
  });

  describe('static message converters', () => {
    describe('convertRollMessage', () => {
      it('should convert legacy roll to new format', () => {
        const legacyRoll = {
          rollId: 'roll-123',
          timestamp: 1234567890,
          total: 15,
          setResults: [
            {
              setId: 'red',
              values: [5, 4, 6],
              holderId: 'player-1',
              holderUsername: 'Alice',
              color: '#ff0000',
            },
          ],
        };

        const result = LegacyBridge.convertRollMessage(legacyRoll);

        expect(result.rollId).toBe('roll-123');
        expect(result.total).toBe(15);
        expect(result.setResults[0].playerId).toBe('player-1');
        expect(result.setResults[0].username).toBe('Alice');
      });
    });

    describe('convertToLegacyRoll', () => {
      it('should convert new roll to legacy format', () => {
        const newRoll = {
          setId: 'red',
          values: [1, 2, 3],
          playerId: 'player-1',
          username: 'Alice',
        };

        const result = LegacyBridge.convertToLegacyRoll(newRoll);

        expect(result.setResults[0].setId).toBe('red');
        expect(result.setResults[0].holderId).toBe('player-1');
        expect(result.setResults[0].holderUsername).toBe('Alice');
        expect(result.total).toBe(6);
      });

      it('should handle multiple set results', () => {
        const newRoll = {
          setResults: [
            { setId: 'red', values: [1, 2], playerId: 'p1', username: 'Alice' },
            { setId: 'blue', values: [3, 4], playerId: 'p2', username: 'Bob' },
          ],
        };

        const result = LegacyBridge.convertToLegacyRoll(newRoll);

        expect(result.setResults).toHaveLength(2);
        expect(result.setResults[0].setId).toBe('red');
        expect(result.setResults[1].setId).toBe('blue');
      });
    });

    describe('convertGrabMessage', () => {
      it('should convert legacy grab to new format', () => {
        const legacyGrab = {
          setId: 'red',
          peerId: 'player-1',
          username: 'Alice',
        };

        const result = LegacyBridge.convertGrabMessage(legacyGrab);

        expect(result.setId).toBe('red');
        expect(result.playerId).toBe('player-1');
        expect(result.username).toBe('Alice');
      });
    });

    describe('convertToLegacyGrab', () => {
      it('should convert new grab to legacy format', () => {
        const newGrab = {
          setId: 'red',
          playerId: 'player-1',
          username: 'Alice',
        };

        const result = LegacyBridge.convertToLegacyGrab(newGrab);

        expect(result.setId).toBe('red');
        expect(result.peerId).toBe('player-1');
        expect(result.username).toBe('Alice');
      });
    });
  });
});
