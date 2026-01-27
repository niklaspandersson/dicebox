/**
 * RollManager - Manages roll delegation for anti-cheat
 *
 * Instead of players rolling their own dice, a random peer generates the values.
 * This prevents cheating by removing self-interest from the RNG.
 */
import {
  selectRollGenerator,
  selectNextGenerator,
  generateDiceValues,
  validateRollValues,
  ROLL_TIMEOUT_MS,
  MAX_RETRIES
} from './utils/roll-delegation.js';
import { MSG } from './message-router.js';

export class RollManager {
  constructor() {
    this.messageRouter = null;
    this.meshState = null;
    this.myPeerId = null;
    this.username = null;

    // Track pending roll requests (as requester)
    this.pendingRequests = new Map(); // rollId -> { timeoutId, failedPeers, lockedDice, resolve, reject }

    // Track roll requests we've seen (to prevent duplicates)
    this.processedRequests = new Set();
  }

  /**
   * Initialize the roll manager with dependencies
   */
  init({ messageRouter, meshState, myPeerId, username }) {
    this.messageRouter = messageRouter;
    this.meshState = meshState;
    this.myPeerId = myPeerId;
    this.username = username;
  }

  /**
   * Update peer ID (may change during session restoration)
   */
  updatePeerId(peerId) {
    this.myPeerId = peerId;
  }

  /**
   * Update username
   */
  updateUsername(username) {
    this.username = username;
  }

  /**
   * Get list of all connected peer IDs including self
   */
  getAllPeerIds() {
    const peers = this.meshState.getPeerList().map(p => p.peerId);
    // Include self
    if (!peers.includes(this.myPeerId)) {
      peers.push(this.myPeerId);
    }
    return peers;
  }

