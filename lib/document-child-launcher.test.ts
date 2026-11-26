import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { documentChildLaunch, documentChildSandboxProfile } from '../scripts/document-child-launcher.mjs';

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
    try {
        const result = spawnSync(launch.command, launch.args, { encoding: 'utf8', input: '', env: launch.env, timeout: 10000 });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), '4');
    } finally {
        launch.cleanup?.();
    }
});

function escapeApp(work: string, marker: string, port: number) {
    const app = path.join(work, 'Fuga.app');
    mkdirSync(path.join(app, 'Contents/MacOS'), { recursive: true });
    writeFileSync(path.join(app, 'Contents/Info.plist'), '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>'
        + '<key>CFBundleExecutable</key><string>fuga</string><key>CFBundleIdentifier</key><string>dev.mediflow.test.fuga-documenti</string>'
        + '<key>LSBackgroundOnly</key><true/></dict></plist>');
    writeFileSync(
        path.join(app, 'Contents/MacOS/fuga'),
        `#!/bin/sh\n/usr/bin/touch ${JSON.stringify(marker)}\n/usr/bin/nc -z 127.0.0.1 ${port} 2>/dev/null || /usr/bin/curl -s --max-time 2 http://127.0.0.1:${port}/ >/dev/null 2>&1\n`,
        { mode: 0o755 },
    );
    return app;
}

test('a document reader that escapes the Node permission model cannot start another program or reach disk and network via open, LaunchServices, Apple Events, or direct exec', {
    skip: process.platform !== 'darwin' && 'richiede macOS',
}, async () => {
    const work = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'documenti-fuga-')));
    const marker = path.join(work, 'fuori-dal-sandbox.txt');
    let networkHits = 0;
    const listener = net.createServer(socket => {
        networkHits += 1;
        socket.end();
    });
    await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
    const { port } = listener.address() as net.AddressInfo;
    const app = escapeApp(work, marker, port);
    const code = `
        const { spawnSync } = await import('node:child_process');
        const attempts = {
            open: spawnSync('/usr/bin/open', ['-g', '-j', ${JSON.stringify(app)}]).error?.code ?? 'started',
            osascript: spawnSync('/usr/bin/osascript', ['-e', 'tell application "Finder" to get name of startup disk']).error?.code ?? 'started',
            shell: spawnSync('/bin/sh', ['-c', ${JSON.stringify(`/usr/bin/touch ${JSON.stringify(marker)}`)}]).error?.code ?? 'started',
            launchd: spawnSync('/bin/launchctl', ['submit', '-l', 'dev.mediflow.test.fuga-documenti', '--', '/usr/bin/touch', ${JSON.stringify(marker)}]).error?.code ?? 'started',
        };
        console.log(JSON.stringify(attempts));
        process.execve('/usr/bin/open', ['open', '-g', '-j', ${JSON.stringify(app)}]);
    `;
    const launch = documentChildLaunch(process.cwd(), '-e', { args: [code] });
    const withoutNodePermissions = launch.args.filter(argument => argument !== '--permission' && !argument.startsWith('--allow-fs-read='));
    const directExecLaunch = documentChildLaunch(process.cwd(), '-e', {
        args: [`process.execve('/bin/sh', ['sh', '-c', ${JSON.stringify(`/usr/bin/touch ${JSON.stringify(marker)}`)}]);`],
    });
    const directExecWithoutPermissions = directExecLaunch.args.filter(argument => argument !== '--permission' && !argument.startsWith('--allow-fs-read='));
    try {
        const result = spawnSync(launch.command, withoutNodePermissions, { encoding: 'utf8', input: '', env: launch.env, timeout: 10000 });
        assert.deepEqual(JSON.parse(result.stdout.trim().split('\n')[0]), {
            open: 'EPERM',
            osascript: 'EPERM',
            shell: 'EPERM',
            launchd: 'EPERM',
        });
        assert.notEqual(result.status, 0, 'execve of /usr/bin/open must fail inside the document sandbox');

        const directShell = spawnSync(directExecLaunch.command, directExecWithoutPermissions, {
            encoding: 'utf8',
            input: '',
            env: directExecLaunch.env,
            timeout: 10000,
        });
        assert.notEqual(directShell.status, 0, 'direct execve of /bin/sh must fail inside the document sandbox');

        const lsOpenDirect = spawnSync('/usr/bin/sandbox-exec', [
            '-p', documentChildSandboxProfile('/usr/bin/open'),
            '/usr/bin/open', '-g', '-j', app,
        ], { encoding: 'utf8', timeout: 10000 });
        assert.notEqual(lsOpenDirect.status, 0, 'LaunchServices open must be denied even if exec is not the barrier');

        const appleEventDirect = spawnSync('/usr/bin/sandbox-exec', [
            '-p', documentChildSandboxProfile('/usr/bin/osascript'),
            '/usr/bin/osascript', '-e', 'tell application "Finder" to get name of startup disk',
        ], { encoding: 'utf8', timeout: 10000 });
        assert.notEqual(appleEventDirect.status, 0);
        assert.match(appleEventDirect.stderr, /\(-600\)/u, 'Apple Events must be blocked by Seatbelt before reaching target apps');

        await new Promise(resolve => setTimeout(resolve, 2500));
        assert.equal(existsSync(marker), false, 'a program started from the document sandbox wrote outside it');
        assert.equal(networkHits, 0, 'a program started from the document sandbox reached the network');
    } finally {
        listener.close();
        spawnSync('/bin/launchctl', ['remove', 'dev.mediflow.test.fuga-documenti']);
        rmSync(work, { recursive: true, force: true });
    }
});

test('Windows document launch stops before spawn when the sandbox executable is absent', {
    skip: process.platform !== 'win32',
}, () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'mediflow-without-document-sandbox-'));
    try {
        assert.throws(() => documentChildLaunch(root, path.join(root, 'anydoc-pdf-page-worker.mjs')),
            /Windows document sandbox unavailable/u);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
