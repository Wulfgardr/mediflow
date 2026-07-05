# drizzle/ historical migration artifacts

The `*.sql` files in this folder are historical schema artifacts. They are NOT
applied automatically at runtime. There is no migrator import in the app and no
`db:migrate` script; nothing calls drizzle-kit's migrate at boot.

The operative schema mechanism at runtime is `applySchemaGuards()` in
`lib/db-server.ts`. It runs on every database open (boot and after a repair swap)
and is idempotent: it adds missing columns, creates the tables it owns, and
creates the secondary indices. The base (core) tables were created historically
from `0000_*.sql` (and the later numbered files) via `drizzle-kit push`; from
there the guards keep every existing database file in step with the current code.

The `lib/schema.ts` drizzle model stays the single typed source of truth for the
application code. To keep the guards, the SQL files, and the model from drifting
apart, run:

    npm run check:schema-drift

That command bootstraps a throwaway SQLite database through the real db-server
path (drizzle SQL migrations followed by the runtime guards), introspects
`sqlite_master`, and fails with a readable diff if any table, column, or index
declared in `lib/schema.ts` is missing from the bootstrapped runtime schema.

Practical rules:

- Adding a column or index? Add it to `lib/schema.ts` AND to `applySchemaGuards()`
  in `lib/db-server.ts` (guards are what actually runs). A new `*.sql` file here is
  optional historical bookkeeping, not a runtime requirement.
- Do not assume editing only a `*.sql` file changes anything at runtime. It does not.
- Keep index names identical across `lib/schema.ts` and the guards so the drift
  check can match them.
