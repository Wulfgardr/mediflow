BEGIN TRANSACTION;
CREATE TABLE "checkups" (
    `id` text PRIMARY KEY NOT NULL, `patient_id` text NOT NULL, `date` integer NOT NULL,
    `title` text NOT NULL, `notes` text, `status` text DEFAULT 'pending', `source` text,
    `version` integer NOT NULL DEFAULT 1, `created_at` integer DEFAULT (unixepoch()),
    `updated_at` integer DEFAULT (unixepoch()), `deleted_at` integer, `deletion_reason` text
);
INSERT INTO "checkups" VALUES('fixture-checkup-1','fixture-1',1749000000,'Controllo glicemico','ENC:AAAAAAAAAAAAAAAJ:pabYzDrvsdKj4AQwr0NBFlP61qXvKDiI01nakoqrEV64JwEX','completed','manual',1,1749000000,1749000000,NULL,NULL);
CREATE TABLE "entries" (
    `id` text PRIMARY KEY NOT NULL, `patient_id` text NOT NULL, `type` text NOT NULL,
    `title` text NOT NULL DEFAULT 'Voce clinica', `date` integer NOT NULL, `content` text NOT NULL,
    `setting` text, `metadata` text, `attachments` text, `deleted_at` integer, `deletion_reason` text,
    `version` integer NOT NULL DEFAULT 1, `created_at` integer DEFAULT (unixepoch()), `updated_at` integer DEFAULT (unixepoch())
);
INSERT INTO "entries" VALUES('fixture-entry-1','fixture-1','note','ENC:AAAAAAAAAAAAAAAG:V9mrmqZyuBAC1r6dFd7uihZylnHha88J/+r8b2MJ4sirRH9L/w==',1751000000,'ENC:AAAAAAAAAAAAAAAH:f9Ttra+bJgkNNHPVbWJL1dcK2KPSv0s3UgxQam4MXNPvYEXno3k0t2FjHAPGznmczVKA8fK5YCVly0NQFF6o5/IEkg==','ambulatory',NULL,NULL,NULL,NULL,1,1751000000,1751000000);
CREATE TABLE "observations" (
    `id` text PRIMARY KEY NOT NULL, `patient_id` text NOT NULL, `code_system` text NOT NULL,
    `code` text NOT NULL, `display` text NOT NULL, `unit_system` text NOT NULL, `unit_code` text NOT NULL,
    `value` text NOT NULL, `notes` text, `observed_at` integer NOT NULL, `source` text DEFAULT 'manual',
    `version` integer NOT NULL DEFAULT 1, `created_at` integer DEFAULT (unixepoch()),
    `updated_at` integer DEFAULT (unixepoch()), `deleted_at` integer, `deletion_reason` text
);
INSERT INTO "observations" VALUES('fixture-observation-1','fixture-1','LOINC','4548-4','Emoglobina glicata','UCUM','%','6.8','ENC:AAAAAAAAAAAAAAAK:R1RMXjHGtaCEjKahxsZn+uogcfJ3iyebdhRs69Y68jDLTJW9ltfdrS/q',1747000000,'manual',1,1747000000,1747000000,NULL,NULL);
CREATE TABLE "patients" (
    `id` text PRIMARY KEY NOT NULL,
    `first_name` text NOT NULL,
    `last_name` text NOT NULL,
    `tax_code` text NOT NULL,
    `birth_date` integer,
    `address` text,
    `phone` text,
    `caregiver` text,
    `notes` text,
    `ai_summary` text,
    `is_adi` integer DEFAULT false,
    `is_archived` integer DEFAULT false,
    `ambulatory_id` text,
    `created_at` integer DEFAULT (unixepoch()),
    `updated_at` integer DEFAULT (unixepoch()), `document_insights` text, exemptions TEXT, diagnoses TEXT, monitoring_profile TEXT, status_reason TEXT, version INTEGER NOT NULL DEFAULT 1, deleted_at INTEGER, deletion_reason TEXT,
    archive_reason TEXT, archive_note TEXT
);
INSERT INTO "patients" VALUES('fixture-1','Mario','Rossi','RSSMRA80A01H501U',315532800,'ENC:AAAAAAAAAAAAAAAB:kfgaULL0iyxxqrjlrK4EAbI2RbuqfmeWa7pPdzpSsKGkJhYN','ENC:AAAAAAAAAAAAAAAC:HvZwM/Ds/YCnp2tC4UtIjP9i0jVuAvC+E0AXFbdl7i8=','ENC:AAAAAAAAAAAAAAAD:G3VH0aYgX233D0XMdVGBCPk25QgcyoBq7yuoDyVdIS0=',NULL,NULL,0,0,'AMB-1',1750000000,1750000000,NULL,'ENC:AAAAAAAAAAAAAAAE:YiYirgAMXJFJRb4rOx9w9r/8iX6V6TNEbCXxWr4=','ENC:AAAAAAAAAAAAAAAF:QEtECa/XSc9xIPCFZBMxAB/JnEc0DLmbmDNxt5jB2QbaCYXe16uEYFA0Cs21cshi/dLKNpsuPayb0DmbGn0yGzh0UIltr+pkvZws7cmz7h5TU/bJy8CBnrvMenbyFyv2KyzDfb7R5qGbTclD6avKUSeSUkHh',NULL,NULL,1,NULL,NULL,NULL,NULL);
CREATE TABLE "patients_to_ambulatories" (
    `patient_id` text NOT NULL, `ambulatory_id` text NOT NULL,
    `assigned_at` integer DEFAULT (unixepoch()),
    PRIMARY KEY(`patient_id`, `ambulatory_id`)
);
INSERT INTO "patients_to_ambulatories" VALUES('fixture-1','AMB-1',1750000000);
CREATE TABLE "therapies" (
    `id` text PRIMARY KEY NOT NULL, `patient_id` text NOT NULL, `drug_name` text NOT NULL,
    `aic` text, `atc` text, `active_principle` text, `dosage` text NOT NULL, `motivation` text,
    `diagnosis_code` text, `diagnosis_name` text, `status` text NOT NULL DEFAULT 'active',
    `start_date` integer NOT NULL, `end_date` integer, `version` integer NOT NULL DEFAULT 1,
    `created_at` integer DEFAULT (unixepoch()), `updated_at` integer DEFAULT (unixepoch()),
    `deleted_at` integer, `deletion_reason` text
);
INSERT INTO "therapies" VALUES('fixture-therapy-1','fixture-1','Metformina',NULL,'A10BA02','Metformina cloridrato','500mg 2x/die','ENC:AAAAAAAAAAAAAAAI:OoIggCkcWtTfkG57IPiDXe7yfJ3IodcHLJUxINRvJ7M=','E11.9','Diabete mellito tipo 2','active',1748000000,NULL,1,1748000000,1748000000,NULL,NULL);
COMMIT;
