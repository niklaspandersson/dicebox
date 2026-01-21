/**
 * HostMigrationManager - Handles host election and migration
 */
import { signalingClient } from './signaling-client.js';
import { webrtcManager } from './webrtc-manager.js';

// Host migration configuration
const MIGRATION_CONFIG = {
  initialDelay: 500,      // Initial delay before first reconnection attempt
  maxDelay: 10000,        // Maximum delay between attempts
  maxAttempts: 5,         // Maximum number of reconnection attempts
  backoffMultiplier: 2,   // Exponential backoff multiplier
};

export class HostMigrationManager extends EventTarget {
  constructor() {
    super();
    this.migrationAttempts = 0;
    this.migrationTimeout = null;
  }

  /**
   * Cancel any ongoing migration attempt
   */
  cancel() {
    if (this.migrationTimeout) {
      clearTimeout(this.migrationTimeout);
      this.migrationTimeout = null;
    }
    this.migrationAttempts = 0;
  }

  /**
   * Initiate host migration - start claiming host role
   */
  initiate(roomId, serverConnected) {
    console.log('Initiating host migration - claiming host role');
    this.cancel();
    this.attemptClaimHost(roomId, serverConnected);
  }

  /**
   * Attempt to claim host role with exponential backoff
   */
  attemptClaimHost(roomId, serverConnected) {
    if (this.migrationAttempts >= MIGRATION_CONFIG.maxAttempts) {
      console.log('Max migration attempts reached, giving up');
      this.dispatchEvent(new CustomEvent('migration-failed'));
      return;
    }

    this.migrationAttempts++;

    // Calculate delay with exponential backoff
    const delay = Math.min(
      MIGRATION_CONFIG.initialDelay * Math.pow(MIGRATION_CONFIG.backoffMultiplier, this.migrationAttempts - 1),
      MIGRATION_CONFIG.maxDelay
    );

    console.log(`Migration attempt ${this.migrationAttempts}/${MIGRATION_CONFIG.maxAttempts} in ${delay}ms`);

    this.migrationTimeout = setTimeout(() => {
      if (serverConnected) {
        signalingClient.claimHost(roomId);
      } else {
        // No server connection, retry after delay
        this.attemptClaimHost(roomId, serverConnected);
      }
    }, delay);
  }

  /**
   * Attempt to connect to a new host with exponential backoff
   */
  attemptConnectToNewHost(peerId, attempt, checkShouldContinue) {
    if (attempt >= MIGRATION_CONFIG.maxAttempts) {
      console.log('Failed to connect to new host after max attempts');
      this.dispatchEvent(new CustomEvent('connection-to-new-host-failed', { detail: { peerId } }));
      return;
    }

    const delay = Math.min(
      MIGRATION_CONFIG.initialDelay * Math.pow(MIGRATION_CONFIG.backoffMultiplier, attempt),
      MIGRATION_CONFIG.maxDelay
    );

    setTimeout(() => {
      if (checkShouldContinue(peerId)) {
        console.log(`Attempting to connect to new host ${peerId} (attempt ${attempt + 1})`);
        webrtcManager.connectToPeer(peerId).catch(() => {
          this.attemptConnectToNewHost(peerId, attempt + 1, checkShouldContinue);
        });
      }
    }, delay);
  }

  /**
   * Determine if this peer should become the new host based on join order
   */
  shouldBecomeHost(myJoinOrder, nextHostCandidate, excludePeerId) {
    if (!nextHostCandidate || nextHostCandidate.peerId === excludePeerId) {
      return true;
    }
    return myJoinOrder < nextHostCandidate.joinOrder;
  }

  /**
   * Get the migration configuration (for external use)
   */
  static getConfig() {
    return { ...MIGRATION_CONFIG };
  }
}