  /**
   * Request a dice roll (called by the player initiating the roll)
   *
   * @param {Object} rollConfig - Configuration for the roll
   * @param {Array} rollConfig.diceSets - Dice sets to roll [{setId, count, color}]
   * @param {Array} rollConfig.lockedDice - Locked dice info [{setId, lockedIndices, values}]
   * @param {Map} rollConfig.holders - Current holders of each dice set
   * @returns {Promise<Object>} - Resolves with roll results
   */
  async requestRoll({ diceSets, lockedDice, holders }) {
    const rollId = `${this.myPeerId}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const allPeerIds = this.getAllPeerIds();

    // Determine who should generate this roll
    const { generatorId, isSelfRoll } = selectRollGenerator(allPeerIds, this.myPeerId, rollId);

    // Prepare dice sets info for request
    const diceSetInfo = diceSets.map(set => ({
      setId: set.id,
      count: set.count,
      color: set.color
    }));

    // Build holder info for the roll result
    const holderInfo = [];
    for (const set of diceSets) {
      const holder = holders.get(set.id);
      holderInfo.push({
        setId: set.id,
        holderId: holder?.peerId || this.myPeerId,
        holderUsername: holder?.username || this.username
      });
    }

    if (isSelfRoll) {
      // Solo player - generate roll locally
      const rollResults = generateDiceValues(diceSetInfo, lockedDice);
      const total = this.calculateTotal(rollResults);

      // Broadcast the roll result
      const roll = this.buildRollMessage({
        rollId,
        rollResults,
        total,
        lockedDice,
        holderInfo,
        generatedBy: this.myPeerId
      });

      this.messageRouter.broadcast({
        type: MSG.DICE_ROLL,
        ...roll
      });

      return { rollResults, total, rollId, roll };
    }

    // Multi-player - request roll from designated peer
    return new Promise((resolve, reject) => {
      const request = {
        failedPeers: [],
        lockedDice,
        diceSets: diceSetInfo,
        holderInfo,
        resolve,
        reject,
        timeoutId: null
      };

      this.pendingRequests.set(rollId, request);

      // Send request and start timeout
      this.sendRollRequest(rollId, generatorId, diceSetInfo, lockedDice);
      this.startTimeout(rollId, generatorId);
    });
  }

  /**
   * Send a roll request to all peers.
   * We broadcast (rather than sending to the designated peer only) because all peers
   * independently compute who the designated generator is. Broadcasting ensures the
   * request reaches the correct peer even if peer lists are briefly out of sync.
   */
  sendRollRequest(rollId, generatorId, diceSets, lockedDice) {
    this.messageRouter.broadcast({
      type: MSG.ROLL_REQUEST,
      rollId,
      requesterId: this.myPeerId,
      requesterUsername: this.username,
      diceSets,
      lockedDice: lockedDice || []
    });
  }

  /**
   * Start timeout for a roll request
   */
  startTimeout(rollId, expectedGeneratorId) {
    const request = this.pendingRequests.get(rollId);
    if (!request) return;

    request.timeoutId = setTimeout(() => {
      this.handleTimeout(rollId, expectedGeneratorId);
    }, ROLL_TIMEOUT_MS);
  }

  /**
   * Handle timeout - try next peer or fall back to self-roll
   */
  handleTimeout(rollId, failedPeerId) {
    const request = this.pendingRequests.get(rollId);
    if (!request) return;

    // Add failed peer to list
    request.failedPeers.push(failedPeerId);

    // Check if we've exceeded max retries
    if (request.failedPeers.length >= MAX_RETRIES) {
      // Fall back to self-roll
      console.warn(`Roll ${rollId}: Max retries exceeded, falling back to self-roll`);
      this.selfRollFallback(rollId);
      return;
    }

    // Try next peer
    const allPeerIds = this.getAllPeerIds();
    const next = selectNextGenerator(allPeerIds, this.myPeerId, rollId, request.failedPeers);

    if (!next) {
      // No more peers, fall back to self-roll
      console.warn(`Roll ${rollId}: No more peers available, falling back to self-roll`);
      this.selfRollFallback(rollId);
      return;
    }

    console.log(`Roll ${rollId}: Retrying with peer ${next.generatorId}`);
    this.sendRollRequest(rollId, next.generatorId, request.diceSets, request.lockedDice);
    this.startTimeout(rollId, next.generatorId);
  }

  /**
   * Fall back to self-roll when delegation fails
   */
  selfRollFallback(rollId) {
    const request = this.pendingRequests.get(rollId);
    if (!request) return;

    // Clear timeout
    if (request.timeoutId) {
      clearTimeout(request.timeoutId);
    }

    // Generate roll locally
    const rollResults = generateDiceValues(request.diceSets, request.lockedDice);
    const total = this.calculateTotal(rollResults);

    // Broadcast the roll result
    const roll = this.buildRollMessage({
      rollId,
      rollResults,
      total,
      lockedDice: request.lockedDice,
      holderInfo: request.holderInfo,
      generatedBy: this.myPeerId
    });

    this.messageRouter.broadcast({
      type: MSG.DICE_ROLL,
      ...roll
    });

    // Resolve the promise
    request.resolve({ rollResults, total, rollId, roll });
    this.pendingRequests.delete(rollId);
  }

  /**
   * Handle incoming roll request (called when another peer wants us to generate their roll)
   */
  handleRollRequest(fromPeerId, message) {
    const { rollId, requesterId, requesterUsername, diceSets, lockedDice } = message;

    // Prevent processing duplicate requests
    if (this.processedRequests.has(rollId)) {
      return;
    }

    // Determine if we're the designated generator
    const allPeerIds = this.getAllPeerIds();
    const { generatorId } = selectRollGenerator(allPeerIds, requesterId, rollId);

    if (generatorId !== this.myPeerId) {
      // Not our job to generate this roll
      return;
    }

    // Mark as processed
    this.processedRequests.add(rollId);

    // Trim processed requests set (keep last 100)
    if (this.processedRequests.size > 100) {
      const arr = [...this.processedRequests];
      this.processedRequests = new Set(arr.slice(-100));
    }

    // Generate the roll values
    const rollResults = generateDiceValues(diceSets, lockedDice);
    const total = this.calculateTotal(rollResults);

    // Build holder info from dice sets (requester is the holder)
    const holderInfo = diceSets.map(set => ({
      setId: set.setId,
      holderId: requesterId,
      holderUsername: requesterUsername
    }));

    // Broadcast the roll result
    const roll = this.buildRollMessage({
      rollId,
      rollResults,
      total,
      lockedDice,
      holderInfo,
      generatedBy: this.myPeerId
    });

    this.messageRouter.broadcast({
      type: MSG.DICE_ROLL,
      ...roll
    });
  }

  /**
   * Handle incoming dice roll (either our requested roll or another player's roll)
   */
  handleDiceRoll(fromPeerId, roll) {
    const { rollId } = roll;

    // Validate roll values
    const rollResults = {};
    for (const sr of (roll.setResults || [])) {
      rollResults[sr.setId] = sr.values;
    }

    if (!validateRollValues(rollResults)) {
      console.warn(`Roll ${rollId}: Invalid values received, ignoring`);
      return false;
    }

    // Check if this is a response to our pending request
    const request = this.pendingRequests.get(rollId);
    if (request) {
      // Clear timeout
      if (request.timeoutId) {
        clearTimeout(request.timeoutId);
      }

      // Resolve the promise
      const total = roll.total || this.calculateTotal(rollResults);
      request.resolve({ rollResults, total, rollId, roll });
      this.pendingRequests.delete(rollId);
    }

    return true;
  }

  /**
   * Build a roll message for broadcasting
   */
  buildRollMessage({ rollId, rollResults, total, lockedDice, holderInfo, generatedBy }) {
    const setResults = [];

    for (const info of holderInfo) {
      setResults.push({
        setId: info.setId,
        color: info.color || '#ffffff',
        values: rollResults[info.setId] || [],
        holderId: info.holderId,
        holderUsername: info.holderUsername
      });
    }

    return {
      rollId,
      setResults,
      total,
      timestamp: Date.now(),
      lockedDice: lockedDice || [],
      generatedBy  // New field: who generated the random values
    };
  }

  /**
   * Calculate total of all dice values
   */
  calculateTotal(rollResults) {
    let total = 0;
    for (const setId in rollResults) {
      total += rollResults[setId].reduce((a, b) => a + b, 0);
    }
    return total;
  }

  /**
   * Clean up when leaving room
   */
  cleanup() {
    // Cancel all pending requests
    for (const request of this.pendingRequests.values()) {
      if (request.timeoutId) {
        clearTimeout(request.timeoutId);
      }
      request.reject(new Error('Room left'));
    }
    this.pendingRequests.clear();
    this.processedRequests.clear();
  }
}
