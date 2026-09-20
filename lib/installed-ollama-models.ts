/* @Codex */
/** Only an omitted tag and :latest identify the same installed model. */
export function canonicalInstalledModel(name: string): string {
    const leaf = name.slice(name.lastIndexOf('/') + 1);
    return leaf.endsWith(':latest') && leaf.indexOf(':') > 0 && leaf.indexOf(':') === leaf.lastIndexOf(':')
        ? name.slice(0, -7) : name;
}

export function isInstalledOllamaModel(models: readonly string[], name: string): boolean {
    return name.length > 0 && models.some(model => canonicalInstalledModel(model) === canonicalInstalledModel(name));
}

/** Parse the real /api/ai/models envelope; malformed data is not an empty inventory. */
export function parseInstalledOllamaModels(value: unknown): string[] {
    if (!value || typeof value !== 'object' || !('models' in value) || !Array.isArray(value.models)) {
        throw new Error('Elenco modelli non valido.');
    }
    const names: string[] = [];
    for (const model of value.models) {
        if (!model || typeof model !== 'object' || typeof model.name !== 'string'
            || !model.name.trim() || model.name !== model.name.trim() || /[\s\u0000-\u001f\u007f]/u.test(model.name)) {
            throw new Error('Elenco modelli non valido.');
        }
        if (!isInstalledOllamaModel(names, model.name)) names.push(model.name);
    }
    return names;
}
