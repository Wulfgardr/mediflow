import test from 'node:test';
import assert from 'node:assert/strict';
/* @Codex */
import {
    classifyCheckupAgendaStatus,
    filterCheckupAgendaByStatus,
    sortCheckupAgenda,
} from './checkup-agenda.ts';

const NOW = new Date('2026-05-02T10:00:00.000Z');

test('classifyCheckupAgendaStatus respects completed and cancelled overrides', () => {
    assert.equal(
        classifyCheckupAgendaStatus({ date: NOW, status: 'completed' }, NOW),
        'completed',
    );
    assert.equal(
        classifyCheckupAgendaStatus({ date: NOW, status: 'cancelled' }, NOW),
        'cancelled',
    );
});

test('classifyCheckupAgendaStatus distinguishes overdue, today and upcoming by calendar day', () => {
    const yesterday = new Date(NOW);
    yesterday.setDate(yesterday.getDate() - 1);
    const todayLater = new Date(NOW);
    todayLater.setHours(todayLater.getHours() + 6);
    const tomorrow = new Date(NOW);
    tomorrow.setDate(tomorrow.getDate() + 1);
    assert.equal(classifyCheckupAgendaStatus({ date: yesterday }, NOW), 'overdue');
    assert.equal(classifyCheckupAgendaStatus({ date: todayLater }, NOW), 'today');
    assert.equal(classifyCheckupAgendaStatus({ date: tomorrow }, NOW), 'upcoming');
});

test('sortCheckupAgenda surfaces overdue then today then upcoming, completed and cancelled last', () => {
    const overdue = new Date(NOW);
    overdue.setDate(overdue.getDate() - 7);
    const upcomingSoon = new Date(NOW);
    upcomingSoon.setDate(upcomingSoon.getDate() + 1);
    const upcomingFar = new Date(NOW);
    upcomingFar.setDate(upcomingFar.getDate() + 8);
    const cancelledLater = new Date(NOW);
    cancelledLater.setDate(cancelledLater.getDate() + 2);

    const items = [
        { id: 'completed', date: NOW, status: 'completed' as const },
        { id: 'upcoming-far', date: upcomingFar, status: 'pending' as const },
        { id: 'overdue', date: overdue, status: 'pending' as const },
        { id: 'today', date: NOW, status: 'pending' as const },
        { id: 'cancelled', date: cancelledLater, status: 'cancelled' as const },
        { id: 'upcoming-soon', date: upcomingSoon, status: 'pending' as const },
    ];

    const sorted = sortCheckupAgenda(items, NOW);
    assert.deepEqual(
        sorted.map((item) => item.id),
        ['overdue', 'today', 'upcoming-soon', 'upcoming-far', 'completed', 'cancelled'],
    );
});

test('filterCheckupAgendaByStatus keeps only allowed buckets', () => {
    const overdue = new Date(NOW);
    overdue.setDate(overdue.getDate() - 2);
    const upcoming = new Date(NOW);
    upcoming.setDate(upcoming.getDate() + 4);

    const items = [
        { id: 'completed', date: NOW, status: 'completed' as const },
        { id: 'overdue', date: overdue, status: 'pending' as const },
        { id: 'upcoming', date: upcoming, status: 'pending' as const },
    ];

    const filtered = filterCheckupAgendaByStatus(items, new Set(['overdue']), NOW);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 'overdue');
});
