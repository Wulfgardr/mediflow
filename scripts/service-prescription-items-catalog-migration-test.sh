#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="$(mktemp "${TMPDIR:-/tmp}/mediflow-0014-migration-test.XXXXXX.db")"

cleanup() {
    rm -f "$DB_PATH"
}
trap cleanup EXIT

sqlite3 "$DB_PATH" <<'SQL'
CREATE TABLE patients (
    id text PRIMARY KEY
);

CREATE TABLE service_prescriptions (
    id text PRIMARY KEY NOT NULL,
    patient_id text NOT NULL,
    status text,
    category text,
    code_system text,
    service_code text,
    service_name text NOT NULL,
    scheduled_at integer,
    performed_at integer,
    report_received_at integer,
    outcome_note text,
    notes text,
    created_at integer,
    updated_at integer
);

INSERT INTO patients (id) VALUES ('p1');
INSERT INTO service_prescriptions (
    id,
    patient_id,
    status,
    category,
    code_system,
    service_code,
    service_name
) VALUES (
    'rx1',
    'p1',
    'prescribed',
    'laboratory',
    'synthetic',
    'LAB-001',
    'Emocromo'
);
SQL

sqlite3 "$DB_PATH" < "$ROOT_DIR/drizzle/0014_service_prescription_items_catalog.sql"

ITEM_ID="$(sqlite3 "$DB_PATH" "SELECT id FROM service_prescription_items WHERE prescription_id = 'rx1';")"
if [[ "$ITEM_ID" != "rx1:item:0" ]]; then
    echo "Expected service prescription item rx1:item:0, got: ${ITEM_ID:-<empty>}" >&2
    exit 1
fi
