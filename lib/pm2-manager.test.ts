/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

interface CommonJSModuleLoader {
    _load(request: string, parent: unknown, isMain: boolean): unknown;
}

test('PM2 is isolated and the port guard leaves an occupied service untouched', async () => {
    const moduleLoader = Module as unknown as CommonJSModuleLoader;
    const originalLoad = moduleLoader._load;
    const originalPM2Home = process.env.PM2_HOME;
    const originalDataDir = process.env.MEDIFLOW_DATA_DIR;
    const originalMediFlowPM2Home = process.env.MEDIFLOW_PM2_HOME;
    const originalEnvironmentValue = process.env.PM2_NO_INTERACTION;
    const originalOverHome = process.env.OVER_HOME;
    const originalRPCOverride = process.env.PM2_DAEMON_RPC_PORT;
    const originalPUBOverride = process.env.PM2_DAEMON_PUB_PORT;
    const managerPath = require.resolve('./pm2-manager');
    const dataDirPath = require.resolve('./data-dir');
    const isolatedDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-pm2-manager-'));
    const isolatedPM2Home = path.join(isolatedDataDir, 'pm2');
    const unrelatedPM2Home = path.join(os.tmpdir(), 'unrelated-global-pm2');
    let environmentAtPM2Load: {
        home?: string;
        noInteraction?: string;
        overHome?: string;
        rpcOverride?: string;
        pubOverride?: string;
    } | undefined;
    let online = false;
    let startCalls = 0;
    let stopCalls = 0;
    let connectCalls = 0;
    let disconnectCalls = 0;
    let activeConnections = 0;
    let maxActiveConnections = 0;
    const pm2Stub = {
        pm2_home: isolatedPM2Home,
        Client: {
            pm2_home: isolatedPM2Home,
            rpc_socket_file: path.join(isolatedPM2Home, 'rpc.sock'),
            pub_socket_file: path.join(isolatedPM2Home, 'pub.sock'),
        },
        connect(callback: (error: Error | null) => void) {
            connectCalls += 1;
            setTimeout(() => {
                activeConnections += 1;
                maxActiveConnections = Math.max(maxActiveConnections, activeConnections);
                callback(null);
            }, 5);
        },
        disconnect(callback?: (error?: Error | null) => void) {
            disconnectCalls += 1;
            setTimeout(() => {
                activeConnections -= 1;
                callback?.(null);
            }, 5);
        },
        describe(_name: string, callback: (error: Error | null, description: unknown[]) => void) {
            callback(null, online
                ? [{ name: 'mlx-inference-server', pm2_env: { status: 'online' }, monit: {} }]
                : []);
        },
        start(_path: string, callback: (error: Error | null) => void) {
            startCalls += 1;
            setTimeout(() => {
                online = true;
                callback(null);
            }, 10);
        },
        stop(_name: string, callback: (error: Error | null) => void) {
            stopCalls += 1;
            callback(new Error('process or namespace not found'));
        },
    };

    process.env.PM2_HOME = unrelatedPM2Home;
    process.env.MEDIFLOW_PM2_HOME = unrelatedPM2Home;
    process.env.MEDIFLOW_DATA_DIR = isolatedDataDir;
    process.env.OVER_HOME = unrelatedPM2Home;
    process.env.PM2_DAEMON_RPC_PORT = path.join(unrelatedPM2Home, 'rpc.sock');
    process.env.PM2_DAEMON_PUB_PORT = path.join(unrelatedPM2Home, 'pub.sock');
    delete process.env.PM2_NO_INTERACTION;
    delete require.cache[managerPath];
    delete require.cache[dataDirPath];

    moduleLoader._load = function loadWithPM2Probe(request, parent, isMain) {
        if (request === 'pm2') {
            environmentAtPM2Load = {
                home: process.env.PM2_HOME,
                noInteraction: process.env.PM2_NO_INTERACTION,
                overHome: process.env.OVER_HOME,
                rpcOverride: process.env.PM2_DAEMON_RPC_PORT,
                pubOverride: process.env.PM2_DAEMON_PUB_PORT,
            };
            return pm2Stub;
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        // The probe must exercise the same CommonJS initialization boundary as PM2.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const managerModule = require(managerPath) as typeof import('./pm2-manager');
        assert.deepEqual(environmentAtPM2Load, {
            home: isolatedPM2Home,
            noInteraction: 'true',
            overHome: undefined,
            rpcOverride: undefined,
            pubOverride: undefined,
        });

        const sentinel = net.createServer();
        await new Promise<void>((resolve, reject) => {
            sentinel.once('error', reject);
            sentinel.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
        });
        const address = sentinel.address();
        assert.ok(address && typeof address === 'object');

        try {
            await assert.rejects(
                managerModule.assertLoopbackPortAvailable(address.port),
                /porta locale .* già in uso/,
            );
            assert.equal(sentinel.listening, true);
        } finally {
            await new Promise<void>((resolve, reject) => {
                sentinel.close((error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });
        }

        await managerModule.assertLoopbackPortAvailable(address.port);

        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
        try {
            await Promise.all([
                managerModule.PM2Manager.start(),
                managerModule.PM2Manager.start(),
            ]);
            assert.equal(startCalls, 1);

            await managerModule.PM2Manager.start();
            assert.equal(startCalls, 1);

            online = false;
            await managerModule.PM2Manager.stop();
            assert.equal(stopCalls, 1);

            const connectionOrder: string[] = [];
            const results = await Promise.all([
                managerModule.PM2Manager.withConnection(async () => {
                    connectionOrder.push('first:start');
                    await new Promise((resolve) => setTimeout(resolve, 15));
                    connectionOrder.push('first:end');
                    return 'first';
                }),
                managerModule.PM2Manager.withConnection(async () => {
                    connectionOrder.push('second:start');
                    connectionOrder.push('second:end');
                    return 'second';
                }),
            ]);
            assert.deepEqual(results, ['first', 'second']);
            assert.deepEqual(connectionOrder, ['first:start', 'first:end', 'second:start', 'second:end']);
            assert.equal(connectCalls, 2);
            assert.equal(disconnectCalls, 2);
            assert.equal(maxActiveConnections, 1);
            assert.equal(activeConnections, 0);
        } finally {
            Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform });
        }
    } finally {
        moduleLoader._load = originalLoad;
        delete require.cache[managerPath];
        delete require.cache[dataDirPath];

        if (originalPM2Home === undefined) delete process.env.PM2_HOME;
        else process.env.PM2_HOME = originalPM2Home;

        if (originalDataDir === undefined) delete process.env.MEDIFLOW_DATA_DIR;
        else process.env.MEDIFLOW_DATA_DIR = originalDataDir;

        if (originalMediFlowPM2Home === undefined) delete process.env.MEDIFLOW_PM2_HOME;
        else process.env.MEDIFLOW_PM2_HOME = originalMediFlowPM2Home;

        if (originalOverHome === undefined) delete process.env.OVER_HOME;
        else process.env.OVER_HOME = originalOverHome;

        if (originalRPCOverride === undefined) delete process.env.PM2_DAEMON_RPC_PORT;
        else process.env.PM2_DAEMON_RPC_PORT = originalRPCOverride;

        if (originalPUBOverride === undefined) delete process.env.PM2_DAEMON_PUB_PORT;
        else process.env.PM2_DAEMON_PUB_PORT = originalPUBOverride;

        if (originalEnvironmentValue === undefined) {
            delete process.env.PM2_NO_INTERACTION;
        } else {
            process.env.PM2_NO_INTERACTION = originalEnvironmentValue;
        }

        fs.rmSync(isolatedDataDir, { recursive: true, force: true });
    }
});

test('an oversized PM2 socket path fails before PM2 is loaded', {
    skip: process.platform === 'win32',
}, () => {
    const moduleLoader = Module as unknown as CommonJSModuleLoader;
    const originalLoad = moduleLoader._load;
    const originalDataDir = process.env.MEDIFLOW_DATA_DIR;
    const originalNoInteraction = process.env.PM2_NO_INTERACTION;
    const managerPath = require.resolve('./pm2-manager');
    const dataDirPath = require.resolve('./data-dir');
    const oversizedDataDir = path.join(os.tmpdir(), 'm'.repeat(180));
    let pm2LoadCalls = 0;

    process.env.MEDIFLOW_DATA_DIR = oversizedDataDir;
    delete require.cache[managerPath];
    delete require.cache[dataDirPath];
    moduleLoader._load = function rejectPM2Load(request, parent, isMain) {
        if (request === 'pm2') {
            pm2LoadCalls += 1;
            return {};
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        assert.throws(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require(managerPath);
        }, /percorso socket MediFlow supera/);
        assert.equal(pm2LoadCalls, 0);
    } finally {
        moduleLoader._load = originalLoad;
        delete require.cache[managerPath];
        delete require.cache[dataDirPath];
        if (originalDataDir === undefined) delete process.env.MEDIFLOW_DATA_DIR;
        else process.env.MEDIFLOW_DATA_DIR = originalDataDir;
        if (originalNoInteraction === undefined) delete process.env.PM2_NO_INTERACTION;
        else process.env.PM2_NO_INTERACTION = originalNoInteraction;
        fs.rmSync(oversizedDataDir, { recursive: true, force: true });
    }
});
