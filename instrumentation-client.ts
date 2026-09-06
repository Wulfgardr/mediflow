/* @Codex: Configure validation synchronously before client schemas initialize.
   Zod's optional JIT probe itself violates the application's no-eval CSP. */
import { config } from 'zod';

config({ jitless: true });
