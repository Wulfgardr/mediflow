import ts from 'typescript';

const SANITIZER = 'sanitizeClinicalRichTextHtml';
const SANITIZER_MODULE = '@/lib/clinical-rich-text';
const SINK_NAMES = new Set(['innerHTML', 'dangerouslySetInnerHTML']);

function staticName(node) {
    if (ts.isComputedPropertyName(node)) return ts.isStringLiteralLike(node.expression) ? node.expression.text : undefined;
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
    return undefined;
}

function htmlSink(node) {
    if (ts.isJsxAttribute(node) && staticName(node.name) === 'dangerouslySetInnerHTML') {
        return { name: 'dangerouslySetInnerHTML', value: node.initializer && ts.isJsxExpression(node.initializer)
            ? node.initializer.expression : undefined };
    }
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
        const name = staticName(node.name);
        if (SINK_NAMES.has(name)) return { name, value: node.initializer };
    }
    if (!ts.isBinaryExpression(node) || node.operatorToken.kind < ts.SyntaxKind.FirstAssignment
        || node.operatorToken.kind > ts.SyntaxKind.LastAssignment) return;
    const { left } = node;
    const name = ts.isPropertyAccessExpression(left) ? left.name.text
        : ts.isElementAccessExpression(left) && ts.isStringLiteralLike(left.argumentExpression) ? left.argumentExpression.text : undefined;
    if (SINK_NAMES.has(name)) {
        return { name, value: node.operatorToken.kind === ts.SyntaxKind.EqualsToken ? node.right : undefined };
    }
}

function sanitizerArgument(sink) {
    if (sink.name === 'innerHTML') return sink.value;
    if (!sink.value || !ts.isObjectLiteralExpression(sink.value) || sink.value.properties.length !== 1) return;
    const [property] = sink.value.properties;
    if (ts.isPropertyAssignment(property) && staticName(property.name) === '__html') return property.initializer;
}

export function validateHtmlSinkSource(source, fileName) {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
    const issues = [];
    let checker;
    function fromSanitizer(value) {
        if (!value || !ts.isCallExpression(value) || !ts.isIdentifier(value.expression)
            || value.expression.text !== SANITIZER || value.questionDotToken) return false;
        if (!checker) {
            const options = { noResolve: true, noLib: true, allowJs: true, types: [] };
            const host = ts.createCompilerHost(options);
            host.getSourceFile = name => name === fileName ? file : undefined;
            checker = ts.createProgram([fileName], options, host).getTypeChecker();
        }
        const [binding] = checker.getSymbolAtLocation(value.expression)?.declarations ?? [];
        if (!binding || !ts.isImportSpecifier(binding) || binding.propertyName) return false;
        const specifier = binding.parent.parent.parent.moduleSpecifier;
        return ts.isStringLiteral(specifier) && specifier.text === SANITIZER_MODULE;
    }
    function visit(node) {
        const sink = htmlSink(node);
        if (sink && !fromSanitizer(sanitizerArgument(sink))) {
            issues.push({
                line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
                message: `${sink.name} richiede ${SANITIZER} da ${SANITIZER_MODULE} direttamente nel valore. Usa textContent per il testo semplice.`,
            });
        }
        ts.forEachChild(node, visit);
    }
    visit(file);
    return issues;
}
