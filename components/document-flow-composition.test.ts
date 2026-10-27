import { sourceVariableDeclaration } from '../scripts/test-support/source-structure.mjs';
/* source-contract tests, not rendered UI or route execution evidence. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
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
    assert.match(source, /db\.attachments\.query\(\{ patientId, metadataOnly: true \}\)\.toArray\(\)/u);
    assert.doesNotMatch(source, /db\.attachments\.filter/u);
    assert.match(source, /useLiveQueryState/u);
    assert.match(source, /const currentAttachments = listError \? undefined : attachments/u);
    assert.match(source, /Elenco documenti non disponibile/u);
    assert.match(source, /onClick=\{refreshAttachments\} disabled=\{listLoading\}>Riprova elenco/u);
    assert.match(source, /currentAttachments\?\.length === 0 && !listLoading/u);
    assert.match(source, /listLoading \? 'Caricamento documenti…'/u);
    assert.match(source, /Estrazione da rivedere · esito non confermato/u);
    assert.match(source, /Un errore di rete o di sessione non indica necessariamente che l’estrazione locale non sia supportata/u);
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
    const body = sourceVariableDeclaration(source, 'handleDelete');
    const orderedSteps = [
        'if (activeDelete.current) return;',
        'activeDelete.current = operation;',
        'const attachmentPrecondition = captureAttachmentWritePrecondition(file);',
        'await confirm(',
        'if (!confirmed || activeDelete.current !== operation) return;',
        'await db.attachments.delete(file.id, { attachmentPrecondition });',
        'if (activeDelete.current !== operation) return;',
        'setLocalExtraction((value)',
        'setViewingId((value)',
        'setSelectedId((value)',
        '} catch {',
        'if (activeDelete.current === operation) setDeleteErrorId(file.id);',
        '} finally {',
    ];
    let previous = -1;
    for (const step of orderedSteps) {
        const position = body.indexOf(step);
        assert.ok(position > previous, `delete step must exist in order: ${step}`);
        previous = position;
    }
    assert.equal((body.match(/captureAttachmentWritePrecondition\(file\)/gu) ?? []).length, 1);
    assert.equal((body.match(/db\.attachments\.delete\(/gu) ?? []).length, 1);
    assert.doesNotMatch(body, /db\.attachments\.(get|query)|fetch\(/u);
    const failureAndCleanup = body.slice(body.indexOf('} catch {'));
    assert.doesNotMatch(failureAndCleanup, /setLocalExtraction|setViewingId|setSelectedId/u);
    assert.match(failureAndCleanup, /if \(activeDelete.current === operation\) \{ activeDelete.current = null; setDeletingId\(null\); \}/u);
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
    assert.match(source, /\(phase !== 'terminal' \|\| picker\.view\.remote\) && <FunctionModelPicker picker=\{picker\}/u);
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

test('the actual synthesis picker condition keeps remote terminal recovery reachable and hides the local terminal selector', async () => {
    const source = await readFile('components/document-synthesis-fabric-review-card.tsx', 'utf8');
    const ast = ts.createSourceFile('document-synthesis.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const conditions: string[] = [];
    function visit(node: ts.Node) {
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
            && ts.isJsxSelfClosingElement(node.right) && node.right.tagName.getText(ast) === 'FunctionModelPicker') conditions.push(node.left.getText(ast));
        ts.forEachChild(node, visit);
    }
    visit(ast); assert.equal(conditions.length, 1);
    for (const [phase, remote, visible] of [
        ['idle', undefined, true], ['confirm', undefined, true], ['terminal', undefined, false],
        ['terminal', { completed: true }, true], ['terminal', { error: 'expired' }, true],
    ] as const) {
        const condition = runInNewContext(conditions[0]!, { phase, picker: { view: { remote } } });
        assert.equal(Boolean(condition), visible, `${phase}/${remote ? 'remote' : 'local'} picker visibility`);
    }
});
