import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from './Container.js';

describe('Container', () => {
  let container;

  beforeEach(() => {
    container = new Container();
  });

  describe('registerInstance', () => {
    it('should register an instance directly', () => {
      const service = { name: 'TestService' };
      container.registerInstance('test', service);

      expect(container.get('test')).toBe(service);
    });

    it('should return same instance on multiple gets', () => {
      const service = { name: 'TestService' };
      container.registerInstance('test', service);

      expect(container.get('test')).toBe(container.get('test'));
    });
  });

  describe('register (factory)', () => {
    it('should register a factory function', () => {
      const factory = vi.fn(() => ({ name: 'Created' }));
      container.register('test', factory);

      const instance = container.get('test');

      expect(instance.name).toBe('Created');
      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('should only call factory once (lazy singleton)', () => {
      const factory = vi.fn(() => ({ id: Math.random() }));
      container.register('test', factory);

      const first = container.get('test');
      const second = container.get('test');
      const third = container.get('test');

      expect(factory).toHaveBeenCalledTimes(1);
      expect(first).toBe(second);
      expect(second).toBe(third);
    });

    it('should pass container to factory for dependency resolution', () => {
      container.registerInstance('config', { url: 'http://test.com' });
      container.register('api', (c) => ({
        baseUrl: c.get('config').url,
      }));

      const api = container.get('api');

      expect(api.baseUrl).toBe('http://test.com');
    });

    it('should support dependency chains', () => {
      container.registerInstance('config', { port: 3000 });
      container.register('database', (c) => ({
        port: c.get('config').port,
        connected: true,
      }));
      container.register('userService', (c) => ({
        db: c.get('database'),
        getUser: () => 'User from DB',
      }));

      const userService = container.get('userService');

      expect(userService.db.connected).toBe(true);
      expect(userService.db.port).toBe(3000);
      expect(userService.getUser()).toBe('User from DB');
    });
  });

  describe('get', () => {
    it('should throw error for unknown service', () => {
      expect(() => container.get('unknown')).toThrow('Service not found: unknown');
    });
  });

  describe('has', () => {
    it('should return true for registered instance', () => {
      container.registerInstance('test', {});
      expect(container.has('test')).toBe(true);
    });

    it('should return true for registered factory', () => {
      container.register('test', () => ({}));
      expect(container.has('test')).toBe(true);
    });

    it('should return false for unregistered service', () => {
      expect(container.has('unknown')).toBe(false);
    });
  });

  describe('remove', () => {
    it('should remove registered instance', () => {
      container.registerInstance('test', {});
      container.remove('test');

      expect(container.has('test')).toBe(false);
    });

    it('should remove registered factory', () => {
      container.register('test', () => ({}));
      container.remove('test');

      expect(container.has('test')).toBe(false);
    });

    it('should remove instantiated service', () => {
      container.register('test', () => ({ value: 1 }));
      container.get('test'); // instantiate
      container.remove('test');

      expect(container.has('test')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all services', () => {
      container.registerInstance('a', {});
      container.register('b', () => ({}));
      container.registerInstance('c', {});

      container.clear();

      expect(container.has('a')).toBe(false);
      expect(container.has('b')).toBe(false);
      expect(container.has('c')).toBe(false);
    });
  });

  describe('real-world usage example', () => {
    it('should work with typical app setup', () => {
      // Simulate real app setup
      class MockNetworkService {
        constructor(config) {
          this.url = config.wsUrl;
        }
        broadcast(msg) {
          return `Sent: ${msg}`;
        }
      }

      class MockDiceStore {
        constructor() {
          this.values = new Map();
        }
      }

      class MockStrategy {
        constructor(ctx) {
          this.context = ctx;
        }
      }

      // Setup container
      container.registerInstance('config', { wsUrl: 'ws://localhost:8080' });
      container.register('network', (c) => new MockNetworkService(c.get('config')));
      container.register('diceStore', () => new MockDiceStore());
      container.registerInstance('localPlayer', { id: 'p1', username: 'TestUser' });
      container.register('strategy', (c) => new MockStrategy({
        state: c.get('diceStore'),
        network: c.get('network'),
        localPlayer: c.get('localPlayer'),
      }));

      // Use container
      const strategy = container.get('strategy');

      expect(strategy.context.state).toBeInstanceOf(MockDiceStore);
      expect(strategy.context.network.url).toBe('ws://localhost:8080');
      expect(strategy.context.localPlayer.username).toBe('TestUser');
    });
  });
});
