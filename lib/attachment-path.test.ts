import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttachmentPath } from './attachment-path.ts';

test('buildAttachmentPath strips directory information and preserves a safe basename', () => {
    assert.equal(
        buildAttachmentPath('/Users/demo/Desktop/referto finale.pdf', 'referto finale.pdf', 'att-1'),
        'attachments/att-1-referto-finale.pdf'
    );
});

test('buildAttachmentPath normalizes nested relative paths to a logical attachment reference', () => {
    assert.equal(
        buildAttachmentPath('uploads/../../secret/report.png', 'report.png', 'att-2'),
        'attachments/att-2-report.png'
    );
});

test('buildAttachmentPath falls back to the attachment name when the input path is missing', () => {
    assert.equal(
        buildAttachmentPath('', 'ECG marzo 2026.pdf', 'att-3'),
        'attachments/att-3-ECG-marzo-2026.pdf'
    );
});

test('buildAttachmentPath preserves canonical attachment paths without duplicating the id prefix', () => {
    assert.equal(
        buildAttachmentPath('attachments/att-4-referto-finale.pdf', 'referto finale.pdf', 'att-4'),
        'attachments/att-4-referto-finale.pdf'
    );
});
