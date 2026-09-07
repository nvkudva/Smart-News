import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
import { ingest } from '../src/lib/ingest';

ingest().then(() => process.exit(0));
