/* @Codex — SYNTHETIC TEST HARNESS, not a production issuer or OS witness.
 * Executes entire unchanged TS modules after type stripping in an isolated VM.
 * Only native process/build, substrate verification, schema availability,
 * proxy/listeners, clocks and stdio peer are substituted. File path/content/mode
 * checks execute on real run-owned local files. Root UID is simulated as 501
 * when this test is run as root; non-root runs retain their real UID.
 * No sockets, subprocesses, accounts, credentials, external sources or hooks in
 * production code. The production WeakMaps are private even inside this test.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext, SourceTextModule, SyntheticModule } from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { EXECUTION_CONFIG, EXECUTION_SUBSTRATE, executionSandboxProfile } from '../execution-sandbox.ts';
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sample = fs.readFileSync(new URL('./mac-readback-v01534.json', import.meta.url), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
export const deferred = () => { let resolve, reject; const promise = new Promise((yes,no)=>{resolve=yes;reject=no;}); return {promise,resolve,reject}; };

export async function macFixture(t, options = {}) {
    const workspace = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'mf-login-unit-')));
    const state = { live: true, adminAbsent: true, proxyActive: false, proxyClosed: false,
        rawClosed: false, clockOffset: 0, wallOffset: 0, calls: [], initialized: 0, responses: [],
        connected: false, identity: 'synthetic-login@example.invalid', plan: 'plus',
        before: undefined, after: undefined, loginNotifications: 0, nativeLaunches: [], cleanup: true,
        drain: true, guardAllowed: true, failures: [], changes: [], wrapperCalls: 0 };
    const uid = process.getuid?.() || 501;
    const testProcess = { platform: options.platform ?? 'darwin', getuid: () => uid, geteuid: () => uid };
    class TestDate extends Date { static now() { return Date.now() + state.wallOffset; } }
    const context = createContext({ process: testProcess, Buffer, URL, AbortController,
        setTimeout, clearTimeout, setInterval, clearInterval, Date: TestDate,
        performance: { now: () => performance.now() + state.clockOffset } });
    const parse = runInContext('(text) => JSON.parse(text)', context);
    const clone = value => parse(JSON.stringify(value));
    const listeners = new Set();
    const emit = (method, value) => { for (const listener of [...listeners]) listener.notify(method, value); };
    const notifyLogin = (id = 'fixture-login', success = true) => {
        state.connected = success;
        emit('account/login/completed', clone({loginId:id,success,error:null}));
    };
    const modes = new Set(['probe','version','schemas','server']);
    const pins = Array.from({length:24}, (_,i)=>({path:`v2/fixture-schema-${i}.json`,sha256:digest(`{"synthetic":${i}}`)}));
    let root, prepared, host, raw, closePromise, ownerServer;
    const abort = new AbortController();
    const hashFile = filename => digest(fs.readFileSync(filename));
    const stats = s => { if (s.uid === 0) s.uid = uid; return s; };
    const fsOverrides = {
        ...fs,
        mkdtempSync(prefix) {
            if (prefix !== '/private/tmp/mfmac-') throw new Error('Unexpected preparation path');
            root = fs.mkdtempSync(path.join(workspace, 'mfmac-')); return root;
        },
        lstatSync(filename, ...args) {
            if (String(filename).startsWith('/etc/codex/')) {
                if (!state.adminAbsent) return { isFile: () => true };
                throw Object.assign(new Error('synthetic absent'), {code:'ENOENT'});
            }
            return stats(fs.lstatSync(filename, ...args));
        },
        fstatSync(fd,...args) { return stats(fs.fstatSync(fd,...args)); },
    };
    const sandbox = { EXECUTION_CONFIG, EXECUTION_SUBSTRATE, executionSandboxProfile,
        verifyExecutionSubstrate: filename => fs.realpathSync(filename),
        executionPublicCaBundle: () => 'SYNTHETIC PUBLIC CA TEST INPUT ONLY\n' };
    const native = {
        MacNativeBuildError: class extends Error {},
        buildMacCustodian(directory, source) {
            const helper = path.join(directory,'runtime/mac-owner');
            fs.copyFileSync(source,path.join(directory,'runtime/mac-owner.c'),fs.constants.COPYFILE_EXCL);
            fs.chmodSync(path.join(directory,'runtime/mac-owner.c'),0o400);
            fs.writeFileSync(helper,'SYNTHETIC NOT EXECUTABLE TEST HELPER',{mode:0o500,flag:'wx'});
            return {helper,helperSha256:hashFile(helper),compilerSha256:digest('synthetic compiler'),
                sdkPathSha256:digest('synthetic sdk'),sourceSha256:hashFile(source)};
        },
        launchMacCustodian(directory, nonce, mode) {
            if (!modes.has(mode)) throw new Error('Unexpected native mode');
            state.nativeLaunches.push(mode);
            if (mode === 'schemas') for (let i=0;i<pins.length;i++) {
                const p=path.join(directory,'work/schemas',pins[i].path);
                fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,`{"synthetic":${i}}`,{flag:'wx'});
            }
            let closed = mode !== 'server'; const finished = deferred();
            if (closed) finished.resolve();
            const owner = {child:{synthetic:true},started:Promise.resolve(),finished:finished.promise,
                live:()=>!closed&&state.live,drained:()=>closed&&state.drain,exitCode:()=>closed?0:null,
                close(){closed=true;finished.resolve();},
                async collect(){return mode==='version'?`codex-cli ${EXECUTION_SUBSTRATE.codexVersion}`:'';}};
            if(mode==='server')ownerServer=owner;
            return owner;
        },
    };
    const net = {createServer(){return { once(){return this;},listen(...args){args.at(-1)();return this;},
        address(){return {port:32123};},close(done){done();}};}};
    const proxy = { async createOpenAIConnectProxy({initiallyClosed}) {
        if (!initiallyClosed) throw new Error('Egress must start closed');
        return {port:32124,activate(){state.proxyActive=true;return !state.proxyClosed;},
            async close(){state.proxyActive=false;state.proxyClosed=true;}};
    }};
    const transportModule = { createStdioExecutionTransport(child, hooks) {
        if (!child.synthetic) throw new Error('Unexpected native child');
        raw = {
            async request(method, params) {
                state.calls.push({method,params:params===undefined?undefined:JSON.parse(JSON.stringify(params))});
                if (state.rawClosed) throw Object.assign(new Error('process_exited'),{code:'process_exited'});
                if(state.before)await state.before(method,params);
                let value;
                switch(method) {
                    case 'initialize': value=clone({userAgent:'codex_cli_rs/0.153.4 (SYNTHETIC)',codexHome:path.join(root,'codex'),platformOs:'macos',platformFamily:'unix'});break;
                    case 'config/read': value=parse(sample.replaceAll('/SYNTHETIC_RUN_ROOT',root));break;
                    case 'account/read': value=clone({requiresOpenaiAuth:true,account:state.connected?{type:'chatgpt',email:state.identity,planType:state.plan}:null});break;
                    case 'account/login/start': value=clone({type:'chatgptDeviceCode',loginId:'fixture-login',userCode:'FAKE-TEST',verificationUrl:'https://auth.openai.com/fixture'});break;
                    case 'account/login/cancel': value=clone({status:'canceled'});break;
                    case 'account/logout':state.connected=false;value=clone({});break;
                    default: throw new Error(`Unexpected unit RPC: ${method}`);
                }
                if(state.after) { const replacement=await state.after(method,value);if(replacement!==undefined)value=replacement; }
                state.responses.push({method,value}); return value;
            },
            initialized(){state.initialized++;},
            subscribe(notify,fail){const listener={notify,fail};listeners.add(listener);return()=>listeners.delete(listener);},
            close(){
                if(closePromise)return closePromise;
                state.rawClosed=true;
                closePromise=Promise.resolve().then(async()=>{hooks.onClosing();hooks.terminate();await hooks.onClosed();return state.cleanup;});
                void closePromise.catch(()=>{});return closePromise;
            },
            drainObservation(){return{closing:state.rawClosed,leaderExited:state.rawClosed,ownedGroupCeased:null};},
        }; return raw;
    }};
    const modules=new Map();let configActual,configForIssuer;
    function synthetic(id, exports) {
        if (modules.has(id))return modules.get(id);
        const mod=new SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{identifier:id,context});
        modules.set(id,mod);return mod;
    }
    async function load(filename) {
        if(modules.has(filename))return modules.get(filename);
        const source=fs.readFileSync(filename,'utf8');
        const mod=new SourceTextModule(stripTypeScriptTypes(source,{mode:'transform'}),{identifier:filename,context});
        modules.set(filename,mod);return mod;
    }
    async function linker(specifier, referring) {
        if(specifier==='server-only')return synthetic('server-only',{});
        if(specifier==='node:fs')return synthetic(specifier,fsOverrides);
        if(specifier==='node:net')return synthetic(specifier,net);
        if(specifier.startsWith('node:'))return synthetic(specifier,{...await import(specifier)});
        let filename=path.resolve(path.dirname(referring.identifier),specifier);
        if(!path.extname(filename))filename+='.ts';
        const name=path.basename(filename);
        if(name==='execution-sandbox.ts')return synthetic('test:substrate',sandbox);
        if(name==='execution-mac-native.ts')return synthetic('test:native',native);
        if(name==='execution-egress-proxy.ts')return synthetic('test:proxy',proxy);
        if(name==='execution-transport.ts')return synthetic('test:raw',transportModule);
        if(name==='execution-mac-config.ts'&&path.basename(referring.identifier)==='execution-mac-qualification.ts')return configForIssuer;
        if(!filename.startsWith(sourceRoot+path.sep))throw new Error('Import outside supplied source');
        return load(filename);
    }
    async function evaluate(relative) {
        const mod=await load(path.join(sourceRoot,relative));
        if(mod.status==='unlinked')await mod.link(linker);
        if(mod.status==='linked')await mod.evaluate();
        return mod.namespace;
    }
    try {
        configActual=await evaluate('lib/chatgpt-execution/execution-mac-config.ts');
        configForIssuer=synthetic('test:issuer-source-check',{...configActual,verifyMacSourceSet:()=>pins});
        const loginModule=await evaluate('lib/chatgpt-execution/execution-login.ts');
        const qualifier=await evaluate('lib/chatgpt-execution/execution-mac-qualification.ts');
        const platform=await evaluate('lib/chatgpt-execution/execution-platform.ts');
        const contract=await evaluate('lib/chatgpt-execution/execution-contract.ts');
        const dummyBinary=path.join(workspace,'synthetic-codex');fs.writeFileSync(dummyBinary,'NOT A REAL EXECUTABLE',{flag:'wx',mode:0o500});
        const prepare=async()=>{
            prepared=await qualifier.prepareMacProductQualification({binaryPath:dummyBinary,
                nativeSourcePath:path.join(sourceRoot,'native/MediFlowMac/ExecutionCustodian/mac-owner.c'),
                schemaDirectory:path.join(workspace,'synthetic-schema-input'),c1ReceiptPath:path.join(workspace,'synthetic-receipt'),signal:abort.signal});
            return prepared;
        };
        await prepare();
        const reviewed=platform.createReviewedMacProductPlatform({binaryPath:prepared.binaryPath,qualification:prepared.authority});
        const borrow=async()=>{host=await reviewed.create(abort.signal);return host;};
        if(options.borrow!==false)await borrow();
        const wrapperListeners=new Set();
        function wrap(base=host.transport) {
            return Object.freeze({
                takeInitializationObservation:()=>base.takeInitializationObservation(),
                initialized:()=>base.initialized(),
                subscribe(notify,fail){const listener={notify,fail};wrapperListeners.add(listener);const unsubscribe=base.subscribe(notify,fail);return()=>{wrapperListeners.delete(listener);unsubscribe();};},
                async request(method,params){state.wrapperCalls++;return base.request(method,params);},
                close:()=>base.close(),drainObservation:()=>base.drainObservation(),
            });
        }
        const logins=[];
        function login(transport=wrap(),cwd=host.cwd) {
            const value=loginModule.createExecutionLogin(transport,()=>{if(!state.guardAllowed)throw Object.assign(new Error('revoked'),{code:'revoked'});},
                x=>state.changes.push(x),e=>state.failures.push(e.code),cwd);
            logins.push(value);return value;
        }
        t.after(async()=>{
            for(const value of logins)value.dispose();
            state.before=undefined;state.after=undefined;state.drain=true;
            if(prepared)await prepared.close();
            fs.rmSync(workspace,{recursive:true,force:true});
        });
        return {state,host,prepared,reviewed,qualifier,platform,contract,loginModule,configActual,parse,clone,
            login,wrap,emit,notifyLogin,borrow,abort,raw,get root(){return root;},listeners,wrapperListeners,
            replaceFile(relative,contents){const p=path.join(root,relative);fs.unlinkSync(p);fs.writeFileSync(p,contents,{flag:'wx',mode:0o400});},
            loseProcess(){state.live=false;},stopNative(){ownerServer.close();},
            forgedNotice(value){for(const item of [...wrapperListeners])item.notify('account/login/completed',clone(value));},
        };
    } catch(error) {
        if(prepared)await prepared.close();fs.rmSync(workspace,{recursive:true,force:true});throw error;
    }
}
