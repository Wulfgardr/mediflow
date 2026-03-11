/* @Codex */
type PdfJsServerModule = {
    getDocument: (source: unknown) => { promise: Promise<any> };
    GlobalWorkerOptions?: { workerSrc: string };
};

/* @Codex */
class MediFlowDOMMatrix {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
}

/* @Codex */
class MediFlowPath2D {
    addPath() { }
    arc() { }
    arcTo() { }
    bezierCurveTo() { }
    closePath() { }
    ellipse() { }
    lineTo() { }
    moveTo() { }
    quadraticCurveTo() { }
    rect() { }
}

/* @Codex */
function installPdfJsNodeShims() {
    const globals = globalThis as unknown as Record<string, unknown>;

    if (!globals.DOMMatrix) {
        Reflect.set(globals, 'DOMMatrix', MediFlowDOMMatrix);
    }

    if (!globals.Path2D) {
        Reflect.set(globals, 'Path2D', MediFlowPath2D);
    }
}

/* @Codex */
const runtimeImport = new Function(
    'specifier',
    'return import(specifier);',
) as (specifier: string) => Promise<PdfJsServerModule>;

/* @Codex */
export async function loadPdfJsServer(): Promise<PdfJsServerModule> {
    installPdfJsNodeShims();
    const pdfjs = await runtimeImport('pdfjs-dist/legacy/build/pdf');

    if (pdfjs?.GlobalWorkerOptions) {
        pdfjs.GlobalWorkerOptions.workerSrc = '';
    }

    return pdfjs;
}
