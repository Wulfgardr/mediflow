'use client';

import { useEffect, useState } from 'react';
import { checkApiStatus } from '@/lib/icd-service';
import { Server, RefreshCw, AlertCircle } from 'lucide-react';

export default function SystemStatus() {
    const [isOnline, setIsOnline] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(false);

    const check = async () => {
        setLoading(true);
        const status = await checkApiStatus();
        setIsOnline(status);
        setLoading(false);
    };

    useEffect(() => {
        check();
    }, []);

    if (isOnline === null) return null; // Initial state

    return (
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${isOnline
                ? 'bg-blue-50 border-blue-100 text-blue-700'
                : 'bg-orange-50 border-orange-100 text-orange-700'
            }`}>
            {loading ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
                isOnline ? <Server className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />
            )}

            <span className="hidden sm:inline">
                ICD-11: {isOnline ? 'Online' : 'Locale (Legacy)'}
            </span>

            {!isOnline && !loading && (
                <button
                    onClick={check}
                    className="ml-1 underline hover:text-orange-900"
                    title="Riprova connessione"
                >
                    Riprova
                </button>
            )}
        </div>
    );
}
