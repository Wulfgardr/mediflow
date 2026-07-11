import { sql, type SQL } from 'drizzle-orm';
import { drugs } from '@/lib/schema';

/* @Codex */
function normalizeDrugSearchTokens(value: string): string[] {
    return [...new Set(value.normalize('NFKC').trim().split(/\s+/).filter(Boolean))];
}

/* @Codex */
function escapeDrugSearchLikeToken(value: string): string {
    return value.replace(/[\\%_]/g, '\\$&');
}

/* @Codex */
export function buildDrugSearchPredicate(value: string): SQL {
    const escapedTokens = JSON.stringify(
        normalizeDrugSearchTokens(value).map(escapeDrugSearchLikeToken),
    );

    return sql`
        NOT EXISTS (
            SELECT 1
            FROM json_each(${escapedTokens}) AS search_token
            WHERE NOT (
                coalesce(${drugs.name}, '') LIKE '%' || search_token.value || '%' ESCAPE ${'\\'}
                OR coalesce(${drugs.activePrinciple}, '') LIKE '%' || search_token.value || '%' ESCAPE ${'\\'}
                OR coalesce(${drugs.packaging}, '') LIKE '%' || search_token.value || '%' ESCAPE ${'\\'}
                OR coalesce(${drugs.aic}, '') LIKE '%' || search_token.value || '%' ESCAPE ${'\\'}
            )
        )
    `;
}
