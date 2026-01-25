import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    schema: './lib/schema.ts',
    out: './drizzle',
    dialect: 'sqlite',
    dbCredentials: {
        url: 'medical.db',
    },
});
