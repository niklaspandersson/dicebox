import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiceStore } from "./DiceStore.js";

describe("DiceStore", () => {
  let store;

  beforeEach(() => {
    store = new DiceStore();
  });

  describe("initial state", () => {
    it("should have empty config", () => {
      expect(store.diceConfig).toEqual({
        diceSets: [],
      });
    });

    it("should have empty values map", () => {
      expect(store.diceValues.size).toBe(0);
    });

    it("should have empty holders map", () => {
      expect(store.holders.size).toBe(0);
    });
  });

  describe("config", () => {
    it("should set config", () => {
      const config = {
        diceSets: [{ id: "set1", count: 5, color: "#ff0000" }],
      };

      store.setConfig(config);

      expect(store.diceConfig).toEqual(config);
    });
  });

  describe("holders", () => {
    it("should set holder for a set", () => {
      store.setHolder("set1", "player1", "Alice");

      expect(store.holders.get("set1")).toEqual({
        playerId: "player1",
        username: "Alice",
      });
    });

    it("should clear holder for a set", () => {
      store.setHolder("set1", "player1", "Alice");
      store.clearHolder("set1");

      expect(store.holders.has("set1")).toBe(false);
    });

    it("should also clear holderHasRolled when clearing holder", () => {
      store.setHolder("set1", "player1", "Alice");
      store.applyRoll({
        setId: "set1",
        values: [1, 2, 3],
        playerId: "player1",
        username: "Alice",
      });

      expect(store.holderHasRolled.get("set1")).toBe(true);

      store.clearHolder("set1");

      expect(store.holderHasRolled.has("set1")).toBe(false);
    });

    describe("tryGrab", () => {
      it("should succeed if set is not held", () => {
        const result = store.tryGrab("set1", "player1", "Alice");

        expect(result).toBe(true);
        expect(store.holders.get("set1")).toEqual({
          playerId: "player1",
          username: "Alice",
        });
      });

      it("should fail if set is already held", () => {
        store.setHolder("set1", "player1", "Alice");

        const result = store.tryGrab("set1", "player2", "Bob");

        expect(result).toBe(false);
        expect(store.holders.get("set1").playerId).toBe("player1");
      });

      it("should initialize holderHasRolled to false", () => {
        store.tryGrab("set1", "player1", "Alice");

        expect(store.holderHasRolled.get("set1")).toBe(false);
      });
    });
  });

  describe("rolling", () => {
    it("should apply roll result", () => {
      const result = {
        setId: "set1",
        values: [1, 2, 3, 4, 5],
        playerId: "player1",
        username: "Alice",
      };

      store.applyRoll(result);

      expect(store.diceValues.get("set1")).toEqual([1, 2, 3, 4, 5]);
      expect(store.lastRoller.get("set1")).toEqual({
        playerId: "player1",
        username: "Alice",
      });
      expect(store.holderHasRolled.get("set1")).toBe(true);
    });

    it("should apply multiple rolls", () => {
      const results = [
        { setId: "set1", values: [1, 2], playerId: "p1", username: "A" },
        { setId: "set2", values: [3, 4], playerId: "p2", username: "B" },
      ];

      store.applyRolls(results);

      expect(store.diceValues.get("set1")).toEqual([1, 2]);
      expect(store.diceValues.get("set2")).toEqual([3, 4]);
    });

    it("should notify subscribers on roll", () => {
      const callback = vi.fn();
      store.subscribe(callback);

      store.applyRoll({
        setId: "set1",
        values: [6],
        playerId: "p1",
        username: "A",
      });

      expect(callback).toHaveBeenCalled();
    });
  });

  describe("serialization", () => {
    it("should create snapshot with Maps converted to objects", () => {
      store.setConfig({
        diceSets: [{ id: "s1", count: 3, color: "#f00" }],
      });
      store.setHolder("s1", "p1", "Alice");
      store.applyRoll({
        setId: "s1",
        values: [1, 2, 3],
        playerId: "p1",
        username: "Alice",
      });

      const snapshot = store.getSnapshot();

      expect(snapshot.config.diceSets).toHaveLength(1);
      expect(snapshot.values).toEqual({ s1: [1, 2, 3] });
      expect(snapshot.holders).toEqual({
        s1: { playerId: "p1", username: "Alice" },
      });
      expect(snapshot.lastRoller).toEqual({
        s1: { playerId: "p1", username: "Alice" },
      });
    });

    it("should load snapshot and restore Maps", () => {
      const snapshot = {
        config: {
          diceSets: [{ id: "s1", count: 2, color: "#0f0" }],
        },
        values: { s1: [4, 5] },
        holders: { s1: { playerId: "p2", username: "Bob" } },
        lastRoller: { s1: { playerId: "p2", username: "Bob" } },
        holderHasRolled: { s1: true },
      };

      store.loadSnapshot(snapshot);

      expect(store.diceConfig.diceSets[0].id).toBe("s1");
      expect(store.diceValues.get("s1")).toEqual([4, 5]);
      expect(store.holders.get("s1").playerId).toBe("p2");
      expect(store.lastRoller.get("s1").username).toBe("Bob");
    });

    it("should handle empty snapshot gracefully", () => {
      const snapshot = { config: { diceSets: [] } };

      store.loadSnapshot(snapshot);

      expect(store.diceValues.size).toBe(0);
      expect(store.holders.size).toBe(0);
    });
  });

  describe("reset", () => {
    it("should reset to initial state", () => {
      store.setConfig({
        diceSets: [{ id: "s1", count: 5, color: "#f00" }],
      });
      store.setHolder("s1", "p1", "Alice");
      store.applyRoll({
        setId: "s1",
        values: [1, 2, 3, 4, 5],
        playerId: "p1",
        username: "Alice",
      });

      store.reset();

      expect(store.diceConfig.diceSets).toHaveLength(0);
      expect(store.holders.size).toBe(0);
      expect(store.diceValues.size).toBe(0);
    });
  });
});
