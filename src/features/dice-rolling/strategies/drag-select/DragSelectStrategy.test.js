import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DragSelectStrategy } from './DragSelectStrategy.js';
import { DiceStore } from '../../state/DiceStore.js';

describe('DragSelectStrategy', () => {
  let strategy;
  let state;
  let network;
  let localPlayer;
  let context;

  beforeEach(() => {
    state = new DiceStore();
    state.setConfig({
      diceSets: [
        { id: 'red', count: 3, color: '#ff0000' },
        { id: 'blue', count: 2, color: '#0000ff' },
      ],
      allowLocking: false,
    });

    network = {
      broadcast: vi.fn(),
    };

    localPlayer = {
      id: 'player1',
      username: 'Alice',
    };

    context = { state, network, localPlayer };
    strategy = new DragSelectStrategy(context);
  });

  describe('metadata', () => {
    it('should have name', () => {
      expect(strategy.name).toBe('Drag to Select');
    });

    it('should have description', () => {
      expect(strategy.description).toContain('Drag');
    });

    it('should have viewTagName', () => {
      expect(DragSelectStrategy.viewTagName).toBe('dice-drag-select');
    });
  });

  describe('selection', () => {
    it('should start with empty selection', () => {
      expect(strategy.getSelection().size).toBe(0);
    });

    it('should update selection', () => {
      strategy.updateSelection(['red-0', 'red-1', 'blue-0']);

      const selection = strategy.getSelection();
      expect(selection.size).toBe(3);
      expect(selection.has('red-0')).toBe(true);
      expect(selection.has('red-1')).toBe(true);
      expect(selection.has('blue-0')).toBe(true);
    });

    it('should add to selection', () => {
      strategy.addToSelection('red-0');
      strategy.addToSelection('blue-1');

      expect(strategy.isSelected('red-0')).toBe(true);
      expect(strategy.isSelected('blue-1')).toBe(true);
      expect(strategy.isSelected('red-1')).toBe(false);
    });

    it('should remove from selection', () => {
      strategy.updateSelection(['red-0', 'red-1']);
      strategy.removeFromSelection('red-0');

      expect(strategy.isSelected('red-0')).toBe(false);
      expect(strategy.isSelected('red-1')).toBe(true);
    });

    it('should toggle selection', () => {
      strategy.toggleSelection('red-0');
      expect(strategy.isSelected('red-0')).toBe(true);

      strategy.toggleSelection('red-0');
      expect(strategy.isSelected('red-0')).toBe(false);
    });

    it('should clear selection', () => {
      strategy.updateSelection(['red-0', 'red-1', 'blue-0']);
      strategy.clearSelection();

      expect(strategy.getSelection().size).toBe(0);
    });

    it('should notify on selection change', () => {
      const callback = vi.fn();
      strategy.onSelectionChange(callback);

      strategy.updateSelection(['red-0']);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(new Set(['red-0']));
    });

    it('should allow unsubscribe from selection changes', () => {
      const callback = vi.fn();
      const unsubscribe = strategy.onSelectionChange(callback);

      strategy.updateSelection(['red-0']);
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      strategy.updateSelection(['red-1']);
      expect(callback).toHaveBeenCalledTimes(1); // not called again
    });
  });

  describe('getAllDice', () => {
    it('should return all dice with IDs', () => {
      const dice = strategy.getAllDice();

      expect(dice).toHaveLength(5); // 3 red + 2 blue
      expect(dice[0]).toMatchObject({ id: 'red-0', setId: 'red', index: 0, color: '#ff0000' });
      expect(dice[3]).toMatchObject({ id: 'blue-0', setId: 'blue', index: 0, color: '#0000ff' });
    });

    it('should include values when available', () => {
      state.setValues('red', [1, 2, 3]);

      const dice = strategy.getAllDice();
      const redDice = dice.filter(d => d.setId === 'red');

      expect(redDice[0].value).toBe(1);
      expect(redDice[1].value).toBe(2);
      expect(redDice[2].value).toBe(3);
    });
  });

  describe('rolling', () => {
    it('should roll selected dice only', async () => {
      // Set initial values
      state.setValues('red', [1, 1, 1]);
      state.setValues('blue', [1, 1]);

      // Select only red-0 and red-2
      strategy.updateSelection(['red-0', 'red-2']);

      await strategy.rollSelection();

      const redValues = state.diceValues.get('red');
      // red-1 should still be 1 (not selected)
      expect(redValues[1]).toBe(1);
      // red-0 and red-2 were rolled (might still be 1 by chance, but the roll happened)

      // Blue should be unchanged
      const blueValues = state.diceValues.get('blue');
      expect(blueValues).toEqual([1, 1]);
    });

    it('should broadcast roll message', async () => {
      strategy.updateSelection(['red-0']);

      await strategy.rollSelection();

      expect(network.broadcast).toHaveBeenCalledWith('dice:roll', expect.objectContaining({
        setId: 'red',
        playerId: 'player1',
        username: 'Alice',
      }));
    });

    it('should clear selection after rolling', async () => {
      strategy.updateSelection(['red-0', 'red-1']);

      await strategy.rollSelection();

      expect(strategy.getSelection().size).toBe(0);
    });

    it('should return null if no selection', async () => {
      const result = await strategy.rollSelection();
      expect(result).toBeNull();
    });

    it('should roll dice from multiple sets', async () => {
      strategy.updateSelection(['red-0', 'blue-0']);

      await strategy.rollSelection();

      // Should have broadcast twice (once per set)
      expect(network.broadcast).toHaveBeenCalledTimes(2);
      expect(network.broadcast).toHaveBeenCalledWith('dice:roll', expect.objectContaining({ setId: 'red' }));
      expect(network.broadcast).toHaveBeenCalledWith('dice:roll', expect.objectContaining({ setId: 'blue' }));
    });

    it('should include rolledIndices in result', async () => {
      strategy.updateSelection(['red-0', 'red-2']);

      await strategy.rollSelection();

      expect(network.broadcast).toHaveBeenCalledWith('dice:roll', expect.objectContaining({
        rolledIndices: expect.arrayContaining([0, 2]),
      }));
    });
  });

  describe('rollAll', () => {
    it('should roll all dice', async () => {
      await strategy.rollAll();

      // Both sets should have values
      expect(state.diceValues.has('red')).toBe(true);
      expect(state.diceValues.has('blue')).toBe(true);

      // Broadcast should have been called for each set
      expect(network.broadcast).toHaveBeenCalledWith('dice:roll', expect.objectContaining({ setId: 'red' }));
      expect(network.broadcast).toHaveBeenCalledWith('dice:roll', expect.objectContaining({ setId: 'blue' }));
    });

    it('should clear selection after rollAll', async () => {
      await strategy.rollAll();
      expect(strategy.getSelection().size).toBe(0);
    });
  });

  describe('handleMessage', () => {
    it('should handle dice:roll message', () => {
      strategy.handleMessage('dice:roll', {
        setId: 'red',
        values: [6, 6, 6],
        playerId: 'player2',
        username: 'Bob',
      });

      expect(state.diceValues.get('red')).toEqual([6, 6, 6]);
    });

    it('should ignore unknown message types', () => {
      // Should not throw
      strategy.handleMessage('unknown:type', {});
    });

    it('should not handle grab/drop messages (not used in this strategy)', () => {
      // These shouldn't affect state
      strategy.handleMessage('dice:grab', { setId: 'red', playerId: 'p2' });
      expect(state.holders.size).toBe(0);
    });
  });

  describe('state serialization', () => {
    it('should get state snapshot', () => {
      state.setValues('red', [1, 2, 3]);
      state.setValues('blue', [4, 5]);

      const snapshot = strategy.getState();

      expect(snapshot.values).toEqual({
        red: [1, 2, 3],
        blue: [4, 5],
      });
    });

    it('should load state from snapshot', () => {
      const snapshot = {
        values: {
          red: [6, 6, 6],
          blue: [5, 5],
        },
      };

      strategy.loadState(snapshot);

      expect(state.diceValues.get('red')).toEqual([6, 6, 6]);
      expect(state.diceValues.get('blue')).toEqual([5, 5]);
    });
  });

  describe('lifecycle', () => {
    it('should clear selection on activate', () => {
      strategy.updateSelection(['red-0']);
      strategy.activate();

      expect(strategy.getSelection().size).toBe(0);
    });

    it('should clear selection and listeners on deactivate', () => {
      const callback = vi.fn();
      strategy.onSelectionChange(callback);
      strategy.updateSelection(['red-0']);

      expect(callback).toHaveBeenCalledTimes(1); // from updateSelection

      strategy.deactivate();

      expect(strategy.getSelection().size).toBe(0);

      // Listener should be removed - this should NOT trigger callback
      strategy.updateSelection(['red-1']);
      // callback was called once before deactivate, and once during deactivate's clearSelection
      // but NOT for the updateSelection after deactivate
      expect(callback).toHaveBeenCalledTimes(2);
    });
  });

  describe('comparison with GrabAndRoll', () => {
    it('should not use holders (unlike GrabAndRoll)', () => {
      // DragSelect doesn't use the holder concept
      expect(state.holders.size).toBe(0);

      // Roll should work without grabbing
      strategy.updateSelection(['red-0']);
      strategy.rollSelection();

      // Still no holders
      expect(state.holders.size).toBe(0);
    });

    it('should allow any dice to be rolled anytime', async () => {
      // In GrabAndRoll, you need to grab first
      // In DragSelect, just select and roll
      strategy.updateSelection(['red-0', 'red-1', 'blue-0']);

      const result = await strategy.rollSelection();

      expect(result).not.toBeNull();
      expect(result.length).toBe(2); // 2 sets were rolled
    });
  });
});
