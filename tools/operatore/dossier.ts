import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { db } from '@/lib/db';
import { createDossierPorts } from '@/lib/document-dossier-ports';
import {
    DossierIdentityBlocked, acceptVerifiedAndApply, acquireDossierGroup, buildDossierInventory, dossierGroupDestination, evaluateDraftGroupIdentity,
    type DossierDraftGroup, type DossierInputFile, type DossierPatient,
} from '@/lib/document-dossier-session';
import { DOSSIER_PREPARED_MAX_BYTES, parsePreparedExtraction, type PreparedExtraction } from '@/lib/domain/documents/dossier-prepared';
import { dossierPatientCode, sourceConfirmsBatchIdentity } from '@/lib/dossier-new-patient-entry';
import { dossierBatchProposals, type DossierBatchProposal } from '@/lib/dossier-batch-patients';
import { createDossierBatchPatient, readDossierBatchScope } from '@/lib/dossier-batch-patient-client';
import { DOSSIER_BATCH_LIMIT, dossierBatchDigest, dossierBatchRowDigest, type DossierBatchRow } from '@/lib/patient-document-batch-contract';
import { requestPatientDocument } from '@/lib/patient-document-create-client';

const TIPI: Record<string, string> = {
    '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.heic': 'image/heic', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.doc': 'application/msword', '.rtf': 'application/rtf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.odt': 'application/vnd.oasis.opendocument.text',
    '.xml': 'application/xml', '.p7m': 'application/pkcs7-mime', '.eml': 'message/rfc822', '.zip': 'application/zip',
};

export type EsitoScheda = Readonly<{
    gruppo: string;
    cf4: string;
    scheda: 'esistente' | 'creata' | 'non creata' | 'da confermare' | 'bloccata' | 'incerta';
    motivo?: string;
    originaliSalvati: number;
    originaliGiaPresenti: number;
    originaliSaltati: number;
    originaliFalliti: number;
    fattiScritti: number;
    vociDaDecidere: number;
}>;

export type RiepilogoDossier = Readonly<{
    documenti: number;
    gruppi: number;
    schedeCreate: number;
    schedeNonCreate: number;
    schedeAggiornate: number;
    gruppiDaConfermare: number;
    gruppiBloccati: number;
    originaliSalvati: number;
    fattiScritti: number;
    vociDaDecidere: number;
    esiti: EsitoScheda[];
}>;

export type OpzioniDossier = Readonly<{
    cartella: string;
    estrazione: string | null;
    pin: string;
    creaSchede: boolean;
    applica: boolean;
    avanzamento?: (messaggio: string) => void;
}>;

