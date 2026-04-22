'use client';

/* @Codex */
import ReactMarkdown from 'react-markdown';

import { isClinicalRichTextHtml, sanitizeClinicalRichTextHtml } from '@/lib/clinical-rich-text';
import { cn } from '@/lib/utils';

interface ClinicalRichTextContentProps {
    className?: string;
    content: string;
}

export function ClinicalRichTextContent({ className, content }: ClinicalRichTextContentProps) {
    /* @Codex */
    if (isClinicalRichTextHtml(content)) {
        return (
            <div
                className={cn('clinical-rich-text', className)}
                dangerouslySetInnerHTML={{ __html: sanitizeClinicalRichTextHtml(content) }}
            />
        );
    }

    return (
        <div className={cn('clinical-rich-text', className)}>
            <ReactMarkdown>{content}</ReactMarkdown>
        </div>
    );
}
