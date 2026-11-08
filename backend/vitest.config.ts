import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
const testDatabase = process.env.TEST_DATABASE_URL;
if (!testDatabase || !new URL(testDatabase).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL doit désigner une base dédiée dont le nom se termine par _test.');
if (testDatabase === process.env.DATABASE_URL) throw new Error('La base de tests doit être distincte de la base de démonstration.');
process.env.DATABASE_URL = testDatabase;
process.env.NODE_ENV = 'test';
export default defineConfig({ test: { include: ['backend/src/tests/**/*.test.ts'], fileParallelism: false, testTimeout: 20000, hookTimeout: 30000, maxWorkers: 1 } });
