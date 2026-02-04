import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Store } from './Store.js';

describe('Store', () => {
  let store;

  beforeEach(() => {
    store = new Store({ count: 0, name: 'test' });
  });

  describe('constructor', () => {
    it('should initialize with the given state', () => {
      expect(store.state).toEqual({ count: 0, name: 'test' });
    });

    it('should work with empty initial state', () => {
      const emptyStore = new Store({});
      expect(emptyStore.state).toEqual({});
    });
  });

  describe('state getter', () => {
    it('should return current state', () => {
      expect(store.state.count).toBe(0);
      expect(store.state.name).toBe('test');
    });
  });

  describe('update', () => {
    it('should update state with partial object', () => {
      store.update({ count: 5 });
      expect(store.state.count).toBe(5);
      expect(store.state.name).toBe('test'); // unchanged
    });

    it('should update state with updater function', () => {
      store.update((state) => ({ ...state, count: state.count + 1 }));
      expect(store.state.count).toBe(1);
    });

    it('should dispatch change event on update', () => {
      const handler = vi.fn();
      store.addEventListener('change', handler);

      store.update({ count: 10 });

      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0][0];
      expect(event.detail.oldState).toEqual({ count: 0, name: 'test' });
      expect(event.detail.newState).toEqual({ count: 10, name: 'test' });
    });

    it('should handle multiple sequential updates', () => {
      store.update({ count: 1 });
      store.update({ count: 2 });
      store.update({ count: 3 });
      expect(store.state.count).toBe(3);
    });
  });

  describe('subscribe', () => {
    it('should call callback on state change', () => {
      const callback = vi.fn();
      store.subscribe(callback);

      store.update({ count: 42 });

      expect(callback).toHaveBeenCalledWith(
        { count: 42, name: 'test' },
        { count: 0, name: 'test' }
      );
    });

    it('should return unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = store.subscribe(callback);

      store.update({ count: 1 });
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      store.update({ count: 2 });
      expect(callback).toHaveBeenCalledTimes(1); // not called again
    });

    it('should support multiple subscribers', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      store.subscribe(callback1);
      store.subscribe(callback2);

      store.update({ count: 100 });

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSnapshot', () => {
    it('should return a deep clone of the state', () => {
      const snapshot = store.getSnapshot();

      expect(snapshot).toEqual(store.state);
      expect(snapshot).not.toBe(store.state); // different reference

      // Modifying snapshot should not affect store
      snapshot.count = 999;
      expect(store.state.count).toBe(0);
    });
  });

  describe('loadSnapshot', () => {
    it('should replace state with snapshot', () => {
      store.loadSnapshot({ count: 50, name: 'loaded' });

      expect(store.state).toEqual({ count: 50, name: 'loaded' });
    });

    it('should dispatch change event', () => {
      const callback = vi.fn();
      store.subscribe(callback);

      store.loadSnapshot({ count: 100, name: 'new' });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0]).toEqual({ count: 100, name: 'new' });
    });

    it('should deep clone the snapshot', () => {
      const snapshot = { count: 25, name: 'external' };
      store.loadSnapshot(snapshot);

      snapshot.count = 999;
      expect(store.state.count).toBe(25); // unaffected
    });
  });
});
