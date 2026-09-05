'use client';

/* @Codex */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
    createClinicianSoapExplicitGestureOwner,
    scheduleClinicianSoapExplicitGesturePreparation,
} from '../lib/headless/clinician-soap-explicit-gesture';
import {
    HeadlessSoapApprovalDialog,
    type HeadlessSoapApprovalDialogProps,
} from './headless-soap-approval-dialog';
import { useSecurity } from './security-provider';

type ApprovalFieldSet = HeadlessSoapApprovalDialogProps['fieldSet'];
type ApprovalStatus = HeadlessSoapApprovalDialogProps['status'];
type ApprovalView = Readonly<{ payloadDigest: string | null; status: ApprovalStatus }>;
type ExplicitGestureOwner = ReturnType<typeof createClinicianSoapExplicitGestureOwner>;
type RuntimeOperation = (...values: unknown[]) => unknown;
type CoordinatorPhase = 'closed' | 'preparing' | 'ready' | 'checking' | 'terminal';

export interface HeadlessSoapApprovalProps {
    open: boolean;
    fieldSet: ApprovalFieldSet;
    onClose: () => void;
    onPinRequired: () => void;
}

function invoke(operation: unknown, values: readonly unknown[]): unknown {
    return Reflect.apply(operation as RuntimeOperation, undefined, [...values]);
}

export function HeadlessSoapApproval({
    open,
    fieldSet,
    onClose,
    onPinRequired,
}: HeadlessSoapApprovalProps) {
    const { sealClinicianSoapEntry, reopenClinicianSoapEntry } = useSecurity();
    const payloadDigest = fieldSet.payloadDigest.sha256.hex;
    const sealOperationRef = useRef<unknown>(sealClinicianSoapEntry);
    const reopenOperationRef = useRef<unknown>(reopenClinicianSoapEntry);
    const onCloseRef = useRef(onClose);
    const onPinRequiredRef = useRef(onPinRequired);
    const ownerRef = useRef<ExplicitGestureOwner | null>(null);
    const preparedFieldSetRef = useRef<ApprovalFieldSet | null>(null);
    const lifecycleRef = useRef(0);
    const phaseRef = useRef<CoordinatorPhase>('closed');
    const [view, setView] = useState<ApprovalView>({ payloadDigest: null, status: 'checking' });

    useLayoutEffect(() => {
        sealOperationRef.current = sealClinicianSoapEntry;
        reopenOperationRef.current = reopenClinicianSoapEntry;
        onCloseRef.current = onClose;
        onPinRequiredRef.current = onPinRequired;
    }, [onClose, onPinRequired, reopenClinicianSoapEntry, sealClinicianSoapEntry]);

    useLayoutEffect(() => {
        const lifecycle = ++lifecycleRef.current;
        const previousOwner = ownerRef.current;
        ownerRef.current = null;
        preparedFieldSetRef.current = null;
        previousOwner?.close();

        if (!open) {
            phaseRef.current = 'closed';
            queueMicrotask(() => {
                if (lifecycleRef.current === lifecycle && phaseRef.current === 'closed') {
                    setView({ payloadDigest: null, status: 'checking' });
                }
            });
            return;
        }

        phaseRef.current = 'preparing';
        const owner = createClinicianSoapExplicitGestureOwner({
            seal: (candidate: unknown) => invoke(sealOperationRef.current, [candidate]),
            reopen: (bundle: unknown, expectedFieldSet: unknown) =>
                invoke(reopenOperationRef.current, [bundle, expectedFieldSet]),
        });
        ownerRef.current = owner;
        preparedFieldSetRef.current = fieldSet;
        const cancelPreparation = scheduleClinicianSoapExplicitGesturePreparation(() => {
            if (lifecycleRef.current !== lifecycle || ownerRef.current !== owner
                || phaseRef.current !== 'preparing') return;
            setView({ payloadDigest, status: 'checking' });
            void owner.prepare(fieldSet).then((result) => {
                if (lifecycleRef.current !== lifecycle || ownerRef.current !== owner
                    || phaseRef.current !== 'preparing') return;
                if (result.status === 'ready') {
                    phaseRef.current = 'ready';
                    setView({ payloadDigest, status: 'ready' });
                    return;
                }
                phaseRef.current = 'terminal';
                ownerRef.current = null;
                preparedFieldSetRef.current = null;
                owner.close();
                setView({ payloadDigest, status: 'denied' });
            }).catch(() => {
                if (lifecycleRef.current !== lifecycle || ownerRef.current !== owner
                    || phaseRef.current !== 'preparing') return;
                phaseRef.current = 'terminal';
                ownerRef.current = null;
                preparedFieldSetRef.current = null;
                owner.close();
                setView({ payloadDigest, status: 'denied' });
            });
        });

        return () => {
            cancelPreparation();
            if (ownerRef.current === owner) ownerRef.current = null;
            if (preparedFieldSetRef.current === fieldSet) preparedFieldSetRef.current = null;
            if (phaseRef.current !== 'terminal') phaseRef.current = 'closed';
            owner.close();
        };
    }, [fieldSet, open, payloadDigest]);

    const handleExplicitGesture = useCallback(() => {
        const owner = ownerRef.current;
        const lifecycle = lifecycleRef.current;
        if (!open || !owner || preparedFieldSetRef.current !== fieldSet || phaseRef.current !== 'ready') return;
        phaseRef.current = 'checking';
        setView({ payloadDigest, status: 'checking' });

        void owner.consumeExplicitGesture().then((result) => {
            if (lifecycleRef.current !== lifecycle || ownerRef.current !== owner
                || phaseRef.current !== 'checking') return;
            phaseRef.current = 'terminal';
            ownerRef.current = null;
            preparedFieldSetRef.current = null;
            owner.close();
            if (result.status === 'pin_required') {
                setView({ payloadDigest: null, status: 'checking' });
                onPinRequiredRef.current();
                return;
            }
            setView({ payloadDigest, status: 'denied' });
        }).catch(() => {
            if (lifecycleRef.current !== lifecycle || ownerRef.current !== owner
                || phaseRef.current !== 'checking') return;
            phaseRef.current = 'terminal';
            ownerRef.current = null;
            preparedFieldSetRef.current = null;
            owner.close();
            setView({ payloadDigest, status: 'denied' });
        });
    }, [fieldSet, open, payloadDigest]);

    const handleClose = useCallback(() => {
        ++lifecycleRef.current;
        const owner = ownerRef.current;
        ownerRef.current = null;
        preparedFieldSetRef.current = null;
        phaseRef.current = 'closed';
        owner?.close();
        setView({ payloadDigest: null, status: 'denied' });
        onCloseRef.current();
    }, []);

    const dialogStatus: ApprovalStatus = view.payloadDigest === payloadDigest ? view.status : 'checking';

    return (
        <HeadlessSoapApprovalDialog
            open={open}
            fieldSet={fieldSet}
            status={dialogStatus}
            onExplicitGesture={handleExplicitGesture}
            onClose={handleClose}
        />
    );
}
