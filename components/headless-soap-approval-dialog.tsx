'use client';

/* @Codex */
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import type { ClinicianSoapEntryFieldSetV1 } from '@/lib/headless/clinician-soap-entry-field-set';

export interface HeadlessSoapApprovalDialogProps {
    open: boolean;
    fieldSet: ClinicianSoapEntryFieldSetV1;
    status: 'ready' | 'checking' | 'denied';
    onExplicitGesture: () => void;
    onClose: () => void;
}

export function HeadlessSoapApprovalDialog({
    open,
    fieldSet,
    status,
    onExplicitGesture,
    onClose,
}: HeadlessSoapApprovalDialogProps) {
    const statusMessage = status === 'checking'
        ? 'Verifica crittografica in corso.'
        : status === 'denied'
            ? 'La proposta non è più disponibile. Chiudi questa finestra e riparti dalla review.'
            : 'Controlla integralmente la voce prima di continuare.';

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Approva voce clinica SOAP"
            subtitle="Review dedicata del contenuto da registrare"
            accent={status === 'denied' ? 'critical' : 'primary'}
            maxWidthClassName="max-w-3xl"
            footer={(
                <Button
                    type="button"
                    disabled={status !== 'ready'}
                    onClick={onExplicitGesture}
                >
                    Continua con PIN
                </Button>
            )}
        >
            <div className="space-y-5" aria-busy={status === 'checking'}>
                <p
                    className={status === 'denied' ? 'mf-alert mf-alert-critical' : 'mf-alert mf-alert-info'}
                    role={status === 'denied' ? 'alert' : 'status'}
                >
                    {statusMessage}
                </p>

                <dl className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-[color:var(--lume-border)] p-3">
                        <dt className="mf-field-label">Tipo</dt>
                        <dd className="break-words text-sm text-[color:var(--lume-ink)]">{fieldSet.type}</dd>
                    </div>
                    <div className="rounded-2xl border border-[color:var(--lume-border)] p-3">
                        <dt className="mf-field-label">Titolo</dt>
                        <dd className="break-words text-sm text-[color:var(--lume-ink)]">{fieldSet.title}</dd>
                    </div>
                    <div className="rounded-2xl border border-[color:var(--lume-border)] p-3">
                        <dt className="mf-field-label">Data</dt>
                        <dd className="break-words font-mono text-xs text-[color:var(--lume-ink)]">
                            <time dateTime={fieldSet.date}>{fieldSet.date}</time>
                        </dd>
                    </div>
                    <div className="rounded-2xl border border-[color:var(--lume-border)] p-3">
                        <dt className="mf-field-label">Contesto</dt>
                        <dd className="break-words text-sm text-[color:var(--lume-ink)]">{fieldSet.setting}</dd>
                    </div>
                </dl>

                <section aria-labelledby="headless-soap-content-title">
                    <h4
                        id="headless-soap-content-title"
                        className="mb-2 text-sm font-semibold text-[color:var(--lume-ink)]"
                    >
                        Contenuto SOAP completo
                    </h4>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-[color:var(--lume-border)] bg-[color:var(--lume-surface-field)] p-4 text-sm text-[color:var(--lume-ink)]">
                        {fieldSet.content}
                    </pre>
                </section>

                <section aria-labelledby="headless-soap-integrity-title">
                    <h4
                        id="headless-soap-integrity-title"
                        className="mb-2 text-sm font-semibold text-[color:var(--lume-ink)]"
                    >
                        Integrità
                    </h4>
                    <dl className="space-y-2 rounded-2xl border border-[color:var(--lume-border)] p-4 text-xs">
                        <div>
                            <dt className="font-semibold text-[color:var(--lume-ink-muted)]">Metadata codec</dt>
                            <dd className="break-all font-mono text-[color:var(--lume-ink)]">{fieldSet.metadata.codec}</dd>
                        </div>
                        <div>
                            <dt className="font-semibold text-[color:var(--lume-ink-muted)]">Metadata SHA-256</dt>
                            <dd className="break-all font-mono text-[color:var(--lume-ink)]">{fieldSet.metadata.sha256.hex}</dd>
                        </div>
                        <div>
                            <dt className="font-semibold text-[color:var(--lume-ink-muted)]">Payload SHA-256</dt>
                            <dd className="break-all font-mono text-[color:var(--lume-ink)]">{fieldSet.payloadDigest.sha256.hex}</dd>
                        </div>
                    </dl>
                </section>

                <p className="text-sm font-medium text-[color:var(--lume-ink-muted)]">Nessun allegato</p>
            </div>
        </Modal>
    );
}
