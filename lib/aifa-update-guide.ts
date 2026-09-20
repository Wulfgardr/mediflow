/* @Codex: UI-only operation lifetime; no authority, writer or HTTP contract is minted here. */
import type { AifaCatalogClientStatus, AifaImportClientResult } from './aifa-importer';
import type { AifaCatalogManifestInput } from './aifa-catalog';

export type AifaGuidePhase = 'idle' | 'updating' | 'cancelling' | 'verifying'
    | 'confirming-import' | 'importing' | 'confirming-clear' | 'clearing';
export type AifaGuideState = {
    catalog: AifaCatalogClientStatus | null;
    observedAt: string | null;
    reading: boolean;
    phase: AifaGuidePhase;
    reconciliationRequired: boolean;
    notice: { tone: 'success' | 'warning' | 'error'; text: string } | null;
};
export const INITIAL_AIFA_GUIDE_STATE: AifaGuideState = {
    catalog: null, observedAt: null, reading: false, phase: 'idle', reconciliationRequired: false, notice: null,
};
type Ports = {
    read: () => Promise<AifaCatalogClientStatus>;
    update: (signal: AbortSignal) => Promise<AifaImportClientResult>;
    importFile: (file: File, manifest: AifaCatalogManifestInput) => Promise<AifaImportClientResult>;
    clear: () => Promise<void>;
};
type Confirm = () => Promise<boolean>;
const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const nonnegativeInteger = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Guard display data only. Server validators and the atomic catalog writer remain authoritative. */
export function assertAifaGuideStatus(value: unknown): asserts value is AifaCatalogClientStatus {
    if (!isRecord(value) || !nonnegativeInteger(value.count)
        || !['ready', 'unverified', 'not-imported'].includes(String(value.state))) {
        throw new Error('Stato del catalogo non leggibile. Rileggi stato.');
    }
    if (value.state === 'ready') {
        const m = value.manifest;
        if (!isRecord(m) || m.format !== 'mediflow.aifa-catalog-manifest.v1' || m.rowCount !== value.count
            || typeof m.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(m.sha256)
            || ['sourceUrl', 'version', 'downloadedAt', 'importedAt'].some(key => typeof m[key] !== 'string' || !m[key])
            || !Number.isFinite(Date.parse(m.importedAt as string))) {
            throw new Error('Manifest del catalogo non leggibile. Rileggi stato.');
        }
    } else if (value.manifest !== null || (value.state === 'not-imported' && value.count !== 0)) {
        throw new Error('Stato del catalogo incoerente. Rileggi stato.');
    }
}
function assertImportResult(value: unknown): asserts value is AifaImportClientResult {
    assertAifaGuideStatus(value);
    const result = value as AifaImportClientResult;
    if (result.state !== 'ready' || !nonnegativeInteger(result.rejectedRecords) || !nonnegativeInteger(result.totalRecords)) {
        throw new Error('Risposta di importazione non leggibile. Rileggi stato.');
    }
}
const errorText = (error: unknown) => error instanceof Error && error.message
    ? error.message.slice(0, 400) : 'Operazione non riuscita.';
const sameAcquisition = (a: AifaCatalogClientStatus, b: AifaCatalogClientStatus) => a.count === b.count
    && a.manifest?.sha256 === b.manifest?.sha256 && a.manifest?.importedAt === b.manifest?.importedAt
    && a.manifest?.version === b.manifest?.version && a.manifest?.sourceUrl === b.manifest?.sourceUrl;

