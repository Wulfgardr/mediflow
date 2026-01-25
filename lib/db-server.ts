import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';

// Ensure the data directory exists in production or use project root for dev
const dbPath = 'medical.db';

const sqlite = new Database(dbPath);
export const dbServer = drizzle(sqlite);
