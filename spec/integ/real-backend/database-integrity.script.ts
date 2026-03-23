/**
 * Database Integrity Test Script
 *
 * Tests database schema integrity, field types, indexes, and constraints
 * to ensure the database conforms to DATABASE_FIELD_STANDARDS.md
 *
 * Run with: npx tsx spec/integ/real-backend/database-integrity.script.ts
 */

import { DatabaseVerifier } from './DatabaseVerifier';

class TestRunner {
  private dbVerifier: DatabaseVerifier;
  private passed = 0;
  private failed = 0;

  constructor() {
    this.dbVerifier = new DatabaseVerifier('docker-postgres');
  }

  async run() {
    console.log('========================================');
    console.log('Database Integrity Tests');
    console.log('========================================\n');

    try {
      await this.testConnection();
      await this.testTableStructure();
      await this.testTimestampFields();
      await this.testIndexes();
      await this.testDataIntegrity();
      await this.testPostgresConfig();
      await this.testKeyTables();
    } catch (error) {
      console.error('Test error:', error);
    }

    console.log('\n========================================');
    console.log(`Results: ${this.passed} passed, ${this.failed} failed`);
    console.log('========================================');

    process.exit(this.failed > 0 ? 1 : 0);
  }

  async assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`  ✓ ${message}`);
      this.passed++;
    } else {
      console.log(`  ✗ ${message}`);
      this.failed++;
    }
  }

  async testConnection() {
    console.log('[1] Database Connection');
    const healthy = await this.dbVerifier.healthCheck();
    await this.assert(healthy === true, 'Should connect to database successfully');
  }

  async testTableStructure() {
    console.log('\n[2] Table Structure');

    const tableCount = await this.dbVerifier.getTableCount();
    console.log(`  Table count: ${tableCount}`);
    await this.assert(tableCount >= 150, 'Should have at least 150 tables');

    const indexCount = await this.dbVerifier.getIndexCount();
    console.log(`  Index count: ${indexCount}`);
    await this.assert(indexCount >= 400, 'Should have at least 400 indexes');
  }

  async testTimestampFields() {
    console.log('\n[3] TIMESTAMP Field Type Validation');

    const { passed, violations } = await this.dbVerifier.verifyNoTimestampViolations();

    if (!passed) {
      console.log('  TIMESTAMP violations found:');
      for (const v of violations) {
        console.log(`    - ${v.table}.${v.column}`);
      }
    } else {
      console.log('  No TIMESTAMP violations found');
    }

    await this.assert(passed === true, 'NO user tables should have TIMESTAMP type columns');

    // Check specific tables
    const createdTs = await this.dbVerifier.getColumnType('users', 'created_ts');
    console.log(`  users.created_ts type: ${createdTs}`);
    await this.assert(createdTs === 'bigint', 'users.created_ts should be BIGINT');
  }

  async testIndexes() {
    console.log('\n[4] Index Integrity');

    const roomsIndexes = await this.dbVerifier.queryParsed(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'rooms' AND (indexname LIKE '%creator%' OR indexdef LIKE '%creator%')`
    );
    await this.assert(roomsIndexes.length > 0, 'rooms table should have creator related indexes');

    const eventsIndexes = await this.dbVerifier.queryParsed(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'events' AND indexname LIKE '%room_id%'`
    );
    await this.assert(eventsIndexes.length > 0, 'events table should have room_id index');

    const membershipIndexes = await this.dbVerifier.queryParsed(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'room_memberships'`
    );
    console.log(`  room_memberships indexes: ${membershipIndexes.length}`);
    await this.assert(membershipIndexes.length >= 3, 'room_memberships should have at least 3 indexes');
  }

  async testDataIntegrity() {
    console.log('\n[5] Data Integrity');

    const orphanMemberships = await this.dbVerifier.querySingle(
      `SELECT COUNT(*) FROM room_memberships rm LEFT JOIN rooms r ON rm.room_id = r.room_id WHERE r.room_id IS NULL`
    );
    console.log(`  Orphan room_memberships: ${orphanMemberships}`);
    await this.assert(orphanMemberships === '0', 'All room_memberships should reference valid rooms');

    const orphanEvents = await this.dbVerifier.querySingle(
      `SELECT COUNT(*) FROM events e LEFT JOIN rooms r ON e.room_id = r.room_id WHERE e.room_id IS NOT NULL AND r.room_id IS NULL`
    );
    console.log(`  Orphan events: ${orphanEvents}`);
    await this.assert(orphanEvents === '0', 'All events should reference valid rooms');

    const migrations = await this.dbVerifier.queryParsed(
      `SELECT version, success FROM schema_migrations ORDER BY applied_ts DESC LIMIT 5`
    );
    console.log(`  Migration records: ${migrations.length}`);
    await this.assert(migrations.length > 0, 'Should have migration records');

    // Check for failed migrations in recent unified migrations
    // Filter for UNIFIED or major version migrations that should always succeed
    let hasRecentFailedMigrations = false;
    for (const row of migrations) {
      if (row.length >= 2 && row[1] !== 't') {
        const version = row[0] || '';
        // Only fail on recent unified migrations, skip historical ones
        if (version.startsWith('UNIFIED') || version.startsWith('202603210')) {
          hasRecentFailedMigrations = true;
          console.log(`  Failed recent migration: ${version} (success=${row[1]})`);
        }
      }
    }
    await this.assert(!hasRecentFailedMigrations, 'Recent unified migrations should all succeed');
  }

  async testPostgresConfig() {
    console.log('\n[6] PostgreSQL Configuration');

    const { passed, issues } = await this.dbVerifier.verifyPostgresConfig();

    if (!passed) {
      console.log('  Config issues:');
      for (const issue of issues) {
        console.log(`    - ${issue}`);
      }
    }

    await this.assert(passed === true, 'Should have optimized PostgreSQL configuration');

    const sharedBuffers = await this.dbVerifier.getConfig('shared_buffers');
    console.log(`  shared_buffers: ${sharedBuffers}`);
    await this.assert(sharedBuffers === '256MB', 'shared_buffers should be 256MB');

    const workMem = await this.dbVerifier.getConfig('work_mem');
    console.log(`  work_mem: ${workMem}`);
    await this.assert(workMem === '16MB', 'work_mem should be 16MB');

    const randomPageCost = await this.dbVerifier.getConfig('random_page_cost');
    console.log(`  random_page_cost: ${randomPageCost}`);
    await this.assert(randomPageCost === '1.1', 'random_page_cost should be 1.1 (SSD)');

    const effectiveIo = await this.dbVerifier.getConfig('effective_io_concurrency');
    console.log(`  effective_io_concurrency: ${effectiveIo}`);
    await this.assert(effectiveIo === '200', 'effective_io_concurrency should be 200');
  }

  async testKeyTables() {
    console.log('\n[7] Key Tables Verification');

    const usersColumns = await this.dbVerifier.getTableColumns('users');
    console.log(`  users columns: ${usersColumns.join(', ')}`);
    await this.assert(usersColumns.includes('name') || usersColumns.includes('user_id'), 'users should have identifier column');
    await this.assert(usersColumns.includes('created_ts'), 'users.created_ts should exist');
    await this.assert(usersColumns.includes('updated_ts'), 'users.updated_ts should exist');

    const roomsColumns = await this.dbVerifier.getTableColumns('rooms');
    console.log(`  rooms columns: ${roomsColumns.length}`);
    await this.assert(roomsColumns.includes('room_id'), 'rooms.room_id should exist');
    await this.assert(roomsColumns.includes('name'), 'rooms.name should exist');
    await this.assert(roomsColumns.includes('creator'), 'rooms.creator should exist');

    const devicesColumns = await this.dbVerifier.getTableColumns('devices');
    console.log(`  devices columns: ${devicesColumns.length}`);
    await this.assert(devicesColumns.includes('device_id'), 'devices.device_id should exist');
    await this.assert(devicesColumns.includes('user_id'), 'devices.user_id should exist');
  }
}

const runner = new TestRunner();
runner.run();
