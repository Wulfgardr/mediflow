/* @Codex */
import { FileText } from 'lucide-react';
import { LumeFilo } from '@/components/ui/lume-filo';

interface DocumentReferenceChipProps {
    references: string[];
}

/* @Codex */
export function DocumentReferenceChip({ references }: DocumentReferenceChipProps) {
    if (references.length === 0) return null;

    return (
        <div className="relative mt-3 min-w-0 pl-5">
            <LumeFilo variant="connettore" fill={100} className="absolute left-0 top-0 h-4 w-5" />
            <div className="flex flex-wrap gap-2">
                {references.map((reference) => (
                    <span
                        key={reference}
                        className="inline-flex max-w-full items-center gap-1 break-all rounded-full bg-[color:var(--lume-surface-field)] px-3 py-1 text-[11px] font-medium text-[color:var(--lume-ink-muted)]"
                    >
                        <FileText className="h-3 w-3 shrink-0" />
                        {reference}
                    </span>
                ))}
            </div>
        </div>
    );
}
