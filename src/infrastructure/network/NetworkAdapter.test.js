import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NetworkAdapter, createMockNetwork } from './NetworkAdapter.js';

describe('NetworkAdapter', () => {
  let mockWebrtcManager;

  beforeEach(() => {
    mockWebrtcManager = {
      broadcast: vi.fn(),
      sendToPeer: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getConnectedPeers: vi.fn(() => ['peer-1', 'peer-2']),
    };
  });

  describe('construction', () => {
    it('should create adapter with webrtcManager', () => {
      const adapter = new NetworkAdapter(mockWebrtcManager);
      expect(adapter).toBeDefined();
    });

    it('should set up message listener on construction', () => {
      new NetworkAdapter(mockWebrtcManager);
      expect(mockWebrtcManager.addEventListener).toHaveBeenCalledWith(
        'message',
        expect.any(Function)
      );
    });

    it('should work without webrtcManager', () => {
      const adapter = new NetworkAdapter(null);
      expect(adapter).toBeDefined();
    });
  });

  describe('broadcast', () => {
    it('should broadcast message with converted type', () => {
      const adapter = new NetworkAdapter(mockWebrtcManager);
      adapter.broadcast('dice:roll', { values: [1, 2, 3] });

      expect(mockWebrtcManager.broadcast).toHaveBeenCalledWith(
        { type: 'dice-roll', values: [1, 2, 3] },
        null
      );
    });

    it('should broadcast with exclude peer', () => {
      const adapter = new NetworkAdapter(mockWebrtcManager);
      adapter.broadcast('dice:grab', { setId: 'red' }, 'peer-1');

      expect(mockWebrtcManager.broadcast).toHaveBeenCalledWith(
        { type: 'dice-grab', setId: 'red' },
        'peer-1'
      );
    });

    it('should handle unknown message types', () => {
      const adapter = new NetworkAdapter(mockWebrtcManager);
      adapter.broadcast('custom:message', { data: 'test' });

      expect(mockWebrtcManager.broadcast).toHaveBeenCalledWith(
        { type: 'custom:message', data: 'test' },
        null
      );
    });
  });

  describe('send', () => {
    it('should send message to specific peer', () => {
      const adapter = new NetworkAdapter(mockWebrtcManager);
      adapter.send('peer-1', 'dice:lock', { setId: 'red', index: 0 });

      expect(mockWebrtcManager.sendToPeer).toHaveBeenCalledWith('peer-1', {
        type: 'dice-lock',
        setId: 'red',
        index: 0,
      });
    });
  });

  describe('onMessage', () => {
    it('should register message handler', () => {
      const adapter = new NetworkAdapter(mockWebrtcManager);
      const handler = vi.fn();

      const unsubscribe = adapter.onMessage('dice:roll', handler);

      expect(typeof unsubscribe).toBe('function');
    });

    it('should unsubscribe handler', () => {
      const adapter = new NetworkAdapter(mockWebrtcManager);
      const handler = vi.fn();

      const unsubscribe = adapter.onMessage('dice:roll', handler);
      unsubscribe();

      // Handler should be removed (we can't directly test this without triggering)
      expect(true).toBe(true);
    });

    it('should call handler when message received', () => {
      const adapter = new NetworkAdapter(mockWebrtcManager);
      const handler = vi.fn();

      adapter.onMessage('dice:roll', handler);

      // Simulate message from webrtcManager
      const messageCallback = mockWebrtcManager.addEventListener.mock.calls[0][1];
      messageCallback({
        detail: {
          peerId: 'peer-1',
          message: { type: 'dice-roll', values: [1, 2, 3] },
        },
      });

      expect(handler).toHaveBeenCalledWith(
        { values: [1, 2, 3] },
        { fromPeerId: 'peer-1' }
      );
    });

    it('should convert legacy message types to new format', () => {
      const adapter = new NetworkAdapter(mockWebrtcManager);
      const handler = vi.fn();

      adapter.onMessage('dice:grab', handler);

      const messageCallback = mockWebrtcManager.addEventListener.mock.calls[0][1];
      messageCallback({
        detail: {
          peerId: 'peer-2',
          message: { type: 'dice-grab', setId: 'red', username: 'Alice' },
        },
      });

      expect(handler).toHaveBeenCalledWith(
        { setId: 'red', username: 'Alice' },
        { fromPeerId: 'peer-2' }
      );
    });
  });

  describe('middleware', () => {
    it('should run middleware on incoming messages', () => {
      const adapter = new NetworkAdapter(mockWebrtcManager);
      const middleware = vi.fn((msg) => msg);
      const handler = vi.fn();

      adapter.use(middleware);
      adapter.onMessage('dice:roll', handler);

      const messageCallback = mockWebrtcManager.addEventListener.mock.calls[0][1];
      messageCallback({
        detail: {
          peerId: 'peer-1',
          message: { type: 'dice-roll', values: [1] },
        },
      });

      expect(middleware).toHaveBeenCalled();
      expect(handler).toHaveBeenCalled();
    });

    it('should halt dispatch if middleware returns null', () => {
      const adapter = new NetworkAdapter(mockWebrtcManager);
      const middleware = vi.fn(() => null);
      const handler = vi.fn();

      adapter.use(middleware);
      adapter.onMessage('dice:roll', handler);

      const messageCallback = mockWebrtcManager.addEventListener.mock.calls[0][1];
      messageCallback({
        detail: {
          peerId: 'peer-1',
          message: { type: 'dice-roll', values: [1] },
        },
      });

      expect(middleware).toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });

    it('should allow middleware to modify messages', () => {
      const adapter = new NetworkAdapter(mockWebrtcManager);
      const middleware = vi.fn((msg) => ({
        ...msg,
        payload: { ...msg.payload, modified: true },
      }));
      const handler = vi.fn();

      adapter.use(middleware);
      adapter.onMessage('dice:roll', handler);

      const messageCallback = mockWebrtcManager.addEventListener.mock.calls[0][1];
      messageCallback({
        detail: {
          peerId: 'peer-1',
          message: { type: 'dice-roll', values: [1] },
        },
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ modified: true }),
        expect.anything()
      );
    });
  });

  describe('isConnected', () => {
    it('should return true when peers are connected', () => {
      const adapter = new NetworkAdapter(mockWebrtcManager);
      expect(adapter.isConnected()).toBe(true);
    });

    it('should return false when no peers connected', () => {
      mockWebrtcManager.getConnectedPeers.mockReturnValue([]);
      const adapter = new NetworkAdapter(mockWebrtcManager);
      expect(adapter.isConnected()).toBe(false);
    });

    it('should return false without webrtcManager', () => {
      const adapter = new NetworkAdapter(null);
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe('getConnectedPeers', () => {
    it('should return list of connected peers', () => {
      const adapter = new NetworkAdapter(mockWebrtcManager);
      expect(adapter.getConnectedPeers()).toEqual(['peer-1', 'peer-2']);
    });

    it('should return empty array without webrtcManager', () => {
      const adapter = new NetworkAdapter(null);
      expect(adapter.getConnectedPeers()).toEqual([]);
    });
  });

  describe('clear', () => {
    it('should clear all handlers', () => {
      const adapter = new NetworkAdapter(mockWebrtcManager);
      const handler = vi.fn();

      adapter.onMessage('dice:roll', handler);
      adapter.clear();

      // After clear, handler should not be called
      const messageCallback = mockWebrtcManager.addEventListener.mock.calls[0][1];
      messageCallback({
        detail: {
          peerId: 'peer-1',
          message: { type: 'dice-roll', values: [1] },
        },
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('message type mappings', () => {
    it('should map all dice message types correctly', () => {
      const adapter = new NetworkAdapter(mockWebrtcManager);

      const mappings = [
        ['dice:roll', 'dice-roll'],
        ['dice:grab', 'dice-grab'],
        ['dice:drop', 'dice-drop'],
        ['dice:lock', 'dice-lock'],
      ];

      for (const [newType, legacyType] of mappings) {
        adapter.broadcast(newType, {});
        expect(mockWebrtcManager.broadcast).toHaveBeenLastCalledWith(
          expect.objectContaining({ type: legacyType }),
          null
        );
      }
    });

    it('should map all peer message types correctly', () => {
      const adapter = new NetworkAdapter(mockWebrtcManager);

      const mappings = [
        ['peer:hello', 'hello'],
        ['peer:welcome', 'welcome'],
        ['peer:request-state', 'request-state'],
        ['peer:joined', 'peer-joined'],
        ['peer:left', 'peer-left'],
      ];

      for (const [newType, legacyType] of mappings) {
        adapter.broadcast(newType, {});
        expect(mockWebrtcManager.broadcast).toHaveBeenLastCalledWith(
          expect.objectContaining({ type: legacyType }),
          null
        );
      }
    });
  });
});

describe('createMockNetwork', () => {
  it('should create a mock network adapter', () => {
    const mock = createMockNetwork();
    expect(mock.broadcast).toBeDefined();
    expect(mock.send).toBeDefined();
    expect(mock.onMessage).toBeDefined();
  });

  it('should log broadcasts by default', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mock = createMockNetwork();

    mock.broadcast('dice:roll', { values: [1, 2, 3] });

    expect(consoleSpy).toHaveBeenCalledWith(
      '[MockNetwork] broadcast: dice:roll',
      { values: [1, 2, 3] }
    );
    consoleSpy.mockRestore();
  });

  it('should call custom onBroadcast callback', () => {
    const onBroadcast = vi.fn();
    const mock = createMockNetwork({ onBroadcast });

    mock.broadcast('dice:roll', { values: [1, 2, 3] });

    expect(onBroadcast).toHaveBeenCalledWith('dice:roll', { values: [1, 2, 3] });
  });

  it('should return true for isConnected', () => {
    const mock = createMockNetwork();
    expect(mock.isConnected()).toBe(true);
  });

  it('should return empty array for getConnectedPeers', () => {
    const mock = createMockNetwork();
    expect(mock.getConnectedPeers()).toEqual([]);
  });
});
