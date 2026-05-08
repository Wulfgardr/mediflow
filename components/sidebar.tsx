'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Activity, Settings, PlusCircle,
  ChevronRight, ChevronDown, Folder, FolderOpen, FlaskConical,
  Plus, Building2, Eye, EyeOff, BarChart3
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { db, Ambulatory } from '@/lib/db';
import { useLiveQuery } from '@/lib/live-query';

import { NewVisitModal } from '@/components/new-visit-modal';
import { AddAmbulatoryModal } from '@/components/add-ambulatory-modal';
import SystemStatus from '@/components/system-status';
import { usePrivacy } from '@/components/privacy-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { useSecurity } from '@/components/security-provider';

// Helper to read cookie
function useCookie(name: string) {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match?.[2] ?? null;
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
                    role="treeitem"
                    tabIndex={0}
                    aria-selected={isActive}
                    aria-expanded={hasChildren ? isExpanded : undefined}
                    aria-label={node.name}
                    onClick={() => activate(node.id)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            activate(node.id);
                        }
                    }}
                    className={cn(
                        "flex items-start gap-3 px-3 py-2 rounded-xl cursor-pointer text-[13px] leading-snug transition-[border-color,background-color,color] select-none group relative border border-transparent min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:rgba(15,123,104,0.4)]",
                        isActive
                            ? "bg-[color:rgba(15,123,104,0.1)] text-[color:var(--mf-primary)] font-semibold border-[color:rgba(15,123,104,0.22)]"
                            : "hover:bg-black/5 dark:hover:bg-white/5 text-gray-600 dark:text-gray-400",
                        isTest && !isActive && "text-amber-600/80 dark:text-amber-500/80"
                    )}
                    style={{ paddingLeft: `${level * 12 + 12}px` }}
                >
                    {isActive && <div className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-[linear-gradient(180deg,var(--mf-primary),var(--mf-accent),var(--mf-plum))]" />}

                    <button
                        onClick={(e) => toggle(node.id, e)}
                        aria-label={hasChildren ? (isExpanded ? 'Comprimi' : 'Espandi') : undefined}
                        aria-hidden={!hasChildren}
                        tabIndex={hasChildren ? 0 : -1}
                        className={cn("mt-0.5 p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/5 text-gray-400 transition-colors shrink-0", !hasChildren && "invisible")}
                    >
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>

                    {isTest ? <FlaskConical className="w-4 h-4 shrink-0 mt-0.5 opacity-70" /> : (isExpanded ? <FolderOpen className="w-4 h-4 shrink-0 mt-0.5 text-[color:rgba(15,123,104,0.72)]" /> : <Folder className="w-4 h-4 shrink-0 mt-0.5 text-[color:rgba(15,123,104,0.72)]" />)}

                    <span className="flex-1 min-w-0 clamp-2 pr-1" title={node.name}>{node.name}</span>
                </div>
                {isExpanded && hasChildren && (
                    <div role="group" className="relative">
                        <div className="absolute left-[18px] top-0 bottom-0 w-px bg-gray-200/50 dark:bg-gray-800/50" style={{ left: `${level * 12 + 18}px` }} />
                        {node.children.map((child: TreeAmbulatory) => <TreeNode key={child.id} node={child} level={level + 1} />)}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full mt-4">
            {/* AMBIENTE DI LAVORO - Disciplined Context Header */}
            {breadcrumbs.length > 0 ? (
                <div className="mb-6 px-1">
                    <p className="section-kicker mb-2 px-1">
                        Ambiente di Lavoro
                    </p>
                    <div className="bg-white/50 dark:bg-white/5 rounded-2xl p-4 border border-black/5 dark:border-white/10 shadow-sm relative overflow-hidden group">
                        <div className="relative z-10 flex flex-col gap-1">
                            <h2 className="text-base font-bold tracking-tight leading-tight line-clamp-2 text-gray-900 dark:text-gray-100">
                                {breadcrumbs[breadcrumbs.length - 1].name}
                            </h2>
                            <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 text-[11px] mt-1.5 font-medium">
                                <Building2 className="w-3 h-3 opacity-50" />
                                {breadcrumbs.length > 1 ? (
                                    <span className="truncate">{breadcrumbs[breadcrumbs.length - 2].name}</span>
                                ) : (
                                    <span>Sede Principale</span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="mb-6 mx-1 px-4 py-5 bg-black/5 dark:bg-white/5 rounded-2xl border border-dashed border-gray-200 dark:border-white/10 text-center flex flex-col items-center gap-2">
                    <Building2 className="w-6 h-6 text-gray-300" />
                    <p className="text-[11px] text-gray-400 font-medium">Nessuna sede selezionata</p>
                </div>
            )}

            {/* Tree Section Header */}
            <div className="flex items-center justify-between px-2 mb-2">
                <p className="section-kicker flex items-center gap-2">
                    Struttura
                </p>
                <button
                    onClick={() => setShowAddModal(true)}
                    className="p-1 text-gray-400 transition-colors hover:text-[color:var(--mf-primary)]"
                    title="Nuovo Ambulatorio"
                    aria-label="Nuovo Ambulatorio"
                >
                    <Plus className="w-3.5 h-3.5" />
                </button>
            </div>

            <div role="tree" aria-label="Ambulatori" className="space-y-0.5 overflow-y-auto flex-1 scrollbar-thin px-1 pb-4">
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
    };

    const links = [
        { href: '/', name: 'Pazienti', icon: Users, matchPrefixes: ['/patients'] as string[] },
        { href: '/diary', name: 'Diario Clinico', icon: LayoutDashboard },
        { href: '/scales', name: 'Scale & Test', icon: Activity },
        { href: '/analytics', name: 'Analytics', icon: BarChart3 },
        { href: '/settings', name: 'Impostazioni', icon: Settings },
    ];

    return (
        <>
            <aside className="w-80 h-screen fixed left-0 top-0 p-4 z-50">
                <div className="mediflow-sidebar-shell relative h-full glass-panel flex flex-col overflow-hidden p-4 rounded-[28px]">
                    <div className="mb-6 px-2 pt-2">
                        <div className="flex justify-between items-center mb-1">
                            <h1 className="text-lg font-black tracking-tight text-gray-900 dark:text-white">
                                MediFlow
                            </h1>
                            <button
                                onClick={togglePrivacyMode}
                                title={isPrivacyMode ? "Disattiva Privacy Mode" : "Attiva Privacy Mode"}
                                className={cn(
                                    "p-1.5 rounded-lg transition-colors",
                                    isPrivacyMode ? "bg-[color:rgba(15,123,104,0.12)] text-[color:var(--mf-primary)] dark:bg-[color:rgba(15,123,104,0.16)]" : "text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-white/5"
                                )}
                            >
                                {isPrivacyMode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>
                        <div className="flex items-center gap-2 mt-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[color:rgba(15,123,104,0.16)] bg-[color:rgba(15,123,104,0.1)]">
                                <span className="text-xs font-bold text-[color:var(--mf-primary)]">{profile.doctor.charAt(0)}</span>
                            </div>
                            <div className="min-w-0">
                                <span className="block text-[13px] text-gray-900 dark:text-gray-100 font-bold truncate">
                                    {profile?.doctor}
                                </span>
                                <span className="block text-[10px] text-gray-400 font-medium uppercase tracking-wider">Sessione Attiva</span>
                            </div>
                        </div>
                    </div>

                    <div className="mb-4 px-2">
                        <ThemeToggle />
                    </div>

                    <nav className="space-y-1 flex-1 overflow-y-auto pr-1">
                        {links.map((link) => {
                            const Icon = link.icon;
                            const prefixMatch = link.matchPrefixes?.some((p) => pathname === p || pathname.startsWith(`${p}/`));
                            const isActive = pathname === link.href
                                || (link.href !== '/' && pathname.startsWith(link.href))
                                || !!prefixMatch;

                            return (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    aria-current={isActive ? 'page' : undefined}
                                    className={cn(
                                        "mediflow-sidebar-link flex items-center gap-3 px-3 py-2.5 rounded-xl transition-[border-color,background-color,color,box-shadow] duration-200 group text-[14px] font-medium",
                                        isActive
                                            ? "bg-[color:rgba(15,123,104,0.1)] text-[color:var(--mf-primary)] font-semibold"
                                            : "text-gray-500 hover:bg-black/5 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200"
                                    )}
                                >
                                    <Icon className={cn(
                                        "w-4.5 h-4.5",
                                        isActive
                                            ? "text-[color:var(--mf-primary)]"
                                            : "text-gray-400 group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300"
                                    )} />
                                    <span>{link.name}</span>
                                </Link>
                            );
                        })}

                        <div className="my-4 mx-2 border-b border-gray-100 dark:border-white/5"></div>

                        <div className="">
                            <AmbulatoryTree />
                        </div>
                    </nav>

                    <div className="mt-auto pt-4 space-y-3">
                        <SystemStatus />
                        <button
                            onClick={() => setShowNewVisitModal(true)}
                            className="w-full flex items-center justify-center gap-2 p-2.5 text-[13px] font-bold rounded-xl bg-gray-900 text-white shadow-sm transition-[opacity,transform,box-shadow] hover:opacity-90 active:scale-[0.98] dark:bg-white dark:text-gray-900"
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
