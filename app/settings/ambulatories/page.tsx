'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { db, Ambulatory } from '@/lib/db';
import { Plus, Trash2, Loader2, CornerDownRight } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { SettingsSectionIntro } from '@/components/settings/settings-ui';
import { useToast } from '@/components/ui/toast-provider';
import { useConfirm } from '@/components/ui/confirm-dialog';
import styles from '@/components/settings/settings-lume.module.css';

export default function AmbulatoryManagerPage() {
    const { showToast } = useToast();
    const confirm = useConfirm();
    const [ambulatories, setAmbulatories] = useState<Ambulatory[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);

    const nameInputRef = useRef<HTMLInputElement>(null);

    const [newName, setNewName] = useState('');
    const [newAddress, setNewAddress] = useState('');
    const [newParentId, setNewParentId] = useState<string>('');
    const [newType, setNewType] = useState<'live' | 'test'>('live');
    const [isClearing, setIsClearing] = useState(false);
    // Keep hierarchy rendering linear even when the sede list grows.
    const ambulatoryById = useMemo(() => new Map(ambulatories.map((item) => [item.id, item])), [ambulatories]);
    const selectedParent = newParentId ? ambulatoryById.get(newParentId) : null;

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
                version: 1,
                createdAt: new Date()
            };
            await db.ambulatories.add(newAmbulatory);
            setNewName('');
            setNewAddress('');
            setNewParentId('');
            setNewType('live');
            await loadAmbulatories();
        } catch {
            showToast('Errore durante la creazione', 'error');
            console.error("Errore durante la creazione");
        } finally {
            setIsCreating(false);
        }
    };

    const handleClear = async (id: string) => {
        const target = ambulatoryById.get(id);
        const { confirmed } = await confirm({
            title: `Svuotare "${target?.name || 'ambiente di test'}"?`,
            message: 'Tutti i pazienti verranno rimossi da questo ambiente. Quelli presenti solo in ambienti di prova saranno spostati nel Cestino; quelli presenti anche in sedi operative resteranno disponibili.',
            confirmLabel: 'Svuota',
            tone: 'danger'
        });
        if (!confirmed) return;
        if (typeof target?.version !== 'number') {
            showToast('Versione della sede non disponibile. Aggiorna la pagina e riprova.', 'error');
            return;
        }
        setIsClearing(true);
        try {
            const res = await fetch('/api/ambulatories/clear', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ambulatoryId: id, version: target.version })
            });
            if (!res.ok) throw new Error("Failed to clear");
            // preserve accepted currentness even when the following read fails.
            const accepted = await res.json() as { version?: number };
            if (!Number.isSafeInteger(accepted.version) || accepted.version! <= target.version) {
                throw new Error('Missing accepted ambulatory version');
            }
            setAmbulatories(current => current.map(item => item.id === id ? { ...item, version: accepted.version! } : item));
            await loadAmbulatories();
            showToast('Ambiente di test svuotato', 'success');
        } catch (e) {
            console.error(e);
            showToast('Errore durante lo svuotamento', 'error');
        } finally {
            setIsClearing(false);
        }
    };

    // Helper to build tree
    interface AmbulatoryNodeData extends Ambulatory {
        children: AmbulatoryNodeData[];
    }

    const buildTree = (items: Ambulatory[]): AmbulatoryNodeData[] => {
        const map = new Map<string, AmbulatoryNodeData>();
        const roots: AmbulatoryNodeData[] = [];

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

    const AmbulatoryNode = ({ node, level = 0 }: { node: AmbulatoryNodeData, level?: number }) => {
        const parent = node.parentId ? ambulatoryById.get(node.parentId) : null;
        const relationLabel = parent ? `Reparto di ${parent.name}` : 'Sede principale';

        return <div>
            <div role="treeitem" aria-selected={node.isDefault} className={styles.siteRow} style={{ paddingInlineStart: level * 20 }}>
                <div className={styles.siteIdentity}>
                    <h3>{node.name}</h3>
                    <p>{relationLabel}{node.address && ` · ${node.address}`}</p>
                    <p>{node.isDefault && <strong>Predefinita</strong>}{node.isDefault && node.type === 'test' && ' · '}{node.type === 'test' && <span>Ambiente di test</span>}</p>
                </div>
                <div className={styles.siteActions}>
                    <button onClick={() => handleAddChild(node.id)} title={`Aggiungi reparto sotto ${node.name}`} aria-label={`Aggiungi reparto sotto ${node.name}`}><Plus size={14} aria-hidden />Aggiungi reparto</button>
                    <button onClick={() => handleActivate(node.id)} disabled={node.isDefault}>{node.isDefault ? 'Già predefinita' : 'Usa come predefinita'}</button>
                    {node.type === 'test' && <button onClick={() => handleClear(node.id)} title="Svuota ambiente di test" aria-label="Svuota ambiente di test" disabled={isClearing}>Svuota</button>}
                    <button onClick={() => handleDelete(node.id)} aria-label="Elimina sede"><Trash2 size={16} aria-hidden /></button>
                </div>
            </div>
            {node.children.length > 0 && <div role="group">{node.children.map(child => <AmbulatoryNode key={child.id} node={child} level={level + 1} />)}</div>}
        </div>;
    };

    const handleDelete = async (id: string) => {
        const { confirmed } = await confirm({
            title: 'Eliminare la sede?',
            message: 'Questo potrebbe causare problemi ai pazienti associati.',
            confirmLabel: 'Elimina',
            tone: 'danger'
        });
        if (!confirmed) return;
        try {
            const target = ambulatoryById.get(id);
            if (typeof target?.version !== 'number') throw new Error('Missing ambulatory version');
            await db.ambulatories.delete(id, { version: target?.version });
            await loadAmbulatories();
        } catch {
            showToast("Errore durante l'eliminazione", 'error');
        }
    };

    const handleSetDefault = async (id: string) => {
        try {
            const target = ambulatoryById.get(id);
            if (typeof target?.version !== 'number') throw new Error('Missing ambulatory version');
            await db.ambulatories.update(id, { isDefault: true, version: target.version });
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
        <div className="space-y-6" data-testid="settings-ambulatories-section">
            <SettingsSectionIntro
                kicker="Generale"
                title="Ambulatori"
                description="Sedi e contesti clinici per il lavoro quotidiano."
            />
            <p className="text-xs" style={{ color: 'var(--lume-ink-muted)' }}>
                {isLoading ? 'Caricamento sedi...' : `${ambulatories.length} sedi configurate.`}
            </p>
            <section id="nuova-sede" className={styles.siteForm}>
                <header className={styles.siteFormHeading}>
                    <h3>Nuova sede o reparto</h3>
                    {selectedParent && <p><CornerDownRight size={14} aria-hidden />Reparto di: {selectedParent.name}</p>}
                </header>

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col md:flex-row gap-4">
                        <input
                            ref={nameInputRef}
                            placeholder="Nome sede o reparto (es. Cardiologia)"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            className="mf-input flex-1"
                        />
                        <input
                            placeholder="Indirizzo (opzionale)"
                            value={newAddress}
                            onChange={(e) => setNewAddress(e.target.value)}
                            className="mf-input flex-1"
                        />
                    </div>
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_160px_auto] md:items-center">
                        <select
                            value={newParentId}
                            onChange={(e) => setNewParentId(e.target.value)}
                            aria-label="Sede superiore"
                            className="mf-input min-w-0"
                        >
                            <option value="">Sede principale</option>
                            {ambulatories.map(a => (
                                <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                        </select>
                        <select
                            value={newType}
                            onChange={(e) => setNewType(e.target.value as 'live' | 'test')}
                            aria-label="Tipo sede"
                            className="mf-input min-w-0"
                        >
                            <option value="live">Clinico</option>
                            <option value="test">Test</option>
                        </select>
                        <button
                            onClick={handleCreate}
                            disabled={!newName || isCreating}
                            className="ui-btn-primary flex items-center gap-2 px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 text-sm whitespace-nowrap min-w-[120px] justify-center"
                        >
                            {isCreating ? <Loader2 className="w-4 h-4" /> : <Plus className="w-4 h-4 mr-2" />}
                            Aggiungi
                        </button>
                    </div>
                </div>
            </section>

            <section id="sedi" className={styles.siteRegister}>
                <div className="mb-5">
                    <h2 className="text-sm font-semibold" style={{ color: 'var(--lume-ink)' }}>Sedi configurate</h2>
                    <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--lume-ink-muted)' }}>
                        La sede predefinita viene usata per i nuovi dati quando non scegli un contesto diverso.
                    </p>
                </div>

                <div className="grid grid-cols-1 gap-4">
                {isLoading ? (
                    <div className="text-center py-10 text-[color:var(--lume-ink-muted)]">Caricamento...</div>
                ) : ambulatories.length === 0 ? (
                    <div className="py-4 text-[color:var(--lume-ink-muted)]">
                        Nessun ambulatorio configurato.
                    </div>
                ) : (
                    <div role="tree" aria-label="Ambulatori configurati">
                        {buildTree(ambulatories).map(root => (
                            <AmbulatoryNode key={root.id} node={root} />
                        ))}
                    </div>
                )}
                </div>
            </section>
        </div>
    );
}
