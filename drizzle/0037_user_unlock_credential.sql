ALTER TABLE users ADD COLUMN unlock_verifier_hash TEXT;
ALTER TABLE users ADD COLUMN recovery_wrapped_master_key TEXT;
ALTER TABLE users ADD COLUMN recovery_salt TEXT;
ALTER TABLE users ADD COLUMN recovery_verifier_hash TEXT;
