import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { checkpoint, db } from '../../src/lib/db';

/**
 * Fold the WAL into the database file, as a step of its own.
 *
 * cycle and sync each do this at the end of a successful run. A run that failed
 * does not reach either, and the Actions cache saves data/smartnews.db without
 * its -wal - so whatever the failing run had committed but not checkpointed
 * would be dropped on the way into the cache, and the file restored next time
 * would be missing its tail while still carrying a store token that matches D1.
 * That is the one combination the token gate cannot catch, because the file
 * does not know it lost anything.
 */
db();
checkpoint();
