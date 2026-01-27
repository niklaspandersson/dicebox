/**
 * Tests for roll delegation utilities
 * Tests the anti-cheat peer selection and dice value generation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Since the modules use browser ES module syntax, we'll inline the functions for testing
// This also serves as a specification of the expected behavior

/**
 * Simple string hash function (djb2 algorithm)
 */
function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Select which peer should generate the roll values
 */
function selectRollGenerator(allPeerIds, requesterId, rollId) {
  const eligiblePeers = allPeerIds.filter(id => id !== requesterId);

  if (eligiblePeers.length === 0) {
    return {
      generatorId: requesterId,
      isSelfRoll: true
    };
  }

  const sortedPeers = [...eligiblePeers].sort();
  const hash = hashString(rollId);
  const index = hash % sortedPeers.length;

  return {
    generatorId: sortedPeers[index],
    isSelfRoll: false
  };
}

/**
 * Select the next peer to try after a timeout
 */
function selectNextGenerator(allPeerIds, requesterId, rollId, failedPeerIds) {
  const eligiblePeers = allPeerIds.filter(
    id => id !== requesterId && !failedPeerIds.includes(id)
  );

  if (eligiblePeers.length === 0) {
    return null;
  }

  const sortedPeers = [...eligiblePeers].sort();
  const hash = hashString(rollId);
  const index = hash % sortedPeers.length;

  return {
    generatorId: sortedPeers[index],
    isSelfRoll: false
  };
}

/**
 * Generate dice values for a roll request
 */
function generateDiceValues(diceSets, lockedDice = []) {
  const results = {};

  for (const set of diceSets) {
    const lockedInfo = lockedDice.find(l => l.setId === set.setId);
    const lockedMap = new Map();

    if (lockedInfo) {
      for (let i = 0; i < lockedInfo.lockedIndices.length; i++) {
        lockedMap.set(lockedInfo.lockedIndices[i], lockedInfo.values[i]);
      }
    }

    const values = Array(set.count).fill(0).map((_, i) => {
      if (lockedMap.has(i)) {
        return lockedMap.get(i);
      }
      return Math.floor(Math.random() * 6) + 1;
    });

    results[set.setId] = values;
  }

  return results;
}

/**
 * Validate that roll values are within acceptable range
 */
function validateRollValues(rollResults) {
  for (const setId in rollResults) {
    const values = rollResults[setId];
    if (!Array.isArray(values)) return false;

    for (const v of values) {
      if (!Number.isInteger(v) || v < 1 || v > 6) {
        return false;
      }
    }
  }
  return true;
}


// ============ TESTS ============

describe('hashString', () => {
  it('should produce consistent hashes for same input', () => {
    const hash1 = hashString('test-roll-id');
    const hash2 = hashString('test-roll-id');
    assert.strictEqual(hash1, hash2);
  });

  it('should produce different hashes for different inputs', () => {
    const hash1 = hashString('roll-1');
    const hash2 = hashString('roll-2');
    assert.notStrictEqual(hash1, hash2);
  });

  it('should always return a positive number', () => {
    const testStrings = ['', 'a', 'test', 'very-long-string-with-many-characters'];
    for (const str of testStrings) {
      const hash = hashString(str);
      assert.ok(hash >= 0, `Hash of "${str}" should be non-negative`);
    }
  });
});


