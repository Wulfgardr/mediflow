/* @Codex */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Test harness URLs only; this never selects or validates a production executable. */
export function createSupervisorTestUrls(rootDirectory) {
  const rootUrl = pathToFileURL(`${path.resolve(rootDirectory)}${path.sep}`).href;
  return Object.freeze({
    rootUrl,
    loaderUrl: new URL('scripts/register-strip-types-loader.mjs', rootUrl).href,
  });
}
