'use client';

import {useEffect,useRef,useState} from 'react';
import {PatientSheetActionsMenu} from './patient-sheet-actions-menu';
import {PatientProfileAccessAction} from './patient-profile-access-action';
import {IntelligentHostCheckupAction} from './intelligent-host-checkup-action';
import {Button} from './ui/button';
import styles from './patient-header.module.css';

type Props = {
    patientId: string;
    ambulatoryId: string | null;
    checkups: readonly {id:string;title:string;status?:string;version?:number}[];
    editHref: string;
    canShareFhirFile: boolean;
    onExportFhir: () => void;
    onShareFhir: () => void;
    onReportPdf: () => void;
};

export function PatientHeaderActions({patientId,ambulatoryId,checkups,...actions}:Props) {
    const [panel,setPanel]=useState<'assistant'|'checkup'|null>(null);
    const triggerRef=useRef<HTMLButtonElement>(null);
    const rootRef=useRef<HTMLDivElement>(null);
    useEffect(()=>{
        if(!panel)return;
        const current=rootRef.current?.querySelector<HTMLElement>('[role="dialog"]:not([hidden])');
        current?.focus();
        const closeOutside=(event:PointerEvent)=>{
            if(!rootRef.current?.contains(event.target as Node))setPanel(null);
        };
        document.addEventListener('pointerdown',closeOutside);
        return ()=>document.removeEventListener('pointerdown',closeOutside);
    },[panel]);
    const close=()=>{setPanel(null);triggerRef.current?.focus();};
    return <div ref={rootRef} className={styles.panels} onKeyDown={event=>{
        if(panel&&event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
    }}>
        <PatientSheetActionsMenu {...actions} triggerRef={triggerRef} onOpen={()=>setPanel(null)} leadingActions={[
            {label:'Accesso assistente',onSelect:()=>setPanel('assistant')},
            {label:'Gestisci checkup',onSelect:()=>setPanel('checkup')},
        ]}/>
        <div role="dialog" aria-label="Accesso assistente" tabIndex={-1} hidden={panel!=='assistant'} className={`mf-popover ${styles.panel} print:hidden`}>
            <h2 className={styles.panelTitle}>Accesso assistente</h2>
            <PatientProfileAccessAction patientId={patientId} ambulatoryId={ambulatoryId} embedded/>
            <Button variant="text" onClick={close}>Chiudi</Button>
        </div>
        <div role="dialog" aria-label="Gestisci checkup" tabIndex={-1} hidden={panel!=='checkup'} className={`mf-popover ${styles.panel} print:hidden`}>
            <h2 className={styles.panelTitle}>Gestisci checkup</h2>
            <IntelligentHostCheckupAction patientId={patientId} ambulatoryId={ambulatoryId} checkups={checkups} embedded/>
            <Button variant="text" onClick={close}>Chiudi</Button>
        </div>
    </div>;
}
