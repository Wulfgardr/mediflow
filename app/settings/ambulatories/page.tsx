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
            <div
                role="treeitem"
                aria-selected={node.isDefault}
                className={cn(
                    "bg-[color:var(--mf-bg-elevated)] dark:bg-white/6 border rounded-xl p-6 transition-all flex items-center justify-between shadow-sm relative",
                    node.isDefault ? "border-[color:rgba(15,123,104,0.38)] shadow-md ring-1 ring-[color:rgba(15,123,104,0.22)]" : "border-[color:rgba(112,106,100,0.14)]",
                    level > 0 && "ml-8 border-l-4 border-l-[color:rgba(15,123,104,0.18)]"
                )}
            >
                {/* Connection Line for hierarchy */}
                {level > 0 && (
                    <div className="absolute -left-8 top-1/2 w-8 h-px bg-[color:rgba(112,106,100,0.2)]"></div>
                )}

                <div className="space-y-1">
                    <h3 className="text-lg font-semibold flex items-center gap-2 text-[color:var(--mf-ink)] dark:text-white">
                        {node.name}
                        {node.isDefault && <span className="bg-[color:rgba(15,123,104,0.12)] text-[color:var(--mf-primary)] text-xs px-2 py-0.5 rounded-full border border-[color:rgba(15,123,104,0.22)]">System Default</span>}
                        {node.type === 'test' && <span className="bg-[color:rgba(197,138,47,0.14)] text-[color:var(--mf-warning)] text-xs px-2 py-0.5 rounded-full font-mono uppercase border border-[color:rgba(197,138,47,0.28)]">TEST ZONE</span>}
                    </h3>
                    {node.address && (
                        <div className="text-sm text-[color:var(--mf-muted)] flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {node.address}
                        </div>
                    )}
                    <div className="text-xs text-[color:var(--mf-muted)]/80 font-mono">
                        ID: {node.id}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => handleAddChild(node.id)}
                        className="flex items-center gap-1.5 px-3 py-1 bg-[color:rgba(15,123,104,0.1)] hover:bg-[color:rgba(15,123,104,0.16)] text-[color:var(--mf-primary)] rounded-lg text-sm font-medium transition-colors mr-2 border border-[color:rgba(15,123,104,0.22)]"
                        title="Aggiungi Reparto/Figlio"
                        aria-label="Aggiungi Reparto"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        Reparto
                    </button>
                    <button
                        onClick={() => handleActivate(node.id)}
                        className="px-3 py-1 bg-white/60 dark:bg-white/6 hover:bg-white/80 dark:hover:bg-white/10 border border-[color:rgba(112,106,100,0.14)] text-[color:var(--mf-ink)] rounded-lg text-sm font-medium transition-colors"
                    >
                        Attiva
                    </button>
                    {!node.isDefault && (
                        <button
                            onClick={() => handleSetDefault(node.id)}
                            title="Imposta come System Default"
                            aria-label="Imposta come Default"
                            className="p-2 hover:bg-[color:rgba(15,123,104,0.1)] rounded-lg text-[color:var(--mf-muted)] hover:text-[color:var(--mf-primary)] transition-colors"
                        >
                            <Check className="w-5 h-5" />
                        </button>
                    )}
                    {node.type === 'test' && (
                        <button
                            onClick={() => handleClear(node.id)}
                            title="Svuota Contenitore (Elimina tutti i pazienti)"
                            aria-label="Svuota Contenitore"
                            className="px-3 py-1 border border-[color:rgba(163,58,47,0.28)] text-[color:var(--mf-critical)] hover:bg-[color:rgba(163,58,47,0.08)] rounded-lg text-sm font-medium transition-colors"
                            disabled={isClearing}
                        >
                            Svuota
                        </button>
                    )}
                    <button
                        onClick={() => handleDelete(node.id)}
                        aria-label="Elimina Ambulatorio"
                        className="p-2 hover:bg-[color:rgba(163,58,47,0.08)] rounded-lg text-[color:var(--mf-critical)]/80 hover:text-[color:var(--mf-critical)] transition-colors"
                    >
                        <Trash2 className="w-5 h-5" />
                    </button>
                </div>
            </div>
            {/* Recursion */}
            {node.children.length > 0 && (
                <div role="group" className="space-y-4">
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
                    <h1 className="text-2xl font-bold flex items-center gap-2 text-[color:var(--mf-ink)] dark:text-white">
                        <Building2 className="w-8 h-8 text-[color:var(--mf-primary)]" />
                        Gestione Ambulatori
                    </h1>
                    <p className="text-[color:var(--mf-muted)]">Configura le sedi e gli ambulatori disponibili.</p>
                </div>
            </div>

            <div className={cn(
                'bg-[color:var(--mf-bg-elevated)] dark:bg-white/6 border rounded-xl p-6 shadow-sm transition-all',
                newParentId ? 'border-[color:rgba(15,123,104,0.38)] ring-1 ring-[color:rgba(15,123,104,0.22)]' : 'border-[color:rgba(112,106,100,0.14)]',
            )}>
                <div className="mb-6 flex items-center gap-4 border-b border-[color:rgba(112,106,100,0.14)] pb-4">
                    <div className="p-3 bg-[color:rgba(15,123,104,0.1)] rounded-xl text-[color:var(--mf-primary)]">
                        <Building2 className="w-6 h-6" />
                    </div>
                    <div>
                        <h3 className="text-xl font-bold text-[color:var(--mf-ink)] dark:text-white flex items-center gap-2">
                            Apri un Ambulatorio
                            {newParentId && <span className="text-sm font-normal bg-[color:rgba(15,123,104,0.1)] text-[color:var(--mf-primary)] px-2 py-1 rounded-full flex items-center gap-1 border border-[color:rgba(15,123,104,0.22)]"><CornerDownRight className="w-3 h-3" /> Reparto di: {ambulatories.find(a => a.id === newParentId)?.name}</span>}
                        </h3>
                        <p className="text-sm text-[color:var(--mf-muted)]">Inaugura una nuova sede clinica o un reparto.</p>
                    </div>
                </div>

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col md:flex-row gap-4">
                        <input
                            ref={nameInputRef}
                            placeholder="Nome Ambulatorio (es. Cardiologia)"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            className="flex-1 px-3 py-2 border border-[color:rgba(112,106,100,0.2)] rounded-lg bg-white/60 dark:bg-white/6 text-sm outline-none focus:border-[color:rgba(15,123,104,0.38)] focus:shadow-[0_0_0_4px_rgba(15,123,104,0.08)] transition-[border-color,box-shadow]"
                        />
                        <input
                            placeholder="Indirizzo (opzionale)"
                            value={newAddress}
                            onChange={(e) => setNewAddress(e.target.value)}
                            className="flex-1 px-3 py-2 border border-[color:rgba(112,106,100,0.2)] rounded-lg bg-white/60 dark:bg-white/6 text-sm outline-none focus:border-[color:rgba(15,123,104,0.38)] focus:shadow-[0_0_0_4px_rgba(15,123,104,0.08)] transition-[border-color,box-shadow]"
                        />
                    </div>
                    <div className="flex flex-col md:flex-row gap-4 items-center">
                        <select
                            value={newParentId}
                            onChange={(e) => setNewParentId(e.target.value)}
                            aria-label="Ambulatorio Genitore"
                            className="flex-1 px-3 py-2 border border-[color:rgba(112,106,100,0.2)] rounded-lg bg-white/60 dark:bg-white/6 text-sm outline-none focus:border-[color:rgba(15,123,104,0.38)]"
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
                            className="w-32 px-3 py-2 border border-[color:rgba(112,106,100,0.2)] rounded-lg bg-white/60 dark:bg-white/6 text-sm outline-none focus:border-[color:rgba(15,123,104,0.38)]"
                        >
                            <option value="live">Live</option>
                            <option value="test">Test</option>
                        </select>
                        <button
                            onClick={handleCreate}
                            disabled={!newName || isCreating}
                            className="ui-btn-primary flex items-center gap-2 px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 text-sm whitespace-nowrap min-w-[120px] justify-center"
                        >
                            {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                            Aggiungi
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
                {isLoading ? (
                    <div className="text-center py-10 text-[color:var(--mf-muted)]">Caricamento...</div>
                ) : ambulatories.length === 0 ? (
                    <div className="text-center py-10 bg-[color:rgba(255,249,240,0.5)] dark:bg-white/4 rounded-lg border border-dashed border-[color:rgba(112,106,100,0.2)] text-[color:var(--mf-muted)]">
                        Nessun ambulatorio configurato.
                    </div>
                ) : (
                    <div role="tree" aria-label="Ambulatori configurati" className="space-y-6">
                        {buildTree(ambulatories).map(root => (
                            <AmbulatoryNode key={root.id} node={root} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
