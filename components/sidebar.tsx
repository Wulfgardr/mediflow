'use client';

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Users, Activity, Settings, PlusCircle, ChevronRight, ChevronDown, Folder, FolderOpen, FlaskConical, Plus, Building2, CornerDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';
// import { useLiveQuery } from 'dexie-react-hooks';
// import { db } from '@/lib/db';
import { NewVisitModal } from '@/components/new-visit-modal';
import { AddAmbulatoryModal } from '@/components/add-ambulatory-modal';
import SystemStatus from '@/components/system-status';
import { usePrivacy } from '@/components/privacy-provider';
import { Eye, EyeOff } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { useSecurity } from '@/components/security-provider';

import { db, Ambulatory } from '@/lib/db';
import { useLiveQuery } from 'dexie-react-hooks';

// Helper to read cookie
function useCookie(name: string) {
    const [value, setValue] = useState<string | null>(null);
    useEffect(() => {
        const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        if (match && match[2] !== value) setValue(match[2]);
    }, [name, value]);
    return value;
}

// Recursive Tree Component
interface TreeAmbulatory extends Ambulatory {
    children: TreeAmbulatory[];
}

function AmbulatoryTree() {
    const ambulatories = useLiveQuery(() => db.ambulatories.toArray());
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const currentId = useCookie('ambulatory_id');
    const [showAddModal, setShowAddModal] = useState(false);

    // Auto-expand parents of the current ambulatory on mount
    useEffect(() => {
        if (!ambulatories || !currentId) return;

        const curr = ambulatories.find(a => a.id === currentId);
        if (!curr?.parentId) return;

        // Find all parents up the tree
        const parentsToExpand = new Set<string>();
        let parent = ambulatories.find(a => a.id === curr.parentId);
        while (parent) {
            parentsToExpand.add(parent.id);
            parent = parent.parentId ? ambulatories.find(a => a.id === parent!.parentId) : undefined;
        }

        if (parentsToExpand.size > 0) {
            setExpanded(prev => {
                const next = new Set(prev);
                parentsToExpand.forEach(id => next.add(id));
                return next;
            });
        }
    }, [ambulatories, currentId]);

    if (!ambulatories) return <div className="px-4 text-xs text-gray-400">Caricamento...</div>;

    const buildTree = (items: Ambulatory[]): TreeAmbulatory[] => {
        const roots: TreeAmbulatory[] = [];
        const map = new Map<string, TreeAmbulatory>();
        items.forEach(i => map.set(i.id, { ...i, children: [] }));
        items.forEach(i => {
            const node = map.get(i.id);
            if (node) {
                if (i.parentId && map.has(i.parentId)) {
                    map.get(i.parentId)!.children.push(node);
                } else {
                    roots.push(node);
                }
            }
        });
        return roots;
    };

    // Build hierarchy for Breadcrumb
    const getBreadcrumbs = (id: string | null): Ambulatory[] => {
        if (!id) return [];
        const path: Ambulatory[] = [];
        let curr = ambulatories.find(a => a.id === id);
        while (curr) {
            path.unshift(curr);
            curr = curr.parentId ? ambulatories.find(a => a.id === curr!.parentId) : undefined;
        }
        return path;
    };

    const breadcrumbs = getBreadcrumbs(currentId);

    const toggle = (id: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const next = new Set(expanded);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setExpanded(next);
    };

    const activate = async (id: string) => {
        try {
            await fetch('/api/context', {
                method: 'POST',
                body: JSON.stringify({ ambulatoryId: id })
            });
            window.location.reload();
        } catch (e) {
            console.error(e);
        }
    };

    const TreeNode = ({ node, level = 0 }: { node: TreeAmbulatory, level?: number }) => {
        const isExpanded = expanded.has(node.id);
        const hasChildren = node.children.length > 0;
        const isTest = node.type === 'test';
        const isActive = node.id === currentId;

        return (
            <div className="">
                <div
                    onClick={() => activate(node.id)}
                    className={cn(
                        // @Codex: improve readability and allow two-line ambulatory names
                        "flex items-start gap-3 px-3.5 py-2.5 rounded-2xl cursor-pointer text-[13px] leading-snug transition-all select-none group relative border border-transparent min-w-0",
                        isActive
                            ? "bg-blue-100/50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200 font-bold border-blue-200/50 dark:border-blue-800/50 shadow-sm"
                            : "hover:bg-gray-100 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300",
                        isTest && !isActive && "text-amber-600 dark:text-amber-500"
                    )}
                    style={{ paddingLeft: `${level * 16 + 12}px` }}
                >
                    {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-10 bg-blue-500 rounded-r-full shadow-[0_0_10px_rgba(59,130,246,0.5)]" />}

                    <button
                        onClick={(e) => toggle(node.id, e)}
                        className={cn("mt-0.5 p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 text-gray-400 hover:text-gray-600 transition-colors shrink-0", !hasChildren && "invisible")}
                    >
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>

                    {isTest ? <FlaskConical className="w-5 h-5 shrink-0 mt-0.5" /> : (isExpanded ? <FolderOpen className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" /> : <Folder className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />)}

                    {/* Color dot for visual consistency with clustered view */}
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 ${(() => {
                        const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-orange-500', 'bg-fuchsia-500'];
                        let hash = 0;
                        for (let i = 0; i < node.id.length; i++) { hash = ((hash << 5) - hash) + node.id.charCodeAt(i); hash |= 0; }
                        return colors[Math.abs(hash) % colors.length];
                    })()}`}></div>

                    <span className="flex-1 min-w-0 clamp-2 pr-1" title={node.name}>{node.name}</span>
                </div>
                {isExpanded && hasChildren && (
                    <div className="relative">
                        {/* Vertical line guide for hierarchy */}
                        <div className="absolute left-[18px] top-0 bottom-0 w-px bg-gray-200 dark:bg-gray-800" style={{ left: `${level * 16 + 20}px` }} />
                        {node.children.map((child: TreeAmbulatory) => <TreeNode key={child.id} node={child} level={level + 1} />)}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full mt-4">
            {/* LARGE CONTEXT HEADER */}
            {breadcrumbs.length > 0 ? (
                <div className="mb-8 px-1">
                    <p className="text-[11px] text-gray-400 uppercase font-bold tracking-wider mb-2 px-1">
                        Ambiente di Lavoro
                    </p>
                    <div className="bg-gradient-to-br from-blue-600 to-indigo-600 dark:from-blue-700 dark:to-indigo-800 rounded-2xl p-5 shadow-xl shadow-blue-500/20 text-white relative overflow-hidden group border border-blue-500/20">
                        <div className="absolute -top-6 -right-6 p-4 opacity-10 group-hover:opacity-20 transition-all duration-500 group-hover:scale-110">
                            <Building2 className="w-24 h-24 transform rotate-12" />
                        </div>
                        <div className="relative z-10 flex flex-col gap-1">
                            <h2 className="text-xl font-bold tracking-tight leading-tight line-clamp-2">
                                {breadcrumbs[breadcrumbs.length - 1].name}
                            </h2>
                            <div className="flex flex-wrap items-center gap-1.5 text-blue-100 text-xs mt-2 font-medium">
                                {breadcrumbs.length > 1 ? (
                                    <>
                                        <span className="opacity-80 bg-black/10 px-1.5 py-0.5 rounded">{breadcrumbs[breadcrumbs.length - 2].name}</span>
                                        <div className="opacity-50 flex items-center"><CornerDownRight className="w-3 h-3" /></div>
                                    </>
                                ) : (
                                    <span className="opacity-80 bg-black/10 px-1.5 py-0.5 rounded">Sede Principale</span>
                                )}
                                <span className="uppercase tracking-widest text-[10px] opacity-60 ml-auto border border-white/20 px-1.5 py-0.5 rounded-full">
                                    {breadcrumbs.length > 1 ? "Reparto" : "HUB"}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="mb-6 mx-1 px-4 py-6 bg-gray-50/50 dark:bg-white/5 rounded-2xl border-2 border-dashed border-gray-200 dark:border-white/10 text-center flex flex-col items-center gap-2">
                    <Building2 className="w-8 h-8 text-gray-300" />
                    <p className="text-xs text-gray-500 font-medium">Nessuna sede selezionata</p>
                </div>
            )}

            {/* Tree Section Header */}
            <div className="flex items-center justify-between px-2 mb-3">
                <p className="text-[11px] font-extrabold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                    <LayoutDashboard className="w-3.5 h-3.5" />
                    Mappa
                </p>
                <button
                    onClick={() => setShowAddModal(true)}
                    className="group flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-lg transition-all"
                    title="Nuovo Ambulatorio"
                >
                    <Plus className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
                    <span className="text-[11px] font-bold">AGGIUNGI</span>
                </button>
            </div>

            <div className="space-y-1 overflow-y-auto flex-1 scrollbar-thin px-1 pb-4">
                {buildTree(ambulatories).map(root => (
                    <TreeNode key={root.id} node={root} />
                ))}
            </div>

            <AddAmbulatoryModal
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
                parentId={currentId}
            />
        </div>
    );
}

export function Sidebar() {
    const pathname = usePathname();
    const [showNewVisitModal, setShowNewVisitModal] = useState(false);
    const { isPrivacyMode, togglePrivacyMode } = usePrivacy();
    const { user } = useSecurity();

    const profile = {
        doctor: user?.displayName || 'Medico',
        clinic: user?.ambulatoryName || 'Ambulatorio'
    };

    const links = [
        { href: '/', name: 'Pazienti', icon: Users },
        { name: 'Diario Clinico', href: '/diary', icon: LayoutDashboard },
        { name: 'Scale & Test', href: '/scales', icon: Activity },
        // { name: 'AI Assistant', href: '/assistant', icon: Brain, highlight: true },
        { name: 'Impostazioni', href: '/settings', icon: Settings },
    ];

    return (
        <>
            {/* @Codex: widen sidebar for clearer navigation */}
            <aside className="w-80 h-screen fixed left-0 top-0 p-4 z-50">
                <div className="h-full glass-panel flex flex-col p-4 bg-white/80 dark:bg-[#0d1117]/90 backdrop-blur-xl border-r border-gray-200 dark:border-[#30363d]">
                    <div className="mb-6 p-2">
                        <div className="flex justify-between items-center mb-1">
                            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
                                MediFlow
                            </h1>
                            <button
                                onClick={togglePrivacyMode}
                                title={isPrivacyMode ? "Disattiva Privacy Mode" : "Attiva Privacy Mode"}
                                className={cn(
                                    "p-1.5 rounded-lg transition-colors",
                                    isPrivacyMode ? "bg-blue-100 text-blue-600" : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                                )}
                            >
                                {isPrivacyMode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>
                        <div className="text-[10px] leading-tight text-gray-400 font-medium">
                            <span className="block text-gray-700 dark:text-gray-300 font-bold truncate">
                                {profile?.doctor || 'Medico'}
                            </span>
                            {/* Removed redundant clinic name since we show Context now */}
                            <span className="truncate block opacity-50">Gestione Clinica</span>
                        </div>
                    </div>

                    <div className="mb-4">
                        <ThemeToggle />
                    </div>

                    <nav className="space-y-1.5 flex-1 overflow-y-auto pr-1">
                        {links.map((link) => {
                            const Icon = link.icon;
                            const isActive = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href));

                            return (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    className={cn(
                                        // @Codex: increase tap targets and readability
                                        "flex items-center gap-3.5 px-3.5 py-3 rounded-2xl transition-all duration-200 group text-[15px] font-medium",
                                        isActive
                                            ? "bg-blue-50 text-blue-700 font-semibold shadow-sm dark:bg-blue-900/20 dark:text-blue-400"
                                            : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200"
                                    )}
                                >
                                    <Icon className={cn("w-5 h-5", isActive ? "text-blue-600 dark:text-blue-400" : "text-gray-400 group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300")} />
                                    <span>{link.name}</span>
                                </Link>
                            );
                        })}

                        {/* AMBULATORY SEPARATOR */}
                        <div className="my-4 border-b border-gray-100 dark:border-white/5"></div>

                        {/* AMBULATORY FILE EXPLORER */}
                        <div className="">
                            <AmbulatoryTree />
                        </div>
                    </nav>

                    <div className="mt-auto pt-4 border-t border-gray-100/50 space-y-3">
                        <SystemStatus />
                        <button
                            onClick={() => setShowNewVisitModal(true)}
                            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-cyan-600 text-white p-2.5 rounded-xl shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40 transition-all active:scale-95 text-sm font-medium"
                        >
                            <PlusCircle className="w-4 h-4" />
                            <span>Nuova Visita</span>
                        </button>
                    </div>
                </div>
            </aside>
            <NewVisitModal isOpen={showNewVisitModal} onClose={() => setShowNewVisitModal(false)} />
        </>
    );
}
