import { spawn } from 'node:child_process';
import path from 'node:path';
import { deny, type LocalOperationPlan } from '../contract.ts';
import { specialistFieldLabel } from './prescription.ts';

export type SpecialistNativeSurface = Readonly<{
    select(plan: Readonly<LocalOperationPlan>): Promise<'selected' | 'cancelled'>;
    confirm(plan: Readonly<LocalOperationPlan>): Promise<boolean>;
}>;

/** Host-owned executable; neither path nor request is accepted from the remote protocol. */
export function createSpecialistNativeSurface(executable: string): SpecialistNativeSurface {
    if (!path.isAbsolute(executable) || process.platform !== 'darwin') deny();
    function request(action: 'select' | 'approve', plan: Readonly<LocalOperationPlan>): Promise<string> {
        const payload = JSON.stringify({ action, title: action === 'select' ? 'Seleziona la pratica inventata' : 'Rileggi e autorizza la prescrizione inventata',
            lines: [`Pratica: ${plan.practiceId}`, `Account: ${plan.portalAccountId}`, ...plan.fields.map(field => `${specialistFieldLabel(field.name)}: ${field.value}`)] });
        if (Buffer.byteLength(payload) > 65536) deny();
        return new Promise(resolve => {
            const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'] });
            let result = '', failed = false;
            const timeout = setTimeout(() => { failed = true; child.kill(); }, 120_000);
            child.stdout.on('data', bytes => { result += bytes.toString(); if (result.length > 64) { failed = true; child.kill(); } });
            child.stderr.on('data', () => { failed = true; });
            child.on('error', () => { failed = true; });
            child.stdin.on('error', () => { failed = true; });
            child.on('close', code => { clearTimeout(timeout); resolve(!failed && code === 0 ? result.trim() : 'cancelled'); });
            child.stdin.end(payload);
        });
    }
    return Object.freeze({
        async select(plan) { return await request('select', plan) === 'selected' ? 'selected' : 'cancelled'; },
        async confirm(plan) { return await request('approve', plan) === 'approved'; },
    });
}
