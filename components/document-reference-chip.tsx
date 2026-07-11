/* @Codex */
import { FileText } from 'lucide-react';

interface DocumentReferenceChipProps {
    references: string[];
}

/* @Codex */
export function DocumentReferenceChip({ references }: DocumentReferenceChipProps) {
    if (references.length === 0) return null;

    return (
        <div className="mt-3 flex flex-wrap gap-2">
            {references.map((reference) => (
                <span
                    key={reference}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600"
                >
                    <FileText className="h-3 w-3" />
                    {reference}
                </span>
            ))}
        </div>
    );
}