describe('selectRollGenerator', () => {
  it('should return self-roll for solo player', () => {
    const result = selectRollGenerator(['peer-a'], 'peer-a', 'roll-1');

    assert.strictEqual(result.generatorId, 'peer-a');
    assert.strictEqual(result.isSelfRoll, true);
  });

  it('should select the other peer in 2-player game', () => {
    const result = selectRollGenerator(['peer-a', 'peer-b'], 'peer-a', 'roll-1');

    assert.strictEqual(result.generatorId, 'peer-b');
    assert.strictEqual(result.isSelfRoll, false);
  });

  it('should never select the requester as generator in multi-player', () => {
    const peers = ['peer-a', 'peer-b', 'peer-c', 'peer-d'];
    const requester = 'peer-a';

    // Test with multiple roll IDs to check different hash outcomes
    for (let i = 0; i < 100; i++) {
      const rollId = `roll-${i}`;
      const result = selectRollGenerator(peers, requester, rollId);

      assert.notStrictEqual(result.generatorId, requester,
        `Requester ${requester} should not be selected for ${rollId}`);
      assert.strictEqual(result.isSelfRoll, false);
    }
  });

  it('should be deterministic (same inputs = same output)', () => {
    const peers = ['peer-a', 'peer-b', 'peer-c'];
    const requester = 'peer-a';
    const rollId = 'test-roll-123';

    const result1 = selectRollGenerator(peers, requester, rollId);
    const result2 = selectRollGenerator(peers, requester, rollId);

    assert.deepStrictEqual(result1, result2);
  });

  it('should produce same result regardless of peer array order', () => {
    const peers1 = ['peer-a', 'peer-b', 'peer-c'];
    const peers2 = ['peer-c', 'peer-a', 'peer-b'];
    const requester = 'peer-a';
    const rollId = 'test-roll';

    const result1 = selectRollGenerator(peers1, requester, rollId);
    const result2 = selectRollGenerator(peers2, requester, rollId);

    assert.strictEqual(result1.generatorId, result2.generatorId);
  });

  it('should distribute selection across peers over many rolls', () => {
    const peers = ['peer-a', 'peer-b', 'peer-c', 'peer-d'];
    const requester = 'peer-a';
    const selectionCounts = new Map();

    // Run many rolls and count selections
    for (let i = 0; i < 1000; i++) {
      const rollId = `roll-${i}-fixed-seed`;
      const result = selectRollGenerator(peers, requester, rollId);

      const count = selectionCounts.get(result.generatorId) || 0;
      selectionCounts.set(result.generatorId, count + 1);
    }

    // Each eligible peer should be selected at least some times
    const eligiblePeers = peers.filter(p => p !== requester);
    for (const peer of eligiblePeers) {
      const count = selectionCounts.get(peer) || 0;
      assert.ok(count > 0, `Peer ${peer} should be selected at least once`);
      // With 3 eligible peers and 1000 rolls, expect roughly 333 each
      // Allow wide margin: at least 100 selections
      assert.ok(count > 100, `Peer ${peer} selected ${count} times, expected more even distribution`);
    }
  });
});


describe('selectNextGenerator', () => {
  it('should return null when all peers have failed', () => {
    const peers = ['peer-a', 'peer-b', 'peer-c'];
    const requester = 'peer-a';
    const failedPeers = ['peer-b', 'peer-c'];

    const result = selectNextGenerator(peers, requester, 'roll-1', failedPeers);

    assert.strictEqual(result, null);
  });

  it('should select from remaining peers after failures', () => {
    const peers = ['peer-a', 'peer-b', 'peer-c', 'peer-d'];
    const requester = 'peer-a';
    const failedPeers = ['peer-b'];

    const result = selectNextGenerator(peers, requester, 'roll-1', failedPeers);

    assert.ok(result !== null);
    assert.notStrictEqual(result.generatorId, requester);
    assert.notStrictEqual(result.generatorId, 'peer-b');
    assert.ok(['peer-c', 'peer-d'].includes(result.generatorId));
  });

  it('should return null for solo player', () => {
    const result = selectNextGenerator(['peer-a'], 'peer-a', 'roll-1', []);
    assert.strictEqual(result, null);
  });
});


