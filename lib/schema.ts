import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// --- Users (Auth) ---
export const users = sqliteTable('users', {
    id: text('id').primaryKey(),
    username: text('username').notNull().unique(),
    displayName: text('display_name'),
    ambulatoryName: text('ambulatory_name'),
    role: text('role').default('user'),
    passwordHash: text('password_hash').notNull(),
    encryptedMasterKey: text('encrypted_master_key').notNull(),
    salt: text('salt').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// --- Patients ---
export const patients = sqliteTable('patients', {
    id: text('id').primaryKey(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    taxCode: text('tax_code').notNull(),
    birthDate: integer('birth_date', { mode: 'timestamp' }),
    address: text('address'),
    phone: text('phone'),
    caregiver: text('caregiver'),
    notes: text('notes'),
    aiSummary: text('ai_summary'),
    isAdi: integer('is_adi', { mode: 'boolean' }).default(false),
    isArchived: integer('is_archived', { mode: 'boolean' }).default(false),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// --- Clinical Entries ---
export const entries = sqliteTable('entries', {
    id: text('id').primaryKey(),
    patientId: text('patient_id').references(() => patients.id).notNull(),
    type: text('type').notNull(),
    date: integer('date', { mode: 'timestamp' }).notNull(),
    content: text('content').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// --- Therapies ---
export const therapies = sqliteTable('therapies', {
    id: text('id').primaryKey(),
    patientId: text('patient_id').references(() => patients.id).notNull(),
    drugName: text('drug_name').notNull(),
    dosage: text('dosage').notNull(),
    status: text('status').notNull(),
    startDate: integer('start_date', { mode: 'timestamp' }).notNull(),
    endDate: integer('end_date', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// --- Checkups / Appointments ---
export const checkups = sqliteTable('checkups', {
    id: text('id').primaryKey(),
    patientId: text('patient_id').references(() => patients.id).notNull(),
    date: integer('date', { mode: 'timestamp' }).notNull(),
    title: text('title').notNull(),
    status: text('status').default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// --- Conversations (AI Chat) ---
export const conversations = sqliteTable('conversations', {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    isArchived: integer('is_archived', { mode: 'boolean' }).default(false),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// --- Messages ---
export const messages = sqliteTable('messages', {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }).notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    metadata: text('metadata'),
    attachmentType: text('attachment_type'),
    attachmentBase64: text('attachment_base64'),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// --- Settings ---
export const settings = sqliteTable('settings', {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
});

// --- Attachments ---
export const attachments = sqliteTable('attachments', {
    id: text('id').primaryKey(),
    patientId: text('patient_id').references(() => patients.id).notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    size: integer('size').notNull(),
    path: text('path').notNull(),
    data: text('data'), // Base64 content
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// --- AIFA Drugs (Local Cache) ---
export const drugs = sqliteTable('drugs', {
    aic: text('aic').primaryKey(),
    name: text('name').notNull(),
    activePrinciple: text('active_principle'),
    company: text('company'),
    packaging: text('packaging'),
    class: text('class'),
    price: integer('price'), // stored as cents or float? using integer for simplicity or check import logic
    atc: text('atc'),
});
