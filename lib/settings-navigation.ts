// WUL-297: information architecture for the settings sidebar and the
// "Cerca impostazione" quick-jump. Pure data module: no React imports so it
// stays testable with node --test.

export type SettingsNavItem = {
    id: string;
    href: string;
    label: string;
    description: string;
    /** Individual setting labels reachable from this route, used by the quick-jump search. */
    keywords: string[];
    /** Marks surfaces that need the isolated warning treatment. */
    tone?: 'default' | 'danger';
};

export type SettingsNavGroup = {
    id: string;
    label: string;
    items: SettingsNavItem[];
};

export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
    {
        id: 'generale',
        label: 'Generale',
        items: [
            {
                id: 'profilo',
                href: '/settings/profilo',
                label: 'Profilo',
                description: 'Nome medico e ambulatorio',
                keywords: ['nome medico', 'nome ambulatorio', 'intestazione ricette', 'profilo', 'account'],
            },
            {
                id: 'aspetto',
                href: '/settings/aspetto',
                label: 'Aspetto',
                description: 'Tema, movimento, accessibilità',
                keywords: ['tema', 'tema chiaro', 'tema scuro', 'riduci movimento', 'accessibilità', 'privacy mode', 'lettura'],
            },
            {
                id: 'ambulatori',
                href: '/settings/ambulatories',
                label: 'Ambulatori',
                description: 'Sedi e contesti clinici',
                keywords: ['sedi', 'ambulatori', 'reparti', 'sede predefinita', 'ambiente di test'],
            },
        ],
    },
    {
        id: 'sicurezza-dati',
        label: 'Sicurezza e Dati',
        items: [
            {
                id: 'accesso',
                href: '/settings/accesso',
                label: 'Accesso',
                description: 'Cambio PIN e sessione',
                keywords: ['pin', 'cambio pin', 'sblocco', 'sessione', 'sicurezza accesso'],
            },
            {
                id: 'backup',
                href: '/settings/backup',
                label: 'Backup e Ripristino',
                description: 'Schedulazione e restore',
                keywords: ['backup', 'ripristino', 'restore', 'schedulazione backup', 'export dati', 'archivio cifrato'],
            },
            {
                id: 'repertori',
                href: '/settings/repertori',
                label: 'Repertori',
                description: 'AIFA ed esenzioni',
                keywords: ['farmaci', 'aifa', 'esenzioni', 'repertori', 'import csv', 'database farmaci'],
            },
        ],
    },
    {
        id: 'ai',
        label: 'Intelligenza Artificiale',
        items: [
            {
                id: 'ai-modelli',
                href: '/settings/ai/modelli',
                label: 'Modelli e Hardware',
                description: 'Profilo hardware, modelli, Ollama',
                keywords: ['modelli ai', 'ollama', 'profilo hardware', 'download modelli', 'url provider', 'docker', 'test connessione', 'ocr', 'reasoning'],
            },
            {
                id: 'ai-funzioni',
                href: '/settings/ai/funzioni',
                label: 'Funzioni e Sicurezza',
                description: 'Kill-switch, budget, governance',
                keywords: ['kill switch', 'patient insight', 'document synthesis', 'smart import', 'budget insight', 'governance', 'parliament', 'rollout readiness'],
            },
        ],
    },
    {
        id: 'avanzate',
        label: 'Avanzate',
        items: [
            {
                id: 'diagnostica',
                href: '/settings/diagnostica',
                label: 'Diagnostica',
                description: 'Servizi, architettura, aggiornamenti',
                keywords: ['diagnostica', 'stato servizi', 'architettura', 'aggiornamenti', 'manutenzione', 'rete'],
            },
            {
                id: 'sviluppo',
                href: '/settings/sviluppo',
                label: 'Sviluppo',
                description: 'Dati demo e shell nativa',
                keywords: ['dati demo', 'dati dimostrativi', 'app nativa', 'shell macos', 'sviluppo'],
            },
            {
                id: 'zona-pericolo',
                href: '/settings/zona-pericolo',
                label: 'Zona Pericolo',
                description: 'Azioni irreversibili',
                keywords: ['reset onboarding', 'reset configurazione', 'zona pericolo', 'azioni irreversibili'],
                tone: 'danger',
            },
        ],
    },
];

export type SettingsSearchMatch = {
    item: SettingsNavItem;
    groupLabel: string;
    /** The label or keyword that matched the query. */
    matchedLabel: string;
    score: number;
};

function normalize(value: string): string {
    return value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

// Lightweight fuzzy match: exact substring scores highest, otherwise the query
// characters must appear in order (subsequence) with a density-based score.
function fuzzyScore(query: string, candidate: string): number {
    if (!query) return 0;
    const q = normalize(query);
    const c = normalize(candidate);
    if (!q.trim()) return 0;

    const substringIndex = c.indexOf(q);
    if (substringIndex >= 0) {
        // Earlier and tighter matches first.
        return 100 - Math.min(substringIndex, 40) - Math.min(c.length - q.length, 30) / 3;
    }

    let ci = 0;
    let matched = 0;
    let firstIndex = -1;
    for (const ch of q) {
        if (ch === ' ') continue;
        const found = c.indexOf(ch, ci);
        if (found === -1) return 0;
        if (firstIndex === -1) firstIndex = found;
        matched += 1;
        ci = found + 1;
    }
    if (matched === 0) return 0;
    const span = ci - firstIndex;
    const density = matched / Math.max(span, 1);
    return Math.max(1, Math.round(40 * density) - Math.min(firstIndex, 20));
}

export function searchSettingsNav(query: string, limit = 8): SettingsSearchMatch[] {
    const trimmed = query.trim();
    const matches: SettingsSearchMatch[] = [];

    for (const group of SETTINGS_NAV_GROUPS) {
        for (const item of group.items) {
            if (!trimmed) {
                matches.push({ item, groupLabel: group.label, matchedLabel: item.description, score: 0 });
                continue;
            }

            let best = 0;
            let matchedLabel = item.description;
            const labelScore = fuzzyScore(trimmed, item.label) * 1.2;
            if (labelScore > best) {
                best = labelScore;
                matchedLabel = item.description;
            }
            for (const keyword of item.keywords) {
                const keywordScore = fuzzyScore(trimmed, keyword);
                if (keywordScore > best) {
                    best = keywordScore;
                    matchedLabel = keyword;
                }
            }
            if (best > 0) {
                matches.push({ item, groupLabel: group.label, matchedLabel, score: best });
            }
        }
    }

    if (trimmed) {
        matches.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label));
    }
    return matches.slice(0, limit);
}