async function fileDellaCartella(cartella: string): Promise<DossierInputFile[]> {
    const radice = path.resolve(cartella);
    const nomeRadice = path.basename(radice);
    const voci = await readdir(radice, { recursive: true, withFileTypes: true });
    const files: DossierInputFile[] = [];
    for (const voce of voci) {
        if (!voce.isFile() || voce.name.startsWith('.')) continue;
        const assoluto = path.join(voce.parentPath, voce.name);
        const relativo = [nomeRadice, ...path.relative(radice, assoluto).split(path.sep)].join('/');
        const info = await stat(assoluto);
        files.push({
            name: voce.name, size: info.size, type: TIPI[path.extname(voce.name).toLowerCase()] ?? '', lastModified: info.mtimeMs,
            relativePath: relativo, read: async () => new Uint8Array(await readFile(assoluto)),
        });
    }
    return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function leggiEstrazione(file: string | null): Promise<PreparedExtraction | null> {
    if (!file) return null;
    const info = await stat(file);
    if (info.size > DOSSIER_PREPARED_MAX_BYTES) throw new Error('Estrazione preparata oltre il limite di 20 MiB.');
    const letta = parsePreparedExtraction(await readFile(file, 'utf8'));
    if (!letta.ok) throw new Error(letta.error);
    return letta.value;
}

function gruppoAnonimo(chiave: string): string {
    if (chiave.startsWith('cf:')) return `cf:…${chiave.slice(-4)}`;
    if (chiave.startsWith('nome:')) return 'nome';
    return chiave;
}

function cf4(group: DossierDraftGroup, patients: readonly DossierPatient[], patientId: string | null): string {
    const codice = patients.find(patient => patient.id === patientId)?.taxCode
        || group.sources.flatMap(source => source.taxCodes).find(code => code.role === 'patient_cf')?.value || '';
    return codice ? codice.slice(-4) : '----';
}

function codiceDocumentato(gruppo: DossierDraftGroup): string | null {
    const identita = evaluateDraftGroupIdentity(gruppo, [], null);
    if (identita.blocking || identita.uncertainDocuments?.length || identita.documentPatientCodes.length !== 1) return null;
    const [codice] = identita.documentPatientCodes;
    const fonti = gruppo.sources.filter(fonte => fonte.status === 'ready');
    return fonti.length > 0 && fonti.every(fonte => dossierPatientCode(fonte) === codice) ? codice : null;
}

function righeDaCreare(proposte: readonly DossierBatchProposal[]) {
    return proposte.filter(proposta => !proposta.blocked).map(proposta => {
        const segmenti = proposta.source.relativePath.split('/');
        const row: DossierBatchRow = {
            sourceName: segmenti.length > 2 ? segmenti.slice(1).join('/') : proposta.source.relativePath,
            sourceDigest: proposta.source.sha256,
            identity: proposta.identity,
        };
        return { proposta, row };
    });
}

async function creaSchede(proposte: readonly DossierBatchProposal[], pin: string, signal: AbortSignal,
    avanzamento: (messaggio: string) => void) {
    const righe = righeDaCreare(proposte).slice(0, DOSSIER_BATCH_LIMIT);
    const esiti = new Map<string, { patientId?: string; motivo?: string; incerta?: boolean }>();
    for (const proposta of proposte) if (proposta.blocked) esiti.set(proposta.groupKey, { motivo: proposta.blocked });
    if (!righe.length) return esiti;
    const scope = await readDossierBatchScope();
    const digests = await Promise.all(righe.map(({ row }) => dossierBatchRowDigest(row)));
    const fingerprint = await dossierBatchDigest(digests);
    const revisione = await requestPatientDocument({ operation: 'batch-review', rows: digests }, signal);
    const batchId = revisione.body?.batchId;
    if (revisione.status !== 200 || revisione.body?.fingerprint !== fingerprint || typeof batchId !== 'string') {
        throw new Error('MediFlow non ha preparato la conferma del lotto.');
    }
    try {
        const conferma = await requestPatientDocument({ operation: 'batch-confirm', batchId, fingerprint, pin }, signal);
        if (conferma.status !== 200 || conferma.body?.status !== 'confirmed') throw new Error('PIN di conferma rifiutato da MediFlow.');
        for (const [indice, { proposta, row }] of righe.entries()) {
            avanzamento(`Creazione schede: ${indice + 1} di ${righe.length}`);
            const esito = await createDossierBatchPatient(batchId, scope, row, proposta.source, signal);
            esiti.set(proposta.groupKey, esito.kind === 'created' ? { patientId: esito.patientId, ...(esito.warning ? { motivo: esito.warning } : {}) }
                : esito.kind === 'rejected' ? { motivo: esito.reason } : { incerta: true, motivo: 'Esito da verificare: rilancia il comando.' });
        }
    } finally {
        await requestPatientDocument({ operation: 'batch-close', batchId }, signal).catch(() => null);
    }
    return esiti;
}

export async function importaDossier(opzioni: OpzioniDossier): Promise<RiepilogoDossier> {
    const avanzamento = opzioni.avanzamento ?? (() => {});
    const signal = db.getSessionReadSignal();
    const isCurrent = () => !signal.aborted && db.isKeySet();
    const ports = createDossierPorts();
    const estrazione = await leggiEstrazione(opzioni.estrazione);
    const files = await fileDellaCartella(opzioni.cartella);
    avanzamento(`Lettura locale di ${files.length} file`);
    const gruppi = await buildDossierInventory(ports, files, { signal, isCurrent, prepared: estrazione,
        onProgress: (fatti, totale) => avanzamento(`Lettura locale: ${fatti} di ${totale}`) });
    let pazienti = await ports.listPatients(signal);
    const collegamenti: Record<string, string> = {};
    const codici = new Map(gruppi.map(gruppo => [gruppo.key, codiceDocumentato(gruppo)]));
    const daConfermare = new Set<string>();
    const proposte = opzioni.creaSchede ? dossierBatchProposals(gruppi, pazienti, collegamenti).filter(proposta => {
        if (codici.get(proposta.groupKey) === proposta.identity.taxCode && sourceConfirmsBatchIdentity(proposta.source, proposta.identity)) return true;
        daConfermare.add(proposta.groupKey);
        return false;
    }) : [];
    const creazioni = opzioni.creaSchede
        ? await creaSchede(proposte, opzioni.pin, signal, avanzamento)
        : new Map<string, { patientId?: string; motivo?: string; incerta?: boolean }>();
    for (const [gruppo, esito] of creazioni) if (esito.patientId) collegamenti[gruppo] = esito.patientId;
    if (creazioni.size) pazienti = await ports.listPatients(signal);

    const esiti: EsitoScheda[] = [];
    for (const gruppo of gruppi) {
        const creazione = creazioni.get(gruppo.key);
        const patientId = dossierGroupDestination(gruppo, pazienti, collegamenti[gruppo.key]) || null;
        const base = { gruppo: gruppoAnonimo(gruppo.key), cf4: cf4(gruppo, pazienti, patientId), originaliSalvati: 0, originaliGiaPresenti: 0,
            originaliSaltati: 0, originaliFalliti: 0, fattiScritti: 0, vociDaDecidere: 0 };
        if (!codici.get(gruppo.key) || daConfermare.has(gruppo.key)) {
            const identita = evaluateDraftGroupIdentity(gruppo, pazienti, patientId);
            esiti.push({ ...base, scheda: identita.blocking ? 'bloccata' : 'da confermare',
                motivo: 'Verifica nel Dossier a chi si riferiscono i documenti.' });
            continue;
        }
        if (!patientId) {
            esiti.push({ ...base, scheda: creazione?.incerta ? 'incerta' : creazione ? 'non creata' : 'da confermare',
                ...(creazione?.motivo ? { motivo: creazione.motivo } : { motivo: 'Nessuna scheda con questo codice fiscale.' }) });
            continue;
        }
        const identita = evaluateDraftGroupIdentity(gruppo, pazienti, patientId);
        const scheda = creazione?.patientId ? 'creata' as const : 'esistente' as const;
        if (identita.blocking) { esiti.push({ ...base, scheda: 'bloccata', motivo: identita.message }); continue; }
        if (identita.status !== 'matched') { esiti.push({ ...base, scheda: 'da confermare', motivo: identita.message }); continue; }
        if (!opzioni.applica) { esiti.push({ ...base, scheda }); continue; }
        avanzamento(`Originali della scheda …${base.cf4}`);
        let acquisiti;
        try { acquisiti = await acquireDossierGroup(ports, { group: gruppo, patientId, confirmed: true, signal, isCurrent }); }
        catch (error) {
            esiti.push({ ...base, scheda: 'bloccata', motivo: error instanceof DossierIdentityBlocked ? error.message : 'Acquisizione interrotta.' });
            continue;
        }
        const digests = new Map(gruppo.sources.map(fonte => [fonte.key, fonte.sha256]));
        const attachmentSources = new Map<string, string>();
        for (const esito of acquisiti) {
            const digest = digests.get(esito.key);
            if (digest && (esito.status === 'stored' || esito.status === 'reused') && esito.verified) attachmentSources.set(esito.attachmentId, digest);
        }
        const applicati = await acceptVerifiedAndApply(ports, { patientId, signal, isCurrent, attachmentSources });
        esiti.push({
            ...base, scheda,
            originaliSalvati: acquisiti.filter(item => item.status === 'stored').length,
            originaliGiaPresenti: acquisiti.filter(item => item.status === 'reused'
                || item.status === 'skipped' && item.reason === 'already_imported').length,
            originaliSaltati: acquisiti.filter(item => item.status === 'skipped' && item.reason !== 'already_imported').length,
            originaliFalliti: acquisiti.filter(item => item.status === 'failed').length,
            fattiScritti: applicati.applied.reduce((somma, item) => somma + item.outcomes.filter(voce => voce.outcome === 'applied').length, 0),
            vociDaDecidere: applicati.leftPending,
        });
    }
    const conta = (filtro: (esito: EsitoScheda) => boolean) => esiti.filter(filtro).length;
    return {
        documenti: files.length,
        gruppi: gruppi.length,
        schedeCreate: conta(esito => esito.scheda === 'creata'),
        schedeNonCreate: conta(esito => esito.scheda === 'non creata' || esito.scheda === 'incerta'),
        schedeAggiornate: conta(esito => esito.originaliSalvati > 0 || esito.fattiScritti > 0),
        gruppiDaConfermare: conta(esito => esito.scheda === 'da confermare'),
        gruppiBloccati: conta(esito => esito.scheda === 'bloccata'),
        originaliSalvati: esiti.reduce((somma, esito) => somma + esito.originaliSalvati, 0),
        fattiScritti: esiti.reduce((somma, esito) => somma + esito.fattiScritti, 0),
        vociDaDecidere: esiti.reduce((somma, esito) => somma + esito.vociDaDecidere, 0),
        esiti,
    };
}
