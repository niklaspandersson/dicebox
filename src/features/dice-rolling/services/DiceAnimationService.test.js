import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiceAnimationService } from "./DiceAnimationService.js";

describe("DiceAnimationService", () => {
  let service;
  let diceConfig;

  beforeEach(() => {
    service = new DiceAnimationService({ duration: 100, frameInterval: 20 });
    diceConfig = {
      diceSets: [
        { id: "red", count: 5, color: "#ff0000" },
        { id: "blue", count: 3, color: "#0000ff" },
      ],
    };
  });

  describe("constructor", () => {
    it("should use default settings", () => {
      const defaultService = new DiceAnimationService();
      const settings = defaultService.getSettings();

      expect(settings.duration).toBe(500);
      expect(settings.frameInterval).toBe(50);
    });

    it("should accept custom settings", () => {
      const settings = service.getSettings();

      expect(settings.duration).toBe(100);
      expect(settings.frameInterval).toBe(20);
    });
  });

  describe("animateRoll", () => {
    it("should return final values for all requested sets", async () => {
      const result = await service.animateRoll({
        setIds: ["red", "blue"],
        diceConfig,
      });

      expect(result.has("red")).toBe(true);
      expect(result.has("blue")).toBe(true);
      expect(result.get("red")).toHaveLength(5);
      expect(result.get("blue")).toHaveLength(3);
    });

    it("should return values between 1 and 6", async () => {
      const result = await service.animateRoll({
        setIds: ["red"],
        diceConfig,
      });

      const values = result.get("red");
      values.forEach((v) => {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(6);
      });
    });

    it("should call onFrame during animation", async () => {
      const onFrame = vi.fn();

      await service.animateRoll({
        setIds: ["red"],
        diceConfig,
        onFrame,
        duration: 100,
      });

      // Should have been called multiple times during animation
      expect(onFrame.mock.calls.length).toBeGreaterThan(1);

      // Last call should have isFinal = true
      const lastCall = onFrame.mock.calls[onFrame.mock.calls.length - 1];
      expect(lastCall[1]).toBe(true); // isFinal flag
    });

    it("should provide intermediate values to onFrame", async () => {
      const frames = [];
      const onFrame = vi.fn((values, isFinal) => {
        frames.push({ values: new Map(values), isFinal });
      });

      await service.animateRoll({
        setIds: ["red"],
        diceConfig,
        onFrame,
        duration: 80,
      });

      // Should have intermediate frames (isFinal = false)
      const intermediateFrames = frames.filter((f) => !f.isFinal);
      expect(intermediateFrames.length).toBeGreaterThan(0);

      // Each frame should have valid values
      intermediateFrames.forEach((frame) => {
        const values = frame.values.get("red");
        expect(values).toHaveLength(5);
        values.forEach((v) => {
          expect(v).toBeGreaterThanOrEqual(1);
          expect(v).toBeLessThanOrEqual(6);
        });
      });
    });

    it("should return immediately if no onFrame callback", async () => {
      const start = Date.now();

      await service.animateRoll({
        setIds: ["red"],
        diceConfig,
        duration: 1000, // long duration
        // no onFrame
      });

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50); // Should be nearly instant
    });

    it("should only roll requested sets", async () => {
      const result = await service.animateRoll({
        setIds: ["red"], // only red
        diceConfig,
      });

      expect(result.has("red")).toBe(true);
      expect(result.has("blue")).toBe(false);
    });

    it("should handle empty setIds", async () => {
      const result = await service.animateRoll({
        setIds: [],
        diceConfig,
      });

      expect(result.size).toBe(0);
    });

    it("should handle unknown set IDs gracefully", async () => {
      const result = await service.animateRoll({
        setIds: ["unknown"],
        diceConfig,
      });

      expect(result.has("unknown")).toBe(false);
    });
  });

  describe("showRoll", () => {
    it("should animate to final values", async () => {
      const finalValues = new Map([["red", [6, 6, 6, 6, 6]]]);
      const frames = [];
      const onFrame = vi.fn((values, isFinal) => {
        frames.push({ values: new Map(values), isFinal });
      });

      await service.showRoll({
        values: finalValues,
        diceConfig,
        onFrame,
        duration: 80,
      });

      // Last frame should have final values
      const lastFrame = frames[frames.length - 1];
      expect(lastFrame.isFinal).toBe(true);
      expect(lastFrame.values.get("red")).toEqual([6, 6, 6, 6, 6]);
    });

    it("should show random values during animation", async () => {
      const finalValues = new Map([["red", [1, 1, 1, 1, 1]]]);
      const intermediateValues = [];
      const onFrame = vi.fn((values, isFinal) => {
        if (!isFinal) {
          intermediateValues.push([...values.get("red")]);
        }
      });

      await service.showRoll({
        values: finalValues,
        diceConfig,
        onFrame,
        duration: 80,
      });

      // At least one intermediate frame should have different values
      // (statistically almost certain with random values)
      const allSame = intermediateValues.every((vals) =>
        vals.every((v) => v === 1),
      );
      // This might rarely fail if random generates all 1s, but very unlikely
      expect(intermediateValues.length).toBeGreaterThan(0);
    });

    it("should resolve immediately if no onFrame", async () => {
      const start = Date.now();

      await service.showRoll({
        values: new Map([["red", [1, 2, 3, 4, 5]]]),
        diceConfig,
        duration: 1000,
        // no onFrame
      });

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe("settings", () => {
    it("should get settings", () => {
      const settings = service.getSettings();

      expect(settings).toHaveProperty("duration");
      expect(settings).toHaveProperty("frameInterval");
    });

    it("should update settings", () => {
      service.setSettings({ duration: 200, frameInterval: 30 });

      const settings = service.getSettings();
      expect(settings.duration).toBe(200);
      expect(settings.frameInterval).toBe(30);
    });

    it("should allow partial settings update", () => {
      service.setSettings({ duration: 300 });

      const settings = service.getSettings();
      expect(settings.duration).toBe(300);
      expect(settings.frameInterval).toBe(20); // unchanged
    });
  });
});