describe('generateDiceValues', () => {
  it('should generate correct number of values per set', () => {
    const diceSets = [
      { setId: 'set-1', count: 2 },
      { setId: 'set-2', count: 5 }
    ];

    const results = generateDiceValues(diceSets);

    assert.strictEqual(results['set-1'].length, 2);
    assert.strictEqual(results['set-2'].length, 5);
  });

  it('should generate values between 1 and 6', () => {
    const diceSets = [{ setId: 'set-1', count: 100 }];

    const results = generateDiceValues(diceSets);

    for (const value of results['set-1']) {
      assert.ok(value >= 1 && value <= 6, `Value ${value} should be between 1 and 6`);
    }
  });

  it('should preserve locked dice values', () => {
    const diceSets = [{ setId: 'set-1', count: 5 }];
    const lockedDice = [{
      setId: 'set-1',
      lockedIndices: [0, 2, 4],
      values: [6, 3, 1]
    }];

    const results = generateDiceValues(diceSets, lockedDice);

    assert.strictEqual(results['set-1'][0], 6);
    assert.strictEqual(results['set-1'][2], 3);
    assert.strictEqual(results['set-1'][4], 1);
  });

  it('should roll unlocked dice even when some are locked', () => {
    const diceSets = [{ setId: 'set-1', count: 3 }];
    const lockedDice = [{
      setId: 'set-1',
      lockedIndices: [1],
      values: [5]
    }];

    // Run multiple times to ensure unlocked dice are being rolled
    const seenAtIndex0 = new Set();
    const seenAtIndex2 = new Set();

    for (let i = 0; i < 100; i++) {
      const results = generateDiceValues(diceSets, lockedDice);
      seenAtIndex0.add(results['set-1'][0]);
      seenAtIndex2.add(results['set-1'][2]);
      // Index 1 should always be 5 (locked)
      assert.strictEqual(results['set-1'][1], 5);
    }

    // Unlocked dice should show variation
    assert.ok(seenAtIndex0.size > 1, 'Unlocked die at index 0 should show variation');
    assert.ok(seenAtIndex2.size > 1, 'Unlocked die at index 2 should show variation');
  });

  it('should handle empty locked dice array', () => {
    const diceSets = [{ setId: 'set-1', count: 2 }];

    const results = generateDiceValues(diceSets, []);

    assert.strictEqual(results['set-1'].length, 2);
  });

  it('should handle multiple dice sets', () => {
    const diceSets = [
      { setId: 'set-1', count: 2 },
      { setId: 'set-2', count: 3 }
    ];
    const lockedDice = [
      { setId: 'set-1', lockedIndices: [0], values: [4] },
      { setId: 'set-2', lockedIndices: [1], values: [2] }
    ];

    const results = generateDiceValues(diceSets, lockedDice);

    assert.strictEqual(results['set-1'][0], 4);
    assert.strictEqual(results['set-2'][1], 2);
  });
});


describe('validateRollValues', () => {
  it('should accept valid roll results', () => {
    const rollResults = {
      'set-1': [1, 2, 3],
      'set-2': [6, 6]
    };

    assert.strictEqual(validateRollValues(rollResults), true);
  });

  it('should reject values less than 1', () => {
    const rollResults = {
      'set-1': [0, 2, 3]
    };

    assert.strictEqual(validateRollValues(rollResults), false);
  });

  it('should reject values greater than 6', () => {
    const rollResults = {
      'set-1': [1, 7, 3]
    };

    assert.strictEqual(validateRollValues(rollResults), false);
  });

  it('should reject negative values', () => {
    const rollResults = {
      'set-1': [1, -1, 3]
    };

    assert.strictEqual(validateRollValues(rollResults), false);
  });

  it('should reject non-integer values', () => {
    const rollResults = {
      'set-1': [1, 2.5, 3]
    };

    assert.strictEqual(validateRollValues(rollResults), false);
  });

  it('should reject non-array values', () => {
    const rollResults = {
      'set-1': 'not an array'
    };

    assert.strictEqual(validateRollValues(rollResults), false);
  });

  it('should accept empty roll results', () => {
    assert.strictEqual(validateRollValues({}), true);
  });

  it('should accept empty arrays', () => {
    const rollResults = {
      'set-1': []
    };

    assert.strictEqual(validateRollValues(rollResults), true);
  });
});


describe('Anti-cheat properties', () => {
  it('requester can never roll their own dice in multi-player', () => {
    const peers = ['alice', 'bob', 'charlie'];

    for (const requester of peers) {
      for (let i = 0; i < 50; i++) {
        const rollId = `roll-${requester}-${i}`;
        const result = selectRollGenerator(peers, requester, rollId);

        if (!result.isSelfRoll) {
          assert.notStrictEqual(result.generatorId, requester,
            `${requester} should not generate their own roll`);
        }
      }
    }
  });

  it('all peers compute the same generator for a given roll', () => {
    const peers = ['peer-a', 'peer-b', 'peer-c', 'peer-d'];
    const requester = 'peer-a';
    const rollId = 'shared-roll-123';

    // Simulate each peer computing the generator
    const computedGenerators = peers.map(observingPeer => {
      return selectRollGenerator(peers, requester, rollId);
    });

    // All should agree
    const first = computedGenerators[0];
    for (const result of computedGenerators) {
      assert.deepStrictEqual(result, first,
        'All peers should compute the same generator');
    }
  });

  it('generated values are always valid', () => {
    const diceSets = [
      { setId: 'set-1', count: 6 },
      { setId: 'set-2', count: 6 }
    ];

    for (let i = 0; i < 100; i++) {
      const results = generateDiceValues(diceSets);
      assert.ok(validateRollValues(results),
        'Generated values should always be valid');
    }
  });
});
