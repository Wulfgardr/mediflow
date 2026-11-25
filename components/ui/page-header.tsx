import type { ReactNode } from 'react';

import surface from '@/components/record-surface.module.css';

export function PageHeader({ title, meta, details, actions }: { title: ReactNode; meta?: ReactNode; details?: ReactNode; actions?: ReactNode }) {
    return (
        <header className={surface.pageHeader} data-page-frame="">
            <div className={surface.pageHeading}>
                <h1 className={surface.pageTitle}>{title}</h1>
                {meta == null ? null : <p className={surface.pageMeta}>{meta}</p>}
                {details}
            </div>
            {actions ? <div className={surface.pageActions} data-command-bar="testata">{actions}</div> : null}
        </header>
    );
}
