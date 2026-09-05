/* @Codex */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const value = JSON.parse(process.env.MEDIFLOW_DURABLE_REVIEW_RECORD || 'null');
const moduleUrl = pathToFileURL(path.join(process.cwd(), 'lib/ai-providers/fabric/durable-review-record-store.ts')).href;
const { createDurableReviewRecordStore } = await import(moduleUrl);
const store = createDurableReviewRecordStore();
const record = process.argv[2] === 'create' ? store.create(value) : store.read(value?.record?.reviewId ?? value);
process.stdout.write(JSON.stringify(record));
