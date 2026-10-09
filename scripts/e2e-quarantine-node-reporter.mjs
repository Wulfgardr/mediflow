import { errorMessages, sourcePath } from './e2e-quarantine.mjs';

export default async function* reporter(events) {
  for await (const event of events) {
    const { type, data } = event;
    if (type === 'test:fail' && !data.todo) {
      yield JSON.stringify({ type, file: sourcePath(data.file), title: data.name,
        failureType: data.details.error?.failureType, errors: errorMessages(data.details.error) }) + '\n';
    } else if (type === 'test:summary') {
      yield JSON.stringify({ type, file: data.file, counts: data.counts, success: data.success }) + '\n';
    }
  }
}