/** One instance per mounted UI. Constructing it performs no request. */
export function createAifaUpdateGuide(ports: Ports, publish: (state: AifaGuideState) => void) {
    let state: AifaGuideState = { ...INITIAL_AIFA_GUIDE_STATE };
    let disposed = false;
    let generation = 0;
    let readSequence = 0;
    let operation: number | null = null;
    let controller: AbortController | null = null;
    const emit = (patch: Partial<AifaGuideState>) => {
        if (disposed) return;
        state = { ...state, ...patch };
        publish(state);
    };
    const current = (token: number) => !disposed && operation === token;
    const begin = (phase: AifaGuidePhase) => {
        if (disposed || operation !== null || state.reconciliationRequired) return null;
        const token = ++generation;
        operation = token;
        ++readSequence; // A pre-mutation GET must never overwrite post-mutation state.
        emit({ phase, reading: false, notice: null });
        return token;
    };
    const finish = (token: number) => {
        if (!current(token)) return;
        controller = null;
        operation = null;
        emit({ phase: 'idle' });
    };
    const reconcile = async (token: number, result: AifaCatalogClientStatus | null, success: string) => {
        emit({ phase: 'verifying', reconciliationRequired: true });
        const catalog = await ports.read();
        if (!current(token)) return;
        assertAifaGuideStatus(catalog);
        const matches = result ? sameAcquisition(catalog, result) : catalog.state === 'not-imported';
        emit({ catalog, observedAt: new Date().toISOString(), reconciliationRequired: false,
            notice: matches ? { tone: 'success', text: success }
                : { tone: 'warning', text: 'Operazione confermata, ma il catalogo corrente è diverso dal risultato ricevuto. È mostrato lo stato riletto; nessuna ripetizione automatica.' } });
    };
    return {
        async refresh() {
            if (disposed || operation !== null) return;
            const sequence = ++readSequence;
            const recovery = state.reconciliationRequired;
            emit({ reading: true });
            try {
                const catalog = await ports.read();
                if (disposed || sequence !== readSequence) return;
                assertAifaGuideStatus(catalog);
                emit({ catalog, observedAt: new Date().toISOString(), reading: false, reconciliationRequired: false,
                    notice: recovery || state.notice ? { tone: 'success', text: 'Stato del catalogo riletto. Nessun nuovo aggiornamento avviato.' } : null });
            } catch {
                if (!disposed && sequence === readSequence) emit({ reading: false,
                    notice: { tone: 'error', text: 'Lettura del catalogo non riuscita. L’ultimo stato osservato resta visibile; riprova con Rileggi stato.' } });
            }
        },
        async update() {
            const token = begin('updating');
            if (token === null) return;
            const abort = new AbortController();
            controller = abort;
            let acknowledged = false;
            try {
                const result = await ports.update(abort.signal);
                if (!current(token)) return;
                assertImportResult(result);
                if (result.rejectedRecords !== 0) throw new Error('Risultato AIFA inatteso. Rileggi stato.');
                acknowledged = true;
                await reconcile(token, result, abort.signal.aborted
                    ? 'Aggiornamento confermato dal server nonostante la richiesta di annullamento. Stato del catalogo riletto.'
                    : `Aggiornamento confermato: ${result.count.toLocaleString('it-IT')} confezioni. Stato del catalogo riletto.`);
            } catch (error) {
                if (current(token)) emit({ reconciliationRequired: true, notice: {
                    tone: acknowledged || abort.signal.aborted ? 'warning' : 'error',
                    text: acknowledged ? 'Importazione confermata dal server; rilettura non riuscita. Rileggi stato, senza ripetere il download.'
                        : abort.signal.aborted ? 'Richiesta interrotta. L’esito sul server non è confermato: rileggi stato prima di riprovare.'
                            : `${errorText(error)} Rileggi stato prima di riprovare; nessun nuovo download viene avviato automaticamente.`,
                } });
            } finally { finish(token); }
        },
        cancel() {
            if (disposed || !controller || state.phase !== 'updating') return;
            emit({ phase: 'cancelling' });
            controller.abort(); // A request to cancel is not an acknowledgement of rollback.
        },
        async importFile(file: File, manifest: AifaCatalogManifestInput, confirm: Confirm) {
            const token = begin('confirming-import');
            if (token === null) return;
            const capturedManifest = { ...manifest };
            let sent = false;
            let acknowledged = false;
            try {
                if (!await confirm() || !current(token)) return;
                emit({ phase: 'importing' });
                sent = true;
                const result = await ports.importFile(file, capturedManifest);
                if (!current(token)) return;
                assertImportResult(result);
                acknowledged = true;
                const text = result.rejectedRecords ? `Importazione confermata: ${result.count.toLocaleString('it-IT')} confezioni, ${result.rejectedRecords.toLocaleString('it-IT')} righe scartate. Stato riletto.`
                    : `Importazione confermata: ${result.count.toLocaleString('it-IT')} confezioni. Stato riletto.`;
                await reconcile(token, result, text);
            } catch (error) {
                if (current(token)) emit({ reconciliationRequired: sent, notice: { tone: 'error', text: acknowledged
                    ? 'Importazione confermata; rilettura non riuscita. Rileggi stato, senza ricaricare il file.'
                    : `${errorText(error)}${sent ? ' Rileggi stato prima di riprovare.' : ''}` } });
            } finally { finish(token); }
        },
        async clear(confirm: Confirm) {
            const token = begin('confirming-clear');
            if (token === null) return;
            let sent = false;
            let acknowledged = false;
            try {
                if (!await confirm() || !current(token)) return;
                emit({ phase: 'clearing' });
                sent = true;
                await ports.clear();
                if (!current(token)) return;
                acknowledged = true;
                await reconcile(token, null, 'Svuotamento confermato. Stato del catalogo riletto.');
            } catch (error) {
                if (current(token)) emit({ reconciliationRequired: sent, notice: { tone: 'error', text: acknowledged
                    ? 'Svuotamento confermato; rilettura non riuscita. Rileggi stato.'
                    : `${errorText(error)}${sent ? ' Rileggi stato prima di riprovare.' : ''}` } });
            } finally { finish(token); }
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            ++readSequence;
            operation = null;
            controller?.abort();
            controller = null;
        },
    };
}
