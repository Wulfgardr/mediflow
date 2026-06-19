/* @Codex */
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
      const hasExtension = /\.[cm]?[jt]sx?$/.test(specifier);
      if (!isRelative || hasExtension) {
        throw error;
      }

      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        throw error;
      }
    }
  },
});
