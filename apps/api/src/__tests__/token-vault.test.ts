/**
 * Token Vault Unit Tests
 * 
 * These are UNIT TESTS that verify:
 * - Exported functions have correct signatures
 * - Status functions return expected structure
 * - Supported connections are defined
 * 
 * NOTE: These tests run WITHOUT Auth0 Management API configured.
 * They do NOT verify actual token exchange or identity fetching.
 * 
 * For PRODUCTION validation, you need:
 * 1. Integration tests with real Auth0 credentials
 * 2. End-to-end tests that verify token exchange works
 * 3. Manual verification of connection flow in staging
 */

import { describe, it, expect } from 'vitest';
import {
  getTokenVaultStatus,
  getUserConnections,
} from '../services/token-vault.js';

describe('Token Vault Service - Unit Tests', () => {

  describe('getTokenVaultStatus', () => {
    it('should return Token Vault status structure', () => {
      const status = getTokenVaultStatus();

      expect(status).toHaveProperty('configured');
      expect(status).toHaveProperty('domain');
      expect(status).toHaveProperty('clientConfigured');
      expect(status).toHaveProperty('supportedConnections');
    });

    it('should list all supported connections', () => {
      const status = getTokenVaultStatus();

      expect(status.supportedConnections).toContain('github');
      expect(status.supportedConnections).toContain('slack');
      expect(status.supportedConnections).toContain('jira');
      expect(status.supportedConnections).toContain('google-oauth2');
      expect(status.supportedConnections.length).toBe(4);
    });
  });

  describe('getUserConnections', () => {
    it('should return result object with success and connections fields', async () => {
      const result = await getUserConnections('test-user');
      
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('connections');
      expect(Array.isArray(result.connections)).toBe(true);
    });

    it('should report error when Management API not configured', async () => {
      // In test environment, Management API credentials are not set
      const result = await getUserConnections('test-user');
      
      // Should return explicit error, not silently fail
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('MGMT_API_NOT_CONFIGURED');
      expect(result.error).toBeTruthy();
    });

    it('should not silently return empty array on errors', async () => {
      const result = await getUserConnections('test-user');
      
      // Key assertion: we get explicit error info, not just []
      if (!result.success) {
        expect(result.errorCode).toBeTruthy();
        expect(result.error).toBeTruthy();
      }
    });
  });
});
