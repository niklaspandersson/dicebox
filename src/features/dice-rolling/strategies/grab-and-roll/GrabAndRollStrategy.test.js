import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GrabAndRollStrategy } from './GrabAndRollStrategy.js';
import { DiceStore } from '../../state/DiceStore.js';

describe('GrabAndRollStrategy', () => {
  let strategy;
  let state;
  let network;
  let localPlayer;
  let context;

  beforeEach(() => {
    state = new DiceStore();
    state.setConfig({
      diceSets: [
        { id: 'red', count: 5, color: '#ff0000' },
        { id: 'blue', count: 5, color: '#0000ff' },
      ],
      allowLocking: true,
    });

    network = {
      broadcast: vi.fn(),
    };

    localPlayer = {
      id: 'player1',
      username: 'Alice',
    };

    context = { state, network, localPlayer };
    strategy = new GrabAndRollStrategy(context);
  });

  describe('metadata', () => {
    it('should have name', () => {
      expect(strategy.name).toBe('Grab and Roll');
    });

    it('should have description', () => {
      expect(strategy.description).toContain('grab');
    });

    it('should have viewTagName', () => {
      expect(GrabAndRollStrategy.viewTagName).toBe('dice-grab-and-roll');
    });
  });

  describe('handleSetClick - grabbing', () => {
    it('should grab unheld set', async () => {
      await strategy.handleSetClick('red');

      expect(state.holders.get('red')).toEqual({
        playerId: 'player1',
        username: 'Alice',
      });
    });

    it('should broadcast grab message', async () => {
      await strategy.handleSetClick('red');

      expect(network.broadcast).toHaveBeenCalledWith('dice:grab', {
        setId: 'red',
        playerId: 'player1',
        username: 'Alice',
      });
    });

    it('should not grab set held by another player', async () => {
      state.setHolder('red', 'player2', 'Bob');

      await strategy.handleSetClick('red');

      expect(state.holders.get('red').playerId).toBe('player2');
      expect(network.broadcast).not.toHaveBeenCalled();
    });
  });

  describe('handleSetClick - dropping', () => {
    beforeEach(() => {
      // Player holds red set
      state.setHolder('red', 'player1', 'Alice');
    });

    it('should drop held set when not all sets held', async () => {
      await strategy.handleSetClick('red');

      expect(state.holders.has('red')).toBe(false);
      expect(network.broadcast).toHaveBeenCalledWith('dice:drop', {
        setId: 'red',
      });
    });
  });

  describe('handleSetClick - rolling', () => {
    beforeEach(() => {
      // Both sets held (player1 holds red, player2 holds blue)
      state.setHolder('red', 'player1', 'Alice');
      state.setHolder('blue', 'player2', 'Bob');
    });

    it('should roll when all sets held and clicking my set', async () => {
      await strategy.handleSetClick('red');

      // Should have rolled and broadcast
      expect(state.diceValues.has('red')).toBe(true);
      expect(network.broadcast).toHaveBeenCalledWith(
        'dice:roll',
        expect.objectContaining({
          setId: 'red',
          playerId: 'player1',
          username: 'Alice',
        })
      );
    });

    it('should generate 5 dice values', async () => {
      await strategy.handleSetClick('red');

      const values = state.diceValues.get('red');
      expect(values).toHaveLength(5);
      values.forEach((v) => {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(6);
      });
    });
  });

  describe('canRoll', () => {
    it('should return false when no sets held', () => {
      expect(strategy.canRoll()).toBe(false);
    });

    it('should return false when only some sets held', () => {
      state.setHolder('red', 'player1', 'Alice');
      expect(strategy.canRoll()).toBe(false);
    });

    it('should return false when all sets held but player holds none', () => {
      state.setHolder('red', 'player2', 'Bob');
      state.setHolder('blue', 'player3', 'Carol');
      expect(strategy.canRoll()).toBe(false);
    });

    it('should return true when all sets held and player holds at least one', () => {
      state.setHolder('red', 'player1', 'Alice');
      state.setHolder('blue', 'player2', 'Bob');
      expect(strategy.canRoll()).toBe(true);
    });
  });

  describe('canLock', () => {
    it('should return false when locking disabled', () => {
      state.setConfig({ ...state.diceConfig, allowLocking: false });
      state.setHolder('red', 'player1', 'Alice');
      state.applyRoll({ setId: 'red', values: [1, 2, 3, 4, 5], playerId: 'player1', username: 'Alice' });

      expect(strategy.canLock('red')).toBe(false);
    });

    it('should return false when holder has not rolled', () => {
      state.setHolder('red', 'player1', 'Alice');

      expect(strategy.canLock('red')).toBe(false);
    });

    it('should return true when holder has rolled', () => {
      state.setHolder('red', 'player1', 'Alice');
      state.applyRoll({ setId: 'red', values: [1, 2, 3, 4, 5], playerId: 'player1', username: 'Alice' });

      expect(strategy.canLock('red')).toBe(true);
    });

    it('should return true when not held but was last roller', () => {
      // Player rolled, then dropped
      state.applyRoll({ setId: 'red', values: [1, 2, 3, 4, 5], playerId: 'player1', username: 'Alice' });

      expect(strategy.canLock('red')).toBe(true);
    });

    it('should return false when not held and was not last roller', () => {
      state.applyRoll({ setId: 'red', values: [1, 2, 3, 4, 5], playerId: 'player2', username: 'Bob' });

      expect(strategy.canLock('red')).toBe(false);
    });
  });

  describe('handleDieLockClick', () => {
    beforeEach(() => {
      state.setHolder('red', 'player1', 'Alice');
      state.applyRoll({ setId: 'red', values: [1, 2, 3, 4, 5], playerId: 'player1', username: 'Alice' });
    });

    it('should toggle lock on die', () => {
      strategy.handleDieLockClick('red', 2);

      expect(state.lockedDice.get('red').has(2)).toBe(true);
    });

    it('should broadcast lock message', () => {
      strategy.handleDieLockClick('red', 2);

      expect(network.broadcast).toHaveBeenCalledWith('dice:lock', {
        setId: 'red',
        dieIndex: 2,
        locked: true,
      });
    });

    it('should not lock when not allowed', () => {
      state.setConfig({ ...state.diceConfig, allowLocking: false });

      strategy.handleDieLockClick('red', 2);

      expect(state.lockedDice.get('red')?.has(2)).toBeFalsy();
      expect(network.broadcast).not.toHaveBeenCalled();
    });
  });

  describe('roll with locked dice', () => {
    beforeEach(() => {
      state.setHolder('red', 'player1', 'Alice');
      state.setHolder('blue', 'player2', 'Bob');
      // Roll first
      state.applyRoll({ setId: 'red', values: [1, 2, 3, 4, 5], playerId: 'player1', username: 'Alice' });
      // Lock die at index 0 (value 1) and index 2 (value 3)
      state.setLock('red', 0, true);
      state.setLock('red', 2, true);
    });

    it('should keep locked dice values on re-roll', async () => {
      await strategy.handleSetClick('red'); // Roll again

      const values = state.diceValues.get('red');
      expect(values[0]).toBe(1); // locked
      expect(values[2]).toBe(3); // locked
      // indices 1, 3, 4 are re-rolled (random)
    });
  });

  describe('handleMessage', () => {
    it('should handle dice:grab message', () => {
      strategy.handleMessage('dice:grab', {
        setId: 'red',
        playerId: 'player2',
        username: 'Bob',
      });

      expect(state.holders.get('red')).toEqual({
        playerId: 'player2',
        username: 'Bob',
      });
    });

    it('should handle dice:drop message', () => {
      state.setHolder('red', 'player2', 'Bob');

      strategy.handleMessage('dice:drop', { setId: 'red' });

      expect(state.holders.has('red')).toBe(false);
    });

    it('should handle dice:roll message', () => {
      strategy.handleMessage('dice:roll', {
        setId: 'blue',
        values: [6, 6, 6, 6, 6],
        playerId: 'player2',
        username: 'Bob',
      });

      expect(state.diceValues.get('blue')).toEqual([6, 6, 6, 6, 6]);
    });

    it('should handle dice:lock message', () => {
      strategy.handleMessage('dice:lock', {
        setId: 'red',
        dieIndex: 3,
        locked: true,
      });

      expect(state.lockedDice.get('red').has(3)).toBe(true);
    });
  });

  describe('state serialization', () => {
    it('should get state snapshot', () => {
      state.setHolder('red', 'player1', 'Alice');
      state.applyRoll({ setId: 'red', values: [1, 2, 3, 4, 5], playerId: 'player1', username: 'Alice' });

      const snapshot = strategy.getState();

      expect(snapshot.holders).toHaveProperty('red');
      expect(snapshot.values).toHaveProperty('red');
    });

    it('should load state from snapshot', () => {
      const snapshot = {
        config: state.diceConfig,
        values: { red: [6, 6, 6, 6, 6] },
        holders: { red: { playerId: 'player2', username: 'Bob' } },
        lockedDice: {},
        lastRoller: {},
        holderHasRolled: {},
      };

      strategy.loadState(snapshot);

      expect(state.diceValues.get('red')).toEqual([6, 6, 6, 6, 6]);
      expect(state.holders.get('red').username).toBe('Bob');
    });
  });

  describe('getMySetIds', () => {
    it('should return empty array when holding nothing', () => {
      expect(strategy.getMySetIds()).toEqual([]);
    });

    it('should return set ids held by current player', () => {
      state.setHolder('red', 'player1', 'Alice');
      state.setHolder('blue', 'player2', 'Bob');

      expect(strategy.getMySetIds()).toEqual(['red']);
    });

    it('should return multiple set ids if holding multiple', () => {
      state.setHolder('red', 'player1', 'Alice');
      state.setHolder('blue', 'player1', 'Alice');

      const mySetIds = strategy.getMySetIds();
      expect(mySetIds).toContain('red');
      expect(mySetIds).toContain('blue');
      expect(mySetIds).toHaveLength(2);
    });
  });
});
