'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Users, Activity, Settings, PlusCircle, Brain } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { NewVisitModal } from '@/components/new-visit-modal';
import SystemStatus from '@/components/system-status';
import { usePrivacy } from '@/components/privacy-provider';
import { Eye, EyeOff } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

export function Sidebar() {
    const pathname = usePathname();
    const [showNewVisitModal, setShowNewVisitModal] = useState(false);
    const { isPrivacyMode, togglePrivacyMode } = usePrivacy();

    const profile = useLiveQuery(async () => {
        const doctor = await db.settings.get('doctorName');
        const clinic = await db.settings.get('clinicName');
        return {
            doctor: doctor?.value || 'Medico',
            clinic: clinic?.value || 'Ambulatorio'
        };
    });

    const links = [
        { href: '/', name: 'Pazienti', icon: Users },
        { name: 'Diario Clinico', href: '/diary', icon: LayoutDashboard },
        { name: 'Scale & Test', href: '/scales', icon: Activity },
        { name: 'AI Assistant', href: '/assistant', icon: Brain, highlight: true },
        { name: 'Impostazioni', href: '/settings', icon: Settings },
    ];

    return (
        <>
            <aside className="w-64 h-screen fixed left-0 top-0 p-4 z-50">
                <div className="h-full glass-panel flex flex-col p-4">
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
                            <span className="truncate block">{profile?.clinic || 'Ambulatorio'}</span>
                        </div>
                    </div>

                    <div className="mb-4">
                        <ThemeToggle />
                    </div>

                    <nav className="space-y-2 flex-1">
                        {links.map((link) => {
                            const Icon = link.icon;
                            const isActive = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href));

                            return (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    className={cn(
                                        "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group",
                                        isActive
                                            ? "bg-blue-500/10 text-blue-700 shadow-sm border border-blue-100"
                                            : "text-gray-600 hover:bg-white/50 hover:text-blue-600"
                                    )}
                                >
                                    <Icon className={cn("w-5 h-5", isActive ? "text-blue-600" : "text-gray-400 group-hover:text-blue-500")} />
                                    <span className="font-medium">{link.name}</span>
                                </Link>
                            );
                        })}
                    </nav>

                    <div className="mt-auto pt-4 border-t border-gray-100/50 space-y-3">
                        <SystemStatus />
                        <button
                            onClick={() => setShowNewVisitModal(true)}
                            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-cyan-600 text-white p-3 rounded-xl shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40 transition-all active:scale-95"
                        >
                            <PlusCircle className="w-5 h-5" />
                            <span className="font-semibold">Nuova Visita</span>
                        </button>
                    </div>
                </div>
            </aside>
            <NewVisitModal isOpen={showNewVisitModal} onClose={() => setShowNewVisitModal(false)} />
        </>
    );
}
