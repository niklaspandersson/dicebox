import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageBus } from './MessageBus.js';

describe('MessageBus', () => {
  let bus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  describe('on', () => {
    it('should register a handler for a message type', async () => {
      const handler = vi.fn();
      bus.on('test', handler);

      await bus.dispatch({ type: 'test', payload: { data: 123 } });

      expect(handler).toHaveBeenCalledWith({ data: 123 }, {});
    });

    it('should support multiple handlers for same type', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bus.on('test', handler1);
      bus.on('test', handler2);

      await bus.dispatch({ type: 'test', payload: 'hello' });

      expect(handler1).toHaveBeenCalledWith('hello', {});
      expect(handler2).toHaveBeenCalledWith('hello', {});
    });

    it('should return unsubscribe function', async () => {
      const handler = vi.fn();
      const unsubscribe = bus.on('test', handler);

      await bus.dispatch({ type: 'test', payload: null });
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();

      await bus.dispatch({ type: 'test', payload: null });
      expect(handler).toHaveBeenCalledTimes(1); // not called again
    });

    it('should pass context to handler', async () => {
      const handler = vi.fn();
      bus.on('test', handler);

      await bus.dispatch(
        { type: 'test', payload: {} },
        { fromPeerId: 'peer123', timestamp: 1234567890 }
      );

      expect(handler).toHaveBeenCalledWith(
        {},
        { fromPeerId: 'peer123', timestamp: 1234567890 }
      );
    });
  });

  describe('once', () => {
    it('should only call handler once', async () => {
      const handler = vi.fn();
      bus.once('test', handler);

      await bus.dispatch({ type: 'test', payload: 1 });
      await bus.dispatch({ type: 'test', payload: 2 });
      await bus.dispatch({ type: 'test', payload: 3 });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(1, {});
    });

    it('should return unsubscribe function', async () => {
      const handler = vi.fn();
      const unsubscribe = bus.once('test', handler);

      unsubscribe(); // unsubscribe before any dispatch

      await bus.dispatch({ type: 'test', payload: 'should not receive' });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('dispatch', () => {
    it('should do nothing if no handlers registered', async () => {
      // Should not throw
      await expect(
        bus.dispatch({ type: 'unknown', payload: {} })
      ).resolves.toBeUndefined();
    });

    it('should handle async handlers', async () => {
      const results = [];

      bus.on('test', async (payload) => {
        await new Promise((r) => setTimeout(r, 10));
        results.push('first');
      });

      bus.on('test', async (payload) => {
        results.push('second');
      });

      await bus.dispatch({ type: 'test', payload: null });

      // Both should have completed
      expect(results).toContain('first');
      expect(results).toContain('second');
    });

    it('should call handlers in parallel', async () => {
      const startTimes = [];
      const endTimes = [];

      bus.on('test', async () => {
        startTimes.push(Date.now());
        await new Promise((r) => setTimeout(r, 50));
        endTimes.push(Date.now());
      });

      bus.on('test', async () => {
        startTimes.push(Date.now());
        await new Promise((r) => setTimeout(r, 50));
        endTimes.push(Date.now());
      });

      await bus.dispatch({ type: 'test', payload: null });

      // Both should have started at roughly the same time (within 10ms)
      expect(Math.abs(startTimes[0] - startTimes[1])).toBeLessThan(20);
    });
  });

  describe('middleware', () => {
    it('should call middleware before handlers', async () => {
      const order = [];

      bus.use(async (message) => {
        order.push('middleware');
        return message;
      });

      bus.on('test', () => {
        order.push('handler');
      });

      await bus.dispatch({ type: 'test', payload: null });

      expect(order).toEqual(['middleware', 'handler']);
    });

    it('should allow middleware to modify message', async () => {
      const handler = vi.fn();

      bus.use(async (message) => ({
        ...message,
        payload: { ...message.payload, modified: true },
      }));

      bus.on('test', handler);

      await bus.dispatch({ type: 'test', payload: { original: true } });

      expect(handler).toHaveBeenCalledWith(
        { original: true, modified: true },
        {}
      );
    });

    it('should allow middleware to halt dispatch by returning null', async () => {
      const handler = vi.fn();

      bus.use(async (message) => {
        if (message.payload.blocked) {
          return null; // halt
        }
        return message;
      });

      bus.on('test', handler);

      await bus.dispatch({ type: 'test', payload: { blocked: true } });
      expect(handler).not.toHaveBeenCalled();

      await bus.dispatch({ type: 'test', payload: { blocked: false } });
      expect(handler).toHaveBeenCalled();
    });

    it('should call middlewares in order', async () => {
      const order = [];

      bus.use(async (message) => {
        order.push('first');
        return message;
      });

      bus.use(async (message) => {
        order.push('second');
        return message;
      });

      bus.use(async (message) => {
        order.push('third');
        return message;
      });

      bus.on('test', () => order.push('handler'));

      await bus.dispatch({ type: 'test', payload: null });

      expect(order).toEqual(['first', 'second', 'third', 'handler']);
    });

    it('should receive context in middleware', async () => {
      const middleware = vi.fn((message) => message);
      bus.use(middleware);
      bus.on('test', () => {});

      await bus.dispatch({ type: 'test', payload: null }, { peerId: '123' });

      expect(middleware).toHaveBeenCalledWith(
        { type: 'test', payload: null },
        { peerId: '123' }
      );
    });
  });

  describe('hasHandlers', () => {
    it('should return false when no handlers', () => {
      expect(bus.hasHandlers('test')).toBe(false);
    });

    it('should return true when handlers exist', () => {
      bus.on('test', () => {});
      expect(bus.hasHandlers('test')).toBe(true);
    });

    it('should return false after all handlers unsubscribed', () => {
      const unsub = bus.on('test', () => {});
      expect(bus.hasHandlers('test')).toBe(true);

      unsub();
      expect(bus.hasHandlers('test')).toBe(false);
    });
  });

  describe('handlerCount', () => {
    it('should return 0 when no handlers', () => {
      expect(bus.handlerCount('test')).toBe(0);
    });

    it('should return correct count', () => {
      bus.on('test', () => {});
      bus.on('test', () => {});
      bus.on('test', () => {});

      expect(bus.handlerCount('test')).toBe(3);
    });
  });

  describe('off', () => {
    it('should remove all handlers for a type', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bus.on('test', handler1);
      bus.on('test', handler2);

      bus.off('test');

      await bus.dispatch({ type: 'test', payload: null });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('should remove all handlers and middlewares', async () => {
      const handler = vi.fn();
      const middleware = vi.fn((m) => m);

      bus.on('test1', handler);
      bus.on('test2', handler);
      bus.use(middleware);

      bus.clear();

      await bus.dispatch({ type: 'test1', payload: null });

      expect(handler).not.toHaveBeenCalled();
      expect(middleware).not.toHaveBeenCalled();
      expect(bus.hasHandlers('test1')).toBe(false);
      expect(bus.hasHandlers('test2')).toBe(false);
    });
  });

  describe('real-world usage', () => {
    it('should work with typical dice app messages', async () => {
      const rollHandler = vi.fn();
      const grabHandler = vi.fn();
      const logMiddleware = vi.fn((m) => m);

      // Setup
      bus.use(logMiddleware);
      bus.on('dice:roll', rollHandler);
      bus.on('dice:grab', grabHandler);

      // Dispatch messages
      await bus.dispatch(
        { type: 'dice:grab', payload: { setId: 'red', playerId: 'p1' } },
        { fromPeerId: 'peer1' }
      );

      await bus.dispatch(
        { type: 'dice:roll', payload: { setId: 'red', values: [1, 2, 3, 4, 5] } },
        { fromPeerId: 'peer1' }
      );

      expect(grabHandler).toHaveBeenCalledWith(
        { setId: 'red', playerId: 'p1' },
        { fromPeerId: 'peer1' }
      );

      expect(rollHandler).toHaveBeenCalledWith(
        { setId: 'red', values: [1, 2, 3, 4, 5] },
        { fromPeerId: 'peer1' }
      );

      expect(logMiddleware).toHaveBeenCalledTimes(2);
    });
  });
});
