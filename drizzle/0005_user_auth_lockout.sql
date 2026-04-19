ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN first_failed_login_at INTEGER;
ALTER TABLE users ADD COLUMN locked_until INTEGER;
