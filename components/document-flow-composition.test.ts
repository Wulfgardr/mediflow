/* @Codex: source-contract tests, not rendered UI or route execution evidence. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const upload = () => readFile('components/document-upload.tsx', 'utf8');

test('one synthesis composer follows the list rather than being repeated inside source disclosure', async () => {
    const source = await upload();
    assert.equal((source.match(/<DocumentSynthesisFabricReviewCard\b/g) ?? []).length, 1);
    assert.match(source, /Documento da sintetizzare/u);
    assert.match(source, /Scegli un documento/u);
    assert.match(source, /selectedAttachment && documentSynthesisEnabled && <DocumentSynthesisFabricReviewCard/u);
    assert.match(source, /key=\{selectedAttachment.id\}/u);
    assert.ok(source.indexOf('<DocumentSynthesisFabricReviewCard') > source.indexOf('data-document-area="summary"'));
    assert.match(source, /Cambiare documento chiude la proposta corrente/u);
});

test('initial list errors, refresh errors and empty state are distinct; retry is a real scoped read', async () => {
    const source = await upload();
    assert.match(source, /db\.attachments\.query\(\{ patientId \}\)\.toArray\(\)/u);
    assert.doesNotMatch(source, /db\.attachments\.filter/u);
    assert.match(source, /useLiveQueryState/u);
    assert.match(source, /const currentAttachments = listError \? undefined : attachments/u);
    assert.match(source, /Elenco documenti non disponibile/u);
    assert.match(source, /onClick=\{refreshAttachments\} disabled=\{listLoading\}>Riprova elenco/u);
    assert.match(source, /currentAttachments\?\.length === 0 && !listLoading/u);
    assert.match(source, /!listError && attachments === undefined/u);
    assert.match(source, /review_required · esito non confermato/u);
    assert.match(source, /Un errore di rete o di sessione non dimostra unsupported_local_extraction/u);
});

test('the persisted attachment writer is behind the single-flight queue, not an extraction or synthesis event', async () => {
    const source = await upload();
    assert.match(source, /createDocumentUploadQueue<File>/u);
    assert.match(source, /persist: \(file, data\) => db\.attachments\.add/u);
    assert.match(source, /onDrop, disabled: isProcessing, maxFiles: 10, maxSize: 25 \* 1024 \* 1024/u);
    assert.match(source, /const task = uploadQueue.start\(acceptedFiles\)/u);
    const onDrop = source.slice(source.indexOf('const onDrop ='), source.indexOf('const { getRootProps'));
    assert.doesNotMatch(onDrop, /requestAnyDoc|controller\.run|synthesis|\.patients\.|\.insights\./u);
    assert.match(source, /Interrompi coda/u);
    assert.match(source, /Un file già inviato può essere salvato/u);
    assert.match(source, /unconfirmed\.length/u);
});

test('source views retire on identity, security lock and full navigation, without claiming write rollback', async () => {
    const source = await upload();
    assert.match(source, /isLocked \|\| !isAuthenticated \|\| authRecoveryState !== 'ready'/u);
    assert.match(source, /JSON.stringify\(\[props.patientId, user\?\.id\]\)/u);
    assert.match(source, /window.addEventListener\('pagehide', retireDocument\)/u);
    assert.match(source, /window.removeEventListener\('pagehide', retireDocument\)/u);
    assert.match(source, /uploadQueue.cancel\(\)/u);
    assert.match(source, /activeExtraction.current\?\.controller.abort\(\)/u);
    assert.match(source, /activeDelete.current = null/u);
    assert.match(source, /const viewingFile = currentAttachments\?\.find/u);
});

test('delete confirmation is fenced and failures remain visible; only successful deletion clears source state', async () => {
    const source = await upload();
    const start = source.indexOf('const handleDelete =');
    const end = source.indexOf('const interruptLocalExtraction =');
    const body = source.slice(start, end);
    assert.match(body, /if \(!confirmed \|\| activeDelete.current !== operation\) return/u);
    assert.ok(body.indexOf('await db.attachments.delete(file.id)') > body.indexOf('await confirm('));
    assert.ok(body.indexOf('setViewingId') > body.indexOf('await db.attachments.delete(file.id)'));
    assert.match(body, /catch \{[\s\S]*setDeleteErrorId\(file.id\)/u);
    assert.match(source, /Eliminazione non confermata/u);
    assert.doesNotMatch(source, /console\.(log|error)|showToast/u);
});

test('legacy importer cannot consume and silently discard an unpersisted file', async () => {
    const source = await readFile('components/pdf-importer.tsx', 'utf8');
    assert.doesNotMatch(source, /useDropzone|<input|FileReader|fetch\(|\.add\(|onDataExtracted\(/u);
    assert.match(source, /Salva prima il paziente/u);
    assert.match(source, /Carica documenti/u);
    assert.match(source, /nessun|non viene/u);
});

test('terminal model display is the existing host receipt, while retry resets rather than generating', async () => {
    const source = await readFile('components/document-synthesis-fabric-review-card.tsx', 'utf8');
    assert.match(source, /phase !== 'terminal' && <FunctionModelPicker picker=\{picker\}/u);
    assert.match(source, /providerBindingReceipt\.model/u);
    assert.match(source, /publication\.citations\.map/u);
    assert.match(source, /onClick=\{cancelPreview\}[\s\S]*Prepara un nuovo tentativo/u);
    assert.match(source, /aria-busy=\{phase === 'loading' \|\| phase === 'running'\}/u);
});

test('actual route files retain authenticated operation acquisition and preview model dispatch', async () => {
    for (const phase of ['capture', 'ingest', 'preview']) {
        const source = await readFile(`app/api/ai/document-synthesis/${phase}/route.ts`, 'utf8');
        assert.match(source, /runtime = 'nodejs'/u);
        assert.match(source, /dynamic = 'force-dynamic'/u);
        assert.match(source, /acquireOperation: acquireDocumentSynthesisProductionOperation/u);
        if (phase === 'preview') assert.match(source, /withFunctionModelDispatch\('document_synthesis'/u);
    }
});

test('collapsed document metadata does not manufacture empty counts on pending or failed reads', async () => {
    const source = await readFile('app/patients/[id]/modules/page.tsx', 'utf8');
    assert.match(source, /const \{ data: attachments, error: attachmentsError \} = useLiveQueryState/u);
    assert.match(source, /count=\{attachmentsError \|\| attachments === undefined \? undefined/u);
    assert.match(source, /summary=\{attachmentsError \? 'Conteggio non disponibile/u);
});
