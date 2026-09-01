#!/usr/bin/env node
/* @Codex */
import { toMarkdownBytes } from '@firecrawl/anydoc/index.js';

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_MARKDOWN_BYTES = 8 * 1024 * 1024;
const MAX_PAGE_COUNT = 500;
const PAGE_ROUTING_SCHEMA_VERSION = 'mediflow.anydoc_page_routing.v1';
const RESOURCE_LIMIT_EXIT = 24;
const IO_EXIT = 26;
const FAILURE_EXIT = new Map([
    ['unsupported', 20], ['needsOcr', 21], ['malformed', 22], ['encrypted', 23],
    ['resourceLimit', RESOURCE_LIMIT_EXIT], ['missingPart', 25], ['io', IO_EXIT],
]);

async function readSourceBytes() {
    const chunks = [];
    let byteLength = 0;
    for await (const chunk of process.stdin) {
        byteLength += chunk.byteLength;
        if (byteLength > MAX_SOURCE_BYTES) return null;
        chunks.push(chunk);
    }
    return byteLength > 0 ? Buffer.concat(chunks, byteLength) : null;
}

function failureCode(error) {
    try {
        if (error instanceof Error && typeof error.code === 'string') return FAILURE_EXIT.get(error.code) ?? IO_EXIT;
    } catch { return IO_EXIT; }
    return IO_EXIT;
}

/* @Codex */
function pageRoutingEnvelope(error) {
    try {
        if (!(error instanceof Error) || error.code !== 'needsOcr' || !Array.isArray(error.pages)) return null;
        const pages = error.pages;
        const pageCount = error.pageCount;
        if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGE_COUNT
            || pages.length < 1 || pages.length > pageCount) return null;
        let previous = 0;
        for (const page of pages) {
            if (!Number.isSafeInteger(page) || page <= previous || page > pageCount) return null;
            previous = page;
        }
        return `{"schemaVersion":"${PAGE_ROUTING_SCHEMA_VERSION}","pages":[${pages.join(',')}],"pageCount":${pageCount}}`;
    } catch { return null; }
}

try {
    const bytes = await readSourceBytes();
    if (bytes === null) {
        process.exitCode = RESOURCE_LIMIT_EXIT;
    } else {
        const markdown = await toMarkdownBytes(bytes);
        const output = Buffer.from(markdown, 'utf8');
        if (output.byteLength > MAX_MARKDOWN_BYTES) process.exitCode = RESOURCE_LIMIT_EXIT;
        else process.stdout.write(output);
    }
} catch (error) {
    const routing = pageRoutingEnvelope(error);
    if (routing !== null) process.stdout.write(routing);
    process.exitCode = routing !== null ? 21 : failureCode(error);
}
