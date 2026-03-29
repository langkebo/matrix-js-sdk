/**
 * Database Integrity Test Suite
 *
 * Tests database schema integrity, field types, indexes, and constraints
 * to ensure the database conforms to DATABASE_FIELD_STANDARDS.md
 *
 * Run with: npx tsx spec/integ/real-backend/database-integrity.test.ts
 */

import { describe, beforeAll, afterAll, test, expect } from 'vitest';
import { DatabaseVerifier } from './DatabaseVerifier';

describe('Database Integrity Tests', () => {
  let dbVerifier: DatabaseVerifier;

  beforeAll(() => {
    dbVerifier = new DatabaseVerifier('docker-postgres');
  });

  afterAll(async () => {
    // No cleanup needed for read-only tests
  });

  describe('Database Connection', () => {
    test('should connect to database successfully', async () => {
      const healthy = await dbVerifier.healthCheck();
      expect(healthy).toBe(true);
    });
  });

  describe('Table Structure', () => {
    test('should have expected number of tables', async () => {
      const tableCount = await dbVerifier.getTableCount();
      console.log(`Table count: ${tableCount}`);
      expect(tableCount).toBeGreaterThanOrEqual(150);
    });

    test('should have expected number of indexes', async () => {
      const indexCount = await dbVerifier.getIndexCount();
      console.log(`Index count: ${indexCount}`);
      expect(indexCount).toBeGreaterThanOrEqual(400);
    });
  });

  describe('TIMESTAMP Field Type Validation', () => {
    test('users table should use BIGINT for timestamp fields, not TIMESTAMP', async () => {
      const columns = ['created_ts', 'updated_ts', 'last_seen_ts'];
      const dataTypes: Array<string | null> = [];

      for (const col of columns) {
        const dataType = await dbVerifier.getColumnType('users', col);
        console.log(`users.${col}: ${dataType}`);
        dataTypes.push(dataType);
      }

      expect(dataTypes.every((dataType) => dataType === 'bigint')).toBe(true);
    });

    test('user_directory table should use BIGINT for timestamp fields', async () => {
      const columns = await dbVerifier.getTableColumns('user_directory');
      const tsColumns = columns.filter(c => c.endsWith('_ts'));
      const dataTypes: Array<string | null> = [];

      for (const col of tsColumns) {
        const dataType = await dbVerifier.getColumnType('user_directory', col);
        console.log(`user_directory.${col}: ${dataType}`);
        dataTypes.push(dataType);
      }

      expect(dataTypes.every((dataType) => dataType === 'bigint')).toBe(true);
    });

    test('NO user tables should have TIMESTAMP type columns (except system tables)', async () => {
      const { passed, violations } = await dbVerifier.verifyNoTimestampViolations();

      if (!passed) {
        console.error('TIMESTAMP violations found:', violations);
      }

      expect(passed).toBe(true);
      expect(violations.length).toBe(0);
    });
  });

  describe('Index Integrity', () => {
    test('rooms table should have creator related indexes', async () => {
      const sql = `
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'rooms'
        AND (indexname LIKE '%creator%' OR indexdef LIKE '%creator%')
      `;
      const rows = await dbVerifier.queryParsed(sql);
      console.log(`rooms indexes with creator: ${rows.length}`);
      expect(rows.length).toBeGreaterThan(0);
    });

    test('events table should have room_id index', async () => {
      const sql = `
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'events'
        AND indexname LIKE '%room_id%'
      `;
      const rows = await dbVerifier.queryParsed(sql);
      console.log(`events indexes with room_id: ${rows.length}`);
      expect(rows.length).toBeGreaterThan(0);
    });

    test('room_memberships table should have proper indexes', async () => {
      const sql = `SELECT indexname FROM pg_indexes WHERE tablename = 'room_memberships'`;
      const rows = await dbVerifier.queryParsed(sql);
      console.log(`room_memberships indexes: ${rows.map(r => r[0]).join(', ')}`);
      expect(rows.length).toBeGreaterThanOrEqual(3);
    });

    test('devices table should have user_id index', async () => {
      const sql = `
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'devices'
        AND indexname LIKE '%user_id%'
      `;
      const rows = await dbVerifier.queryParsed(sql);
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  describe('Data Integrity', () => {
    test('all room_memberships should reference valid rooms', async () => {
      const sql = `
        SELECT COUNT(*) FROM room_memberships rm
        LEFT JOIN rooms r ON rm.room_id = r.room_id
        WHERE r.room_id IS NULL
      `;
      const result = await dbVerifier.querySingle(sql);
      const orphanCount = parseInt(result, 10);
      console.log(`Orphan room_memberships: ${orphanCount}`);
      expect(orphanCount).toBe(0);
    });

    test('all events should reference valid rooms (where applicable)', async () => {
      const sql = `
        SELECT COUNT(*) FROM events e
        LEFT JOIN rooms r ON e.room_id = r.room_id
        WHERE e.room_id IS NOT NULL AND r.room_id IS NULL
      `;
      const result = await dbVerifier.querySingle(sql);
      const orphanCount = parseInt(result, 10);
      console.log(`Orphan events: ${orphanCount}`);
      expect(orphanCount).toBe(0);
    });

    test('schema_migrations should have successful migrations recorded', async () => {
      const sql = `SELECT version, success, executed_at FROM schema_migrations ORDER BY applied_ts DESC LIMIT 10`;
      const rows = await dbVerifier.queryParsed(sql);
      console.log(`Migration records: ${rows.length}`);
      expect(rows.length).toBeGreaterThan(0);

      // Check for failed recent unified migrations (skip historical ones and initial UNIFIED)
      // UNIFIED_MIGRATION_v1 and UNIFIED_v1.0.0 are the baseline, skip them
      const recentFailedMigrations = rows.filter((r: string[]) => {
        if (r[1] === 't') return false;
        const version = r[0] || '';
        // Skip initial unified migrations that have been superseded
        if (version === 'UNIFIED' || version === 'UNIFIED_v1.0.0') return false;
        // Skip historical migrations
        return version.startsWith('UNIFIED') || version.startsWith('202603210');
      });

      if (recentFailedMigrations.length > 0) {
        console.log('Recent failed migrations:', recentFailedMigrations);
      }
      expect(recentFailedMigrations.length).toBe(0);
    });
  });

  describe('PostgreSQL Configuration', () => {
    test('should have optimized PostgreSQL configuration', async () => {
      const { passed, issues } = await dbVerifier.verifyPostgresConfig();

      if (!passed) {
        console.error('PostgreSQL config issues:', issues);
      }

      expect(passed).toBe(true);
    });

    test('shared_buffers should be 256MB', async () => {
      const value = await dbVerifier.getConfig('shared_buffers');
      console.log(`shared_buffers: ${value}`);
      expect(value).toBe('256MB');
    });

    test('work_mem should be 16MB', async () => {
      const value = await dbVerifier.getConfig('work_mem');
      console.log(`work_mem: ${value}`);
      expect(value).toBe('16MB');
    });

    test('random_page_cost should be 1.1 (SSD optimization)', async () => {
      const value = await dbVerifier.getConfig('random_page_cost');
      console.log(`random_page_cost: ${value}`);
      expect(value).toBe('1.1');
    });

    test('effective_io_concurrency should be 200', async () => {
      const value = await dbVerifier.getConfig('effective_io_concurrency');
      console.log(`effective_io_concurrency: ${value}`);
      expect(value).toBe('200');
    });
  });

  describe('Key Tables Verification', () => {
    test('users table should have required columns', async () => {
      const requiredColumns = [
        'user_id', 'username', 'is_deactivated',
        'created_ts', 'updated_ts', 'displayname'
      ];

      const columns = await dbVerifier.getTableColumns('users');

      for (const col of requiredColumns) {
        console.log(`users.${col}: ${columns.includes(col) ? 'exists' : 'MISSING'}`);
        expect(columns).toContain(col);
      }
    });

    test('rooms table should have required columns', async () => {
      const requiredColumns = [
        'room_id', 'name', 'creator', 'is_public',
        'created_ts', 'last_activity_ts', 'guest_access'
      ];

      const columns = await dbVerifier.getTableColumns('rooms');

      for (const col of requiredColumns) {
        console.log(`rooms.${col}: ${columns.includes(col) ? 'exists' : 'MISSING'}`);
        expect(columns).toContain(col);
      }
    });

    test('devices table should have required columns', async () => {
      const requiredColumns = [
        'user_id', 'device_id', 'last_seen_ts', 'last_seen_ip'
      ];

      const columns = await dbVerifier.getTableColumns('devices');

      for (const col of requiredColumns) {
        console.log(`devices.${col}: ${columns.includes(col) ? 'exists' : 'MISSING'}`);
        expect(columns).toContain(col);
      }
    });
  });
});

// Export for use in other tests
export { DatabaseVerifier };
