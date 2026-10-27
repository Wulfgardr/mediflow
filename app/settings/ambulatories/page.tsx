'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { db, Ambulatory } from '@/lib/db';
import { Plus, Loader2, CornerDownRight } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { SETTINGS_INPUT_CLASS, SETTINGS_LABEL_CLASS, SETTINGS_PRIMARY_BUTTON_CLASS } from '@/components/settings/settings-ui';
import { useConfirm } from '@/components/ui/confirm-dialog';
import styles from '@/components/settings/maintenance-pages.module.css';
import { PatientSheetMenu } from '@/components/patient-sheet-menu';
import { ViewState } from '@/components/ui/view-state';

export default function AmbulatoryManagerPage() {
    const confirm = useConfirm();
    const [ambulatories, setAmbulatories] = useState<Ambulatory[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [readError, setReadError] = useState('');
    const [actionError, setActionError] = useState('');
    const [acceptedAction, setAcceptedAction] = useState('');

    const nameInputRef = useRef<HTMLInputElement>(null);

    const [newName, setNewName] = useState('');
    const [newAddress, setNewAddress] = useState('');
    const [newParentId, setNewParentId] = useState<string>('');
    const [newType, setNewType] = useState<'live' | 'test'>('live');
    const [isClearing, setIsClearing] = useState(false);
    // Keep hierarchy rendering linear even when the sede list grows.
    const ambulatoryById = useMemo(() => new Map(ambulatories.map((item) => [item.id, item])), [ambulatories]);
    const actionsBlocked = isLoading || isCreating || isClearing || isUpdating || Boolean(readError || actionError);
    const selectedParent = newParentId ? ambulatoryById.get(newParentId) : null;

    useEffect(() => {
        loadAmbulatories();
    }, []);

    const loadAmbulatories = async () => {
        setIsLoading(true);
        try {
            const list = await db.ambulatories.toArray();
            setAmbulatories(list);
            setReadError('');
            setActionError('');
        } catch (e) {
            console.error("Failed to load ambulatories", e);
            setReadError('Impossibile leggere gli ambulatori.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreate = async () => {
        if (!newName.trim()) return;
        setAcceptedAction('');
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
            setAcceptedAction('Ambulatorio creato.');
            setNewName('');
            setNewAddress('');
            setNewParentId('');
            setNewType('live');
            await loadAmbulatories();
        } catch {
            setActionError('Errore durante la creazione');
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
            return;
        }
        setAcceptedAction('');
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
            setAcceptedAction('Ambiente di test svuotato');
            await loadAmbulatories();
        } catch (e) {
            console.error(e);
            setActionError('Errore durante lo svuotamento');
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

    const renderAmbulatoryNode = (node: AmbulatoryNodeData, level = 0): React.ReactNode => {
        const parent = node.parentId ? ambulatoryById.get(node.parentId) : null;
        const relationLabel = parent ? `Reparto di ${parent.name}` : 'Sede principale';

        return <div key={node.id}>
            <div role="treeitem" aria-selected={node.isDefault} aria-level={level + 1} className={styles.siteRow} style={{ paddingInlineStart: level * 20 }}>
                <div className={styles.siteIdentity}>
                    <h3>{node.name}</h3>
                    <p>{relationLabel}{node.address && ` · ${node.address}`}</p>
                    <p>{node.isDefault && <strong>Predefinita</strong>}{node.isDefault && node.type === 'test' && ' · '}{node.type === 'test' && <span>Ambiente di test</span>}</p>
                </div>
                <div className={styles.siteActions}>
                    <button onClick={() => handleAddChild(node.id)} disabled={actionsBlocked} title={`Aggiungi reparto sotto ${node.name}`} aria-label={`Aggiungi reparto sotto ${node.name}`} className={styles.textAction}><Plus size={14} aria-hidden />Aggiungi reparto</button>
                    <PatientSheetMenu label="Azioni" trigger={props => <button {...props} disabled={actionsBlocked} className={styles.menuTrigger} aria-label="Azioni">⋯</button>}>
                        <button role="menuitem" onClick={() => handleActivate(node.id)} disabled={actionsBlocked || node.isDefault}>{node.isDefault ? 'Già predefinita' : 'Usa come predefinita'}</button>
                        {node.type === 'test' && <button role="menuitem" onClick={() => handleClear(node.id)} aria-label="Svuota ambiente di test" disabled={actionsBlocked}>Svuota</button>}
                        <button role="menuitem" onClick={() => handleDelete(node.id)} aria-label="Elimina sede" disabled={actionsBlocked}>Elimina sede</button>
                    </PatientSheetMenu>
                </div>
            </div>
            {node.children.length > 0 && <div role="group">{node.children.map(child => renderAmbulatoryNode(child, level + 1))}</div>}
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
        setAcceptedAction('');
        setIsUpdating(true);
        try {
            const target = ambulatoryById.get(id);
            if (typeof target?.version !== 'number') throw new Error('Missing ambulatory version');
            await db.ambulatories.delete(id, { version: target?.version });
            setAcceptedAction('Ambulatorio eliminato.');
            await loadAmbulatories();
        } catch {
            setActionError("Errore durante l'eliminazione");
        } finally { setIsUpdating(false); }
    };

    const handleSetDefault = async (id: string) => {
        setAcceptedAction('');
        setIsUpdating(true);
        try {
            const target = ambulatoryById.get(id);
            if (typeof target?.version !== 'number') throw new Error('Missing ambulatory version');
            await db.ambulatories.update(id, { isDefault: true, version: target.version });
            setAcceptedAction('Ambulatorio predefinito aggiornato.');
            await loadAmbulatories();
        } catch (e) {
            console.error(e);
            setActionError('Impossibile aggiornare l’ambulatorio predefinito.');
        } finally { setIsUpdating(false); }
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
        <section className={styles.page} data-testid="settings-ambulatories-section">
            <header className={styles.intro}><h2>Ambulatori</h2><p>Sedi e contesti clinici per il lavoro quotidiano.</p></header>
            {isLoading ? <ViewState state="loading" title="Caricamento sedi..." detail={ambulatories.length ? 'L’elenco mostrato potrebbe non essere aggiornato.' : undefined} />
                : readError || actionError ? <ViewState state="error" title={readError || actionError} detail={ambulatories.length ? 'L’elenco mostrato potrebbe non essere aggiornato.' : undefined}
                    action={{ label: 'Riprova', onClick: () => void loadAmbulatories() }} />
                    : <p className={styles.meta}>{ambulatories.length} sedi configurate.</p>}
            {acceptedAction && <p role="status" className={styles.meta}>{acceptedAction}</p>}
            <section id="nuova-sede" className={styles.section}>
                <header><h3 className={styles.heading}>Nuova sede o reparto</h3>{selectedParent && <p className={styles.meta}><CornerDownRight size={14} aria-hidden />Reparto di: {selectedParent.name}</p>}</header>
                <div className={styles.fields}>
                    <label className={SETTINGS_LABEL_CLASS}>Nome<input ref={nameInputRef} placeholder="Nome sede o reparto (es. Cardiologia)" value={newName} onChange={e => setNewName(e.target.value)} className={SETTINGS_INPUT_CLASS} /></label>
                    <label className={SETTINGS_LABEL_CLASS}>Indirizzo (opzionale)<input placeholder="Indirizzo (opzionale)" value={newAddress} onChange={e => setNewAddress(e.target.value)} className={SETTINGS_INPUT_CLASS} /></label>
                    <label className={SETTINGS_LABEL_CLASS}>Ambulatorio superiore<select value={newParentId} onChange={e => setNewParentId(e.target.value)} aria-label="Sede superiore" className={SETTINGS_INPUT_CLASS}>
                        <option value="">Sede principale</option>{ambulatories.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select></label>
                    <label className={SETTINGS_LABEL_CLASS}>Tipo<select value={newType} onChange={e => setNewType(e.target.value as 'live' | 'test')} aria-label="Tipo sede" className={SETTINGS_INPUT_CLASS}><option value="live">Clinico</option><option value="test">Test</option></select></label>
                </div>
                <div className={styles.actions}><button onClick={handleCreate} disabled={!newName || actionsBlocked} className={SETTINGS_PRIMARY_BUTTON_CLASS} data-settings-primary="true">{isCreating ? <Loader2 aria-hidden /> : <Plus aria-hidden />}Aggiungi</button></div>
            </section>
            <section id="sedi" className={styles.section} aria-busy={isLoading}>
                <h3 className={styles.heading}>Sedi configurate</h3>
                <p className={styles.meta}>La sede predefinita viene usata per i nuovi dati quando non scegli un contesto diverso.</p>
                {ambulatories.length > 0 ? <div role="tree" aria-label="Ambulatori configurati">{buildTree(ambulatories).map(root => renderAmbulatoryNode(root))}</div>
                    : !isLoading && !readError && !actionError ? <ViewState state="empty" title="Nessun ambulatorio configurato." /> : null}
            </section>
        </section>
    );
}
