'use client';

import { useState, useEffect, useRef } from 'react';
import { db } from '@/lib/db';
import { Upload, Database, Bot, Save, RefreshCw, AlertTriangle, CheckCircle, Server, User, Cpu } from 'lucide-react';
import BackupRestoreUI from '@/components/backup-restore-ui';
import DataSeeder from '@/components/data-seeder';
import { importAifaCsv, getDrugStats, clearDrugDatabase } from '@/lib/aifa-importer';
import { cn } from '@/lib/utils';
import { useSecurity } from '@/components/security-provider';
import DiagnosticHub from '@/components/diagnostic-hub';
import ServiceArchitecturePanel from '@/components/service-architecture-panel';

export default function SettingsPage() {
    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- AIFA State ---
    const [drugStats, setDrugStats] = useState<number | null>(null);
    const [importing, setImporting] = useState(false);
    const [progress, setProgress] = useState(0);

    // --- Profile State ---
    const { user, updateUser } = useSecurity();
    const [profile, setProfile] = useState({
        doctorName: '',
        clinicName: ''
    });
    const [isSavingProfile, setIsSavingProfile] = useState(false);

    // --- AI Config State ---
    const [aiConfig, setAiConfig] = useState({
        provider: 'ollama', // 'ollama' | 'mlx'
        model: '',
        url: ''
    });
    const [isSavingAi, setIsSavingAi] = useState(false);
    const [aiTestStatus, setAiTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

    // --- System Status (MLX) ---
    const [mlxStatus, setMlxStatus] = useState<{ status: string, cpu?: number, memory?: number }>({ status: 'unknown' });
    const [isMlxLoading, setIsMlxLoading] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [isDockerApp, setIsDockerApp] = useState(false);

    // Load initial data
    useEffect(() => {
        loadStats();
        loadAiConfig();
    }, []);

    // Poll MLX status if selected
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (aiConfig.provider === 'mlx') {
            fetchMlxStatus();
            interval = setInterval(fetchMlxStatus, 3000);
        } else {
            // Check Ollama connectivity simply
            const checkOllama = async () => {
                try {
                    // We use the proxy 'health' check or just try to ping
                    // Since we can't easily ping localhost:11434 from browser due to CORS if not configured,
                    // we use our own AIService ping logic but targeted.
                    // Simplified: assume status unknown unless verified by Test.
                    // Or auto-run test quietly? No, expensive.
                    // Just check if we can reach our own proxy which connects to it.
                    // For now, let's just leave it to "Test Diagnostico" but show a label.
                } catch { }
            };
            checkOllama();
        }
        return () => clearInterval(interval);
    }, [aiConfig.provider]);

    const fetchMlxStatus = async () => {
        try {
            const res = await fetch('/api/system/mlx');
            if (res.ok) setMlxStatus(await res.json());
        } catch (e) { console.error("MLX Status error", e); }
    };

    const toggleMlxProcess = async () => {
        setIsMlxLoading(true);
        try {
            const method = mlxStatus.status === 'online' ? 'DELETE' : 'POST';
            await fetch('/api/system/mlx', { method });
            await new Promise(r => setTimeout(r, 1000)); // wait for startup
            await fetchMlxStatus();
        } catch {
            alert("Errore nel controllo del processo");
        } finally {
            setIsMlxLoading(false);
        }
    };

    // Sync profile with user context
    useEffect(() => {
        if (user) {
            setProfile({
                doctorName: user.displayName || '',
                clinicName: user.ambulatoryName || ''
            });
        }
    }, [user]);

    const saveProfile = async () => {
        if (!user) return;
        setIsSavingProfile(true);
        try {
            const res = await fetch('/api/auth/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: user.id,
                    displayName: profile.doctorName,
                    ambulatoryName: profile.clinicName
                })
            });

            if (!res.ok) throw new Error("Update failed");

            updateUser({
                displayName: profile.doctorName,
                ambulatoryName: profile.clinicName
            });

            alert("Profilo aggiornato con successo!");
        } catch (e) {
            console.error(e);
            alert("Errore durante il salvataggio del profilo.");
        } finally {
            setIsSavingProfile(false);
        }
    };

    const loadStats = async () => {
        try {
            const count = await getDrugStats();
            setDrugStats(count);
        } catch (e) {
            console.error(e);
        }
    };

    const loadAiConfig = async () => {
        try {
            const provider = await db.settings.get('aiProvider');
            const model = await db.settings.get('aiModel');

            // Smart URL loading: try generic, fallback to legacy ollama if provider is ollama
            const genericUrl = await db.settings.get('aiUrl');
            const legacyUrl = await db.settings.get('ollamaUrl');

            const currentProvider = provider?.value || 'ollama';
            let currentUrl = genericUrl?.value;

            if (!currentUrl && currentProvider === 'ollama') {
                currentUrl = legacyUrl?.value;
            }
            // If still empty, use defaults BUT do not overwrite state if user hasn't saved yet? 
            // Actually, if DB is empty, we must show default.
            if (!currentUrl) {
                // Default to Ollama (127.0.0.1) as Plan A
                currentUrl = currentProvider === 'mlx' ? "http://127.0.0.1:8080/v1" : "http://127.0.0.1:11434/v1";
            }

            // Ensure we are using the SAVED model if exists, otherwise default
            const currentModel = model?.value || (currentProvider === 'mlx' ? "mlx-community/medgemma-1.5-4b-it-bf16" : "hf.co/unsloth/medgemma-1.5-4b-it-GGUF");

            setAiConfig({
                provider: currentProvider,
                model: currentModel,
                url: currentUrl
            });
        } catch (e) {
            console.error("Failed to load AI config:", e);
        }
    };

    // --- AIFA Handlers ---
    const handleAifaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!confirm("Questa operazione potrebbe richiedere del tempo. Vuoi procedere con l'importazione?")) {
            if (fileInputRef.current) fileInputRef.current.value = "";
            return;
        }

        setImporting(true);
        setProgress(0);

        try {
            // Optional: Clear old DB? existing behavior seems to be additive or overwrite by key?
            // Usually simpler to clear for a fresh import if it's a full list replacement
            // await clearDrugDatabase(); 

            await importAifaCsv(file, (count, total) => {
                const perc = Math.round((count / total) * 100);
                setProgress(perc);
            });
            alert("Importazione completata con successo!");
            loadStats();
        } catch (err) {
            console.error(err);
            alert("Errore durante l'importazione.");
        } finally {
            setImporting(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const handleClearDrugs = async () => {
        if (confirm("Sei sicuro di voler cancellare l'intero database farmaci?")) {
            await clearDrugDatabase();
            loadStats();
        }
    };

    // --- AI Handlers ---
    const saveAiConfig = async () => {
        setIsSavingAi(true);
        try {
            await db.settings.put({ key: 'aiProvider', value: aiConfig.provider });
            await db.settings.put({ key: 'aiModel', value: aiConfig.model });
            await db.settings.put({ key: 'aiUrl', value: aiConfig.url });
            // Legacy sync for backward compatibility
            if (aiConfig.provider === 'ollama') {
                await db.settings.put({ key: 'ollamaUrl', value: aiConfig.url });
            }

            setAiTestStatus('idle'); // Reset test status on save
        } catch (e) {
            console.error(e);
            alert("Errore salvataggio.");
        } finally {
            setIsSavingAi(false);
        }
    };

    const [aiHealth, setAiHealth] = useState<{ status: 'ok' | 'error'; message: string; models: string[] } | null>(null);

    const testAiConnection = async () => {
        setAiTestStatus('testing');
        setAiHealth(null);
        try {
            // Import dynamically to avoid build issues if mixed env
            const { AIService } = await import('@/lib/ai-service');
            // We force create with current UI config to test WHAT IS INSERTED, not what is saved
            // But AIService.create reads from DB. To test current UI values, we should construct directly.
            // However, AIService constructor is not exported or we can just use new?
            // Exported class, so yes.
            const service = new AIService(
                aiConfig.provider as any,
                aiConfig.url,
                aiConfig.model
            );

            // Add timeout to prevent hanging (60s for cold start)
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Timeout connessione (60s) - Il modello potrebbe richiedere tempo per caricarsi")), 60000)
            );

            const health = await Promise.race([
                service.getHealth(),
                timeoutPromise
            ]) as any;

            setAiHealth({ ...health, models: health.models || [] }); // types adaptation if needed
            setAiTestStatus(health.status === 'ok' ? 'success' : 'error');
        } catch (e: any) {
            console.error(e);
            setAiTestStatus('error');
            setAiHealth({ status: 'error', message: e.message || "Errore imprevisto", models: [] });
        }
    };

    return (
        <div className="space-y-8 pb-10">
            <div>
                <h1 className="text-3xl font-bold text-gray-800 dark:text-white tracking-tight">Impostazioni</h1>
                <p className="text-gray-500 dark:text-gray-400 mt-1">
                    Configura database, intelligenza artificiale e backup.
                </p>
            </div>

            {/* Service Architecture Panel - Visual Overview */}
            <ServiceArchitecturePanel />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* --- Profile Section --- */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
                            <User className="w-6 h-6" /> {/* reusing Bot icon or maybe User, let's use check-circle or similar if available, or just reuse consistent styling */}
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Profilo Medico</h2>
                            <p className="text-xs text-gray-500">Personalizza le informazioni visualizzate.</p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Nome Medico
                            </label>
                            <input
                                type="text"
                                value={profile.doctorName}
                                onChange={(e) => setProfile({ ...profile, doctorName: e.target.value })}
                                placeholder="es. Dr. Mario Rossi"
                                className="w-full rounded-lg border-gray-300 dark:border-gray-600 dark:bg-gray-700 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-50 p-2.5 text-sm"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Nome Ambulatorio
                            </label>
                            <input
                                type="text"
                                value={profile.clinicName}
                                onChange={(e) => setProfile({ ...profile, clinicName: e.target.value })}
                                placeholder="es. Studio Medico Centro"
                                className="w-full rounded-lg border-gray-300 dark:border-gray-600 dark:bg-gray-700 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-50 p-2.5 text-sm"
                            />
                        </div>

                        <div className="pt-2">
                            <button
                                onClick={saveProfile}
                                disabled={isSavingProfile}
                                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 text-sm font-medium"
                            >
                                <Save className="w-4 h-4" />
                                {isSavingProfile ? 'Salvataggio...' : 'Salva Profilo'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* --- AI Config Section --- */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                            <Bot className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Configurazione AI</h2>
                            <p className="text-xs text-gray-500">Scegli il provider AI locale.</p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        {/* Provider Selector */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Provider
                            </label>
                            <div className="space-y-4">
                                {/* Ollama Main Option */}
                                <div
                                    onClick={() => setAiConfig({
                                        ...aiConfig,
                                        provider: 'ollama',
                                        url: "http://127.0.0.1:11434/v1",
                                        model: "hf.co/unsloth/medgemma-1.5-4b-it-GGUF"
                                    })}
                                    className={cn(
                                        "p-4 rounded-xl border flex items-center justify-between transition-all cursor-pointer",
                                        aiConfig.provider === 'ollama'
                                            ? "bg-indigo-50 border-indigo-200 ring-1 ring-indigo-200"
                                            : "bg-white border-gray-200 hover:bg-gray-50"
                                    )}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={cn("p-2 rounded-lg", aiConfig.provider === 'ollama' ? "bg-indigo-100 text-indigo-600" : "bg-gray-100 text-gray-500")}>
                                            <Bot className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <p className="font-bold text-gray-800 dark:text-gray-200">Ollama (Locale)</p>
                                            <p className="text-xs text-gray-500">Consigliato per stabilità e compatibilità universale.</p>
                                        </div>
                                    </div>
                                    {aiConfig.provider === 'ollama' && <CheckCircle className="w-5 h-5 text-indigo-600" />}
                                </div>

                                {/* Advanced Toggle */}
                                <div className="flex items-center gap-2 pt-2">
                                    <input
                                        type="checkbox"
                                        id="advancedFit"
                                        checked={showAdvanced}
                                        onChange={(e) => setShowAdvanced(e.target.checked)}
                                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <label htmlFor="advancedFit" className="text-xs font-medium text-gray-500 cursor-pointer select-none">
                                        Mostra opzioni sperimentali (MLX / Custom)
                                    </label>
                                </div>

                                {/* MLX / Advanced Option */}
                                {showAdvanced && (
                                    <>
                                        <div
                                            onClick={() => setAiConfig({
                                                ...aiConfig,
                                                provider: 'mlx',
                                                url: "http://127.0.0.1:8080/v1",
                                                model: "mlx-community/medgemma-1.5-4b-it-bf16"
                                            })}
                                            className={cn(
                                                "mt-2 p-4 rounded-xl border flex items-center justify-between transition-all cursor-pointer",
                                                aiConfig.provider === 'mlx'
                                                    ? "bg-orange-50 border-orange-200 ring-1 ring-orange-200"
                                                    : "bg-white/50 border-gray-200 opacity-80 hover:opacity-100"
                                            )}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={cn("p-2 rounded-lg", aiConfig.provider === 'mlx' ? "bg-orange-100 text-orange-600" : "bg-gray-100 text-gray-500")}>
                                                    <Cpu className="w-6 h-6" />
                                                </div>
                                                <div>
                                                    <p className="font-bold text-gray-800 dark:text-gray-200">Apple MLX (Beta)</p>
                                                    <p className="text-xs text-gray-500">Motore sperimentale per Apple Silicon.</p>
                                                </div>
                                            </div>
                                            {aiConfig.provider === 'mlx' && <CheckCircle className="w-5 h-5 text-orange-600" />}
                                        </div>

                                        {/* Docker Internal Host Option */}
                                        <div className="mt-4 pt-4 border-t border-dashed border-gray-200">
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    id="dockerMode"
                                                    checked={isDockerApp}
                                                    onChange={(e) => {
                                                        const newVal = e.target.checked;
                                                        setIsDockerApp(newVal);
                                                        // Auto-update URL if Ollama is selected
                                                        if (aiConfig.provider === 'ollama') {
                                                            setAiConfig(prev => ({
                                                                ...prev,
                                                                url: newVal
                                                                    ? "http://host.docker.internal:11434/v1"
                                                                    : "http://127.0.0.1:11434/v1"
                                                            }));
                                                        }
                                                    }}
                                                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                                />
                                                <label htmlFor="dockerMode" className="text-xs font-medium text-gray-600 dark:text-gray-300 cursor-pointer">
                                                    L&apos;App sta girando dentro Docker?
                                                    <span className="block text-[10px] text-gray-400 font-normal">
                                                        Seleziona se usi Docker Dashboard per avviare l&apos;app (cambia localhost in host.docker.internal).
                                                    </span>
                                                </label>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Nome Modello
                            </label>
                            <input
                                type="text"
                                value={aiConfig.model}
                                onChange={(e) => setAiConfig({ ...aiConfig, model: e.target.value })}
                                placeholder="es. medgemma"
                                className="w-full rounded-lg border-gray-300 dark:border-gray-600 dark:bg-gray-700 focus:ring-indigo-500 focus:border-indigo-500 bg-gray-50 p-2.5 text-sm"
                            />
                            {/* MLX Status & Control */}
                            {aiConfig.provider === 'mlx' && (
                                <div className="mt-4 p-3 bg-gray-50 border border-gray-100 rounded-xl flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={cn("w-3 h-3 rounded-full animate-pulse", mlxStatus.status === 'online' ? "bg-green-500" : "bg-red-500")} />
                                        <div>
                                            <p className="text-xs font-bold text-gray-700 uppercase">Motore Neurale (PM2)</p>
                                            <p className="text-[10px] text-gray-400 font-mono">
                                                STATUS: {mlxStatus.status}
                                                {mlxStatus.memory && ` | MEM: ${Math.round(mlxStatus.memory / 1024 / 1024)}MB`}
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={toggleMlxProcess}
                                        disabled={isMlxLoading}
                                        className={cn(
                                            "px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm",
                                            mlxStatus.status === 'online'
                                                ? "bg-white border border-red-200 text-red-600 hover:bg-red-50"
                                                : "bg-indigo-600 text-white hover:bg-indigo-700"
                                        )}
                                    >
                                        {isMlxLoading ? "..." : (mlxStatus.status === 'online' ? "Arresta" : "Avvia Motore")}
                                    </button>
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                URL Server AI
                            </label>
                            <input
                                type="text"
                                value={aiConfig.url}
                                onChange={(e) => setAiConfig({ ...aiConfig, url: e.target.value })}
                                placeholder={aiConfig.provider === 'mlx' ? "http://127.0.0.1:8080/v1" : "http://127.0.0.1:11434/v1"}
                                className="w-full rounded-lg border-gray-300 dark:border-gray-600 dark:bg-gray-700 focus:ring-indigo-500 focus:border-indigo-500 bg-gray-50 p-2.5 text-sm font-mono"
                            />
                        </div>

                        <div className="pt-2 flex items-center gap-3">
                            <button
                                onClick={saveAiConfig}
                                disabled={isSavingAi}
                                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 text-sm font-medium"
                            >
                                <Save className="w-4 h-4" />
                                {isSavingAi ? 'Salvataggio...' : 'Salva Configurazione'}
                            </button>

                            <button
                                onClick={testAiConnection}
                                className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 rounded-lg transition-colors text-sm font-medium"
                            >
                                <RefreshCw className={cn("w-4 h-4", aiTestStatus === 'testing' && "animate-spin")} />
                                Test Diagnostico
                            </button>
                        </div>
                        <p className="text-[10px] text-gray-400 italic">
                            Se l&apos;AI consuma troppa CPU:
                            {aiConfig.provider === 'ollama' ? ' Riavvia Docker (`docker restart ollama`).' : ' Premi Ctrl+C nel terminale MLX.'}
                        </p>

                        {/* Detailed Diagnostic Panel */}
                        {aiHealth && (
                            <div className={cn(
                                "rounded-xl p-4 border text-sm space-y-2 animate-in slide-in-from-top-2 fade-in",
                                aiHealth.status === 'ok' ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"
                            )}>
                                <div className="flex items-start gap-2 font-bold">
                                    {aiHealth.status === 'ok' ? <CheckCircle className="w-5 h-5 shrink-0" /> : <AlertTriangle className="w-5 h-5 shrink-0" />}
                                    <div>
                                        <p>{aiHealth.status === 'ok' ? "Sistema AI Operativo" : "Problema rilevato"}</p>
                                    </div>
                                </div>

                                <div className="pl-7 space-y-1 text-xs">
                                    <p className="opacity-90">{aiHealth.message}</p>

                                    {aiHealth.models.length > 0 && (
                                        <div className="mt-2 pt-2 border-t border-black/5">
                                            <p className="font-semibold mb-1 opacity-70">Modelli installati su Ollama:</p>
                                            <div className="flex flex-wrap gap-1">
                                                {aiHealth.models.map(m => (
                                                    <span key={m} className={cn(
                                                        "px-1.5 py-0.5 rounded text-[10px] border",
                                                        (m.includes(aiConfig.model) || aiConfig.model.includes(m))
                                                            ? "bg-green-100 border-green-300 font-bold"
                                                            : "bg-white/50 border-black/10"
                                                    )}>
                                                        {m}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Test Status Indicator */}
                        {aiTestStatus === 'success' && (
                            <div className="flex items-center gap-2 text-green-600 text-xs bg-green-50 p-2 rounded-lg border border-green-100">
                                <CheckCircle className="w-4 h-4" />
                                Connessione a Ollama riuscita!
                            </div>
                        )}
                        {aiTestStatus === 'error' && (
                            <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 p-2 rounded-lg border border-red-100">
                                <AlertTriangle className="w-4 h-4" />
                                Impossibile connettersi. Controlla che {aiConfig.provider === 'mlx' ? 'il motore sia avviato' : 'Ollama sia attivo'}.
                            </div>
                        )}
                    </div>
                </div>

                {/* --- AIFA Database Section --- */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                            <Database className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Database Farmaci (AIFA)</h2>
                            <div className="flex flex-col">
                                <p className="text-xs text-gray-500">Gestisci l&apos;elenco farmaci offline</p>
                                <a
                                    href="https://www.aifa.gov.it/web/guest/liste-dei-farmaci"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[10px] text-blue-500 hover:underline mt-0.5"
                                >
                                    Fonte Dati: AIFA Open Data (Liste di Trasparenza)
                                </a>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl flex items-center justify-between">
                            <div>
                                <p className="text-xs text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wider">Farmaci Indicizzati</p>
                                <p className="text-2xl font-bold text-blue-800 dark:text-blue-200">
                                    {drugStats !== null ? drugStats.toLocaleString() : '-'}
                                </p>
                            </div>
                            <Server className="w-8 h-8 text-blue-200 dark:text-blue-800" />
                        </div>

                        <div className="space-y-3">
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleAifaUpload}
                                accept=".csv"
                                className="hidden"
                                disabled={importing}
                                aria-label="Carica file CSV AIFA"
                            />

                            {!importing ? (
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl text-gray-600 hover:border-blue-500 hover:text-blue-600 hover:bg-blue-50 transition-all cursor-pointer"
                                >
                                    <Upload className="w-5 h-5" />
                                    <span className="font-medium">Carica File AIFA (.csv)</span>
                                </button>
                            ) : (
                                <div className="space-y-2">
                                    <div className="flex justify-between text-xs text-gray-500">
                                        <span>Importazione in corso...</span>
                                        <span>{progress}%</span>
                                    </div>
                                    <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                                        <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                                    </div>
                                    <p className="text-[10px] text-gray-400 text-center">Non chiudere la pagina.</p>
                                </div>
                            )}

                            {drugStats !== null && drugStats > 0 && (
                                <div className="pt-2">
                                    <button
                                        onClick={handleClearDrugs}
                                        className="text-xs text-red-500 hover:text-red-700 hover:underline flex items-center gap-1"
                                    >
                                        <AlertTriangle className="w-3 h-3" />
                                        Svuota database farmaci
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* --- System & Maintenance Section --- */}
                <div className="md:col-span-2 space-y-6">
                    <DiagnosticHub />

                    <h3 className="text-xl font-bold text-gray-800 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-2">Sistema & Manutenzione</h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Developer Tools */}
                        <div className="bg-amber-50/50 dark:bg-amber-900/10 rounded-2xl p-6 border border-amber-100 dark:border-amber-800/30 flex flex-col justify-between">
                            <div className="flex items-start gap-4 mb-4">
                                <div className="p-2.5 bg-amber-100 text-amber-600 rounded-xl shrink-0">
                                    <Server className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-800 dark:text-gray-100">Strumenti di Sviluppo</h3>
                                    <p className="text-xs text-gray-500 mt-1">Genera dati fittizi per testare l&apos;applicazione.</p>
                                </div>
                            </div>
                            <div className="flex items-center justify-end">
                                <DataSeeder />
                            </div>
                        </div>

                        {/* Danger Zone */}
                        <div className="bg-red-50/50 dark:bg-red-900/10 rounded-2xl p-6 border border-red-100 dark:border-red-800/30">
                            <div className="flex items-start gap-4 mb-6">
                                <div className="p-2.5 bg-red-100 text-red-600 rounded-xl shrink-0">
                                    <AlertTriangle className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-800 dark:text-gray-100">Zona Pericolo</h3>
                                    <p className="text-xs text-gray-500 mt-1">Azioni irreversibili che influenzano l&apos;account.</p>
                                </div>
                            </div>

                            <div className="flex items-center justify-between p-4 bg-white dark:bg-red-950/20 rounded-xl border border-red-100 dark:border-red-900/50 shadow-sm">
                                <div>
                                    <p className="text-sm font-bold text-gray-700 dark:text-red-200">Reset Onboarding</p>
                                    <p className="text-[10px] text-gray-400">Cancella profilo utente e chiavi. (I pazienti restano)</p>
                                </div>
                                <button
                                    onClick={async () => {
                                        if (confirm("Sei sicuro? Questo cancellerà il tuo profilo utente e ti riporterà alla configurazione iniziale.\n\nI dati dei pazienti NON verranno persi, ma dovrai riconfigurare l'accesso.")) {
                                            try {
                                                const res = await fetch('/api/auth/reset', { method: 'POST' });
                                                if (res.ok) {
                                                    window.location.href = '/';
                                                } else {
                                                    alert("Errore durante il reset.");
                                                }
                                            } catch (e) {
                                                console.error(e);
                                                alert("Errore di connessione.");
                                            }
                                        }
                                    }}
                                    className="text-xs bg-white border border-red-200 text-red-600 hover:bg-red-600 hover:text-white px-3 py-2 rounded-lg font-bold transition-all shadow-sm"
                                >
                                    Reset Completo
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="border-t border-gray-200 dark:border-gray-700 pt-8">
                <BackupRestoreUI />
            </div>
        </div >
    );
}
