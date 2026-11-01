import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { documentChildLaunch } from '../scripts/document-child-launcher.mjs';

test('document child denies network modules, writes and external file reads', () => {
    const code = `
        const {writeFileSync,readFileSync}=await import('node:fs');
        let denied=0;
        for(const operation of [()=>writeFileSync('forbidden-output','synthetic'),()=>readFileSync('/etc/passwd'),()=>import('node:net'),()=>fetch('http://127.0.0.1:9')]){
            try{await operation();}catch{denied++;}
        }
        console.log(denied);
    `;
    const launch = documentChildLaunch(process.cwd(), '-e', { args: [code] });
    const result = spawnSync(launch.command, launch.args, { encoding: 'utf8', env: { NODE_ENV: 'production' }, timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '4');
});
