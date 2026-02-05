'use client';

import { useState, useEffect, useRef } from 'react';
import { db, Ambulatory } from '@/lib/db';
import { Building2, Plus, Trash2, Check, MapPin, Loader2, CornerDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { v4 as uuidv4 } from 'uuid';

export default function AmbulatoryManagerPage() {
    const [ambulatories, setAmbulatories] = useState<Ambulatory[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);

    const nameInputRef = useRef<HTMLInputElement>(null);

    // Form state
    const [newName, setNewName] = useState('');
    const [newAddress, setNewAddress] = useState('');
    const [newParentId, setNewParentId] = useState<string>('');
    const [newType, setNewType] = useState<'live' | 'test'>('live');
    const [isClearing, setIsClearing] = useState(false);

    useEffect(() => {
        loadAmbulatories();
    }, []);

    const loadAmbulatories = async () => {
        setIsLoading(true);
        try {
            const list = await db.ambulatories.toArray();
            setAmbulatories(list);
        } catch (e) {
            console.error("Failed to load ambulatories", e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreate = async () => {
        if (!newName.trim()) return;
        setIsCreating(true);
        try {
            const newAmbulatory: Ambulatory = {
                id: uuidv4(),
                name: newName,
                address: newAddress,
                parentId: newParentId || null,
                type: newType,
                isDefault: ambulatories.length === 0, // First one is default
                createdAt: new Date()
            };
            await db.ambulatories.add(newAmbulatory);
            setNewName('');
            setNewAddress('');
            setNewParentId('');
            setNewType('live');
            await loadAmbulatories();
        } catch {
            alert("Errore durante la creazione");
            console.error("Errore durante la creazione");
        } finally {
            setIsCreating(false);
        }
    };

    const handleClear = async (id: string) => {
        if (!confirm("ATTENZIONE: Stai per eliminare TUTTI i pazienti in questo ambiente di TEST. Continuare?")) return;
        setIsClearing(true);
        try {
            const res = await fetch('/api/ambulatories/clear', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ambulatoryId: id })
            });
            if (!res.ok) throw new Error("Failed to clear");
            alert("Contenitore svuotato con successo.");
        } catch (e) {
            console.error(e);
            alert("Errore durante lo svuotamento");
        } finally {
            setIsClearing(false);
        }
    };

    // Helper to build tree
    interface AmbulatoryNode extends Ambulatory {
        children: AmbulatoryNode[];
    }

    const buildTree = (items: Ambulatory[]): AmbulatoryNode[] => {
        const map = new Map<string, AmbulatoryNode>();
        const roots: AmbulatoryNode[] = [];

        items.forEach(item => {
            map.set(item.id, { ...item, children: [] });
        });

        items.forEach(item => {
            const node = map.get(item.id);
            if (!node) return;
            if (item.parentId && map.has(item.parentId)) {
                map.get(item.parentId)!.children.push(node);
            } else {
                roots.push(node);
            }
        });
        return roots;
    };

    const AmbulatoryNode = ({ node, level = 0 }: { node: AmbulatoryNode, level?: number }) => (
        <div className="space-y-4">
            <div className={cn(
                "bg-white dark:bg-[#161b22] border rounded-xl p-6 transition-all flex items-center justify-between shadow-sm relative",
                node.isDefault ? "border-blue-500 shadow-md ring-1 ring-blue-500" : "border-gray-200 dark:border-[#30363d]",
                level > 0 && "ml-8 border-l-4 border-l-gray-300 dark:border-l-gray-700"
            )}>
                {/* Connection Line for hierarchy */}
                {level > 0 && (
                    <div className="absolute -left-8 top-1/2 w-8 h-px bg-gray-300 dark:bg-gray-700"></div>
                )}

                <div className="space-y-1">
                    <h3 className="text-lg font-semibold flex items-center gap-2 text-gray-900 dark:text-white">
                        {node.name}
                        {node.isDefault && <span className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200 text-xs px-2 py-0.5 rounded-full">System Default</span>}
                        {node.type === 'test' && <span className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200 text-xs px-2 py-0.5 rounded-full font-mono uppercase">TEST ZONE</span>}
                    </h3>
                    {node.address && (
                        <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {node.address}
                        </div>
                    )}
                    <div className="text-xs text-gray-400 font-mono">
                        ID: {node.id}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => handleAddChild(node.id)}
                        className="flex items-center gap-1.5 px-3 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:hover:bg-blue-900/40 dark:text-blue-200 rounded-lg text-sm font-medium transition-colors mr-2"
                        title="Aggiungi Reparto/Figlio"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        Reparto
                    </button>
                    <button
                        onClick={() => handleActivate(node.id)}
                        className="px-3 py-1 bg-gray-100 dark:bg-[#21262d] hover:bg-gray-200 dark:hover:bg-[#30363d] rounded-lg text-sm font-medium transition-colors"
                    >
                        Attiva
                    </button>
                    {!node.isDefault && (
                        <button
                            onClick={() => handleSetDefault(node.id)}
                            title="Imposta come System Default"
                            aria-label="Imposta come Default"
                            className="p-2 hover:bg-gray-100 dark:hover:bg-[#21262d] rounded-lg text-gray-400 hover:text-green-600 transition-colors"
                        >
                            <Check className="w-5 h-5" />
                        </button>
                    )}
                    {node.type === 'test' && (
                        <button
                            onClick={() => handleClear(node.id)}
                            title="Svuota Contenitore (Elimina tutti i pazienti)"
                            className="px-3 py-1 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium transition-colors"
                            disabled={isClearing}
                        >
                            Svuota
                        </button>
                    )}
                    <button
                        onClick={() => handleDelete(node.id)}
                        aria-label="Elimina Ambulatorio"
                        className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-500 hover:text-red-700 transition-colors"
                    >
                        <Trash2 className="w-5 h-5" />
                    </button>
                </div>
            </div>
            {/* Recursion */}
            {node.children.length > 0 && (
                <div className="space-y-4">
                    {node.children.map((child) => (
                        <AmbulatoryNode key={child.id} node={child} level={level + 1} />
                    ))}
                </div>
            )}
        </div>
    );

    const handleDelete = async (id: string) => {
        if (!confirm("Sei sicuro? Questo potrebbe causare problemi ai pazienti associati.")) return;
        try {
            await db.ambulatories.delete(id);
            await loadAmbulatories();
        } catch {
            alert("Errore durante l'eliminazione");
        }
    };

    const handleSetDefault = async (id: string) => {
        // This logic is tricky client-side without transactions, but fine for prototype
        try {
            const currentDefault = ambulatories.find(a => a.isDefault);
            if (currentDefault) {
                await db.ambulatories.update(currentDefault.id, { isDefault: false });
            }
            await db.ambulatories.update(id, { isDefault: true });
            await loadAmbulatories();
        } catch (e) {
            console.error(e);
        }
    };

    const handleActivate = (id: string) => handleSetDefault(id);

    const handleAddChild = (parentId: string) => {
        setNewParentId(parentId);
        setNewName('');
        // Smooth scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => nameInputRef.current?.focus(), 500);
    };

    return (
        <div className="container mx-auto p-6 max-w-4xl space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2 text-gray-900 dark:text-white">
                        <Building2 className="w-8 h-8 text-blue-600" />
                        Gestione Ambulatori
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400">Configura le sedi e gli ambulatori disponibili.</p>
                </div>
            </div>

            <div className={`bg-white dark:bg-[#161b22] border rounded-xl p-6 shadow-sm transition-all ${newParentId ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200 dark:border-[#30363d]'}`}>
                <div className="mb-6 flex items-center gap-4 border-b border-gray-100 dark:border-[#30363d] pb-4">
                    <div className="p-3 bg-blue-100/50 dark:bg-blue-900/20 rounded-xl text-blue-600 dark:text-blue-400">
                        <Building2 className="w-6 h-6" />
                    </div>
                    <div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            Apri un Ambulatorio
                            {newParentId && <span className="text-sm font-normal bg-blue-50 text-blue-600 px-2 py-1 rounded-full flex items-center gap-1 border border-blue-100"><CornerDownRight className="w-3 h-3" /> Reparto di: {ambulatories.find(a => a.id === newParentId)?.name}</span>}
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Inaugura una nuova sede clinica o un reparto.</p>
                    </div>
                </div>

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col md:flex-row gap-4">
                        <input
                            ref={nameInputRef}
                            placeholder="Nome Ambulatorio (es. Cardiologia)"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            className="flex-1 px-3 py-2 border border-gray-300 dark:border-[#30363d] rounded-lg bg-transparent text-sm"
                        />
                        <input
                            placeholder="Indirizzo (opzionale)"
                            value={newAddress}
                            onChange={(e) => setNewAddress(e.target.value)}
                            className="flex-1 px-3 py-2 border border-gray-300 dark:border-[#30363d] rounded-lg bg-transparent text-sm"
                        />
                    </div>
                    <div className="flex flex-col md:flex-row gap-4 items-center">
                        <select
                            value={newParentId}
                            onChange={(e) => setNewParentId(e.target.value)}
                            aria-label="Ambulatorio Genitore"
                            className="flex-1 px-3 py-2 border border-gray-300 dark:border-[#30363d] rounded-lg bg-transparent text-sm"
                        >
                            <option value="">Nessun Genitore (Root)</option>
                            {ambulatories.map(a => (
                                <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                        </select>
                        <select
                            value={newType}
                            onChange={(e) => setNewType(e.target.value as 'live' | 'test')}
                            aria-label="Tipo Ambulatorio"
                            className="w-32 px-3 py-2 border border-gray-300 dark:border-[#30363d] rounded-lg bg-transparent text-sm"
                        >
                            <option value="live">Live</option>
                            <option value="test">Test</option>
                        </select>
                        <button
                            onClick={handleCreate}
                            disabled={!newName || isCreating}
                            className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 text-sm whitespace-nowrap min-w-[120px] justify-center"
                        >
                            {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                            Aggiungi
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
                {isLoading ? (
                    <div className="text-center py-10 text-gray-400">Caricamento...</div>
                ) : ambulatories.length === 0 ? (
                    <div className="text-center py-10 bg-gray-50 dark:bg-[#0d1117] rounded-lg border border-dashed border-gray-300 dark:border-[#30363d] text-gray-500">
                        Nessun ambulatorio configurato.
                    </div>
                ) : (
                    <div className="space-y-6">
                        {buildTree(ambulatories).map(root => (
                            <AmbulatoryNode key={root.id} node={root} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
