import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { db } from '../db';
import * as formatCount from '../format-count';
import * as installedOllamaModels from '../installed-ollama-models';
import * as aiModels from '../ai-models';
import * as aiConfiguration from '../ai-settings-configuration';
import * as aiInsightSettings from '../ai-insight-settings';
import * as patientInsightKillSwitch from '../ai-patient-insight-kill-switch';
import * as documentSynthesisKillSwitch from '../ai-document-synthesis-kill-switch';
import * as smartImportKillSwitch from '../ai-smart-import-kill-switch';
import * as treatmentReasoningKillSwitch from '../ai-treatment-reasoning-kill-switch';
import * as documentRouterControlFlow from '../domain/documents/document-router-control-flow';
import type { useAiSettingsController } from './use-ai-settings-controller';

type Controller = ReturnType<typeof useAiSettingsController>;
type Effect = { dependencies?: readonly unknown[]; cleanup?: () => void };
const filename = resolve('lib/hooks/use-ai-settings-controller.ts');
export function harness(events: EventTarget) {
    const states: unknown[] = [], refs: { current: unknown }[] = [], effects: Effect[] = [], pending: (() => void)[] = [];
    let stateIndex = 0, refIndex = 0, effectIndex = 0;
    const toasts: { tone: string; title: string }[] = [];
    const effect = (callback: () => void | (() => void), dependencies?: readonly unknown[]) => {
        const index = effectIndex++, previous = effects[index];
        if (!previous || !dependencies || dependencies.some((value, i) => !Object.is(value, previous.dependencies?.[i]))) {
            pending.push(() => { previous?.cleanup?.(); effects[index] = { dependencies, cleanup: callback() || undefined }; });
        }
    };
    const react = {
        useState(initial: unknown) {
            const index = stateIndex++;
            if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
            return [states[index], (next: unknown) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
        },
        useRef(initial: unknown) { return refs[refIndex++] ?? (refs[refIndex - 1] = { current: initial }); },
        useEffect: effect, useLayoutEffect: effect,
    };
    const testModule = { exports: {} as { useAiSettingsController: () => Controller } };
    const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
    const imports: Record<string, unknown> = {
        react,
        '../format-count': formatCount,
        '@/lib/installed-ollama-models': installedOllamaModels,
        '@/lib/db': { db },
        '@/components/ui/toast-provider': { useToast: () => ({ showToast: (value: typeof toasts[number]) => toasts.push(value) }) },
        '@/lib/ai-models': aiModels,
        '@/lib/ai-settings-configuration': aiConfiguration,
        '@/lib/ai-insight-settings': aiInsightSettings,
        '@/lib/ai-patient-insight-kill-switch': patientInsightKillSwitch,
        '@/lib/ai-document-synthesis-kill-switch': documentSynthesisKillSwitch,
        '@/lib/ai-smart-import-kill-switch': smartImportKillSwitch,
        '@/lib/ai-treatment-reasoning-kill-switch': treatmentReasoningKillSwitch,
        '@/lib/domain/documents/document-router-control-flow': documentRouterControlFlow,
    };
    runInNewContext(compiled.outputText, { module: testModule, exports: testModule.exports, window: events,
        console: { error() {} }, setTimeout, clearTimeout, fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
        require(specifier: string) {
            if (!Object.hasOwn(imports, specifier)) throw new Error(`Unexpected hook dependency: ${specifier}`);
            return imports[specifier];
        },
    }, { filename });
    const render = () => {
        stateIndex = refIndex = effectIndex = 0;
        const result = testModule.exports.useAiSettingsController();
        while (pending.length) pending.shift()!();
        return result;
    };
    return { render, toasts, close: () => effects.forEach(value => value.cleanup?.()) };
}
