import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

const checkout = new URL('../../../', import.meta.url).href;
const identity = createHash('sha256').update(checkout).digest('hex').slice(0, 16);
export const referenceDirectory = path.join(tmpdir(), `mediflow-chat-reference-${identity}`);
