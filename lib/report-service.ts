import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
/* @Codex */
import { Patient, ClinicalEntry, Therapy, Observation } from './db';

// Extending jsPDF type to include lastAutoTable (added by autotable plugin)
export interface JsPDFWithAutoTable extends jsPDF {
    lastAutoTable: { finalY: number };
}

export const generatePatientReport = (
    patient: Patient,
    entries: ClinicalEntry[],
    lastScales: ClinicalEntry[],
    therapies: Therapy[] = [],
    /* @Codex */
    observations: Observation[] = []
) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;

    // --- STYLING CONSTANTS ---
    const COLORS = {
        primary: [66, 133, 244] as [number, number, number], // Blue
        secondary: [96, 125, 139] as [number, number, number], // Gray
        accent: [255, 152, 0] as [number, number, number], // Orange
        text: [40, 50, 80] as [number, number, number],
        lightText: [100, 100, 100] as [number, number, number]
    };

    // --- HEADER ---
    // Top bar
    doc.setFillColor(...COLORS.primary);
    doc.rect(0, 0, pageWidth, 5, 'F');

    doc.setFontSize(22);
    doc.setTextColor(...COLORS.text);
    doc.setFont("helvetica", "bold");
    doc.text(`Scheda Clinica`, 14, 20);

    doc.setFontSize(14);
    doc.setTextColor(...COLORS.lightText);
    doc.setFont("helvetica", "normal");
    doc.text(`${patient.lastName} ${patient.firstName}`, 14, 27);

    doc.setFontSize(8);
    doc.text(`Generato il: ${new Date().toLocaleDateString('it-IT')} alle ${new Date().toLocaleTimeString('it-IT')}`, pageWidth - 14, 20, { align: 'right' });

    doc.setDrawColor(220, 220, 220);
    doc.line(14, 32, pageWidth - 14, 32);

    // --- PATIENT INFO GRID ---
    let currentY = 40;

    /* @Codex */
    const advanceSection = () => {
        if (currentY > 250) {
            doc.addPage();
            currentY = 20;
        }
    };

    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);

    const leftColX = 14;
    const rightColX = pageWidth / 2 + 10;
    const lineHeight = 6;

    // Row 1
    doc.setFont("helvetica", "bold"); doc.text("Codice Fiscale:", leftColX, currentY);
    doc.setFont("helvetica", "normal"); doc.text(patient.taxCode, leftColX + 30, currentY);

    doc.setFont("helvetica", "bold"); doc.text("Telefono:", rightColX, currentY);
    doc.setFont("helvetica", "normal"); doc.text(patient.phone || 'N/D', rightColX + 25, currentY);

    currentY += lineHeight;

    // Row 2
    doc.setFont("helvetica", "bold"); doc.text("Data di Nascita:", leftColX, currentY);
    doc.setFont("helvetica", "normal"); doc.text(patient.birthDate ? new Date(patient.birthDate).toLocaleDateString('it-IT') : 'N/D', leftColX + 30, currentY);

    doc.setFont("helvetica", "bold"); doc.text("Caregiver:", rightColX, currentY);
    doc.setFont("helvetica", "normal"); doc.text(patient.caregiver || 'N/D', rightColX + 25, currentY);

    currentY += lineHeight;

    // Row 3
    doc.setFont("helvetica", "bold"); doc.text("Indirizzo:", leftColX, currentY);
    doc.setFont("helvetica", "normal"); doc.text(patient.address || 'N/D', leftColX + 30, currentY);

    doc.setFont("helvetica", "bold"); doc.text("Profilo:", rightColX, currentY);
    doc.setFont("helvetica", "normal");
    const profileLabel = patient.monitoringProfile === 'taken_in_charge' ? 'Presa in Carico' : 'Estemporanea';
    doc.text(profileLabel, rightColX + 25, currentY);

    currentY += lineHeight + 4;

    // Notes Section
    if (patient.notes) {
        /* @Codex */
        const noteLines = doc.splitTextToSize(patient.notes, pageWidth - 36);
        /* @Codex */
        const noteHeight = Math.max(16, 10 + (noteLines.length * 5));

        doc.setFillColor(255, 252, 235); // Light yellow bg
        doc.roundedRect(14, currentY, pageWidth - 28, noteHeight, 2, 2, 'F');

        doc.setFont("helvetica", "bold");
        doc.setTextColor(...COLORS.accent);
        doc.text("Note Globali:", 18, currentY + 6);

        doc.setFont("helvetica", "normal");
        doc.setTextColor(60, 60, 60);
        doc.text(noteLines, 18, currentY + 11);

        currentY += noteHeight + 6;
    } else {
        currentY += 5;
    }

    // --- ICD DIAGNOSES ---
    /* @Codex */
    const diagnoses = patient.diagnoses || [];

    advanceSection();
    doc.setFontSize(12);
    doc.setTextColor(...COLORS.primary);
    doc.setFont("helvetica", "bold");
    doc.text("Diagnosi ICD", 14, currentY);
    currentY += 2;

    if (diagnoses.length > 0) {
        const diagnosisData = diagnoses.map((diagnosis) => [
            diagnosis.code || '-',
            diagnosis.description || '-',
            diagnosis.system || '-',
            diagnosis.date ? new Date(diagnosis.date).toLocaleDateString('it-IT') : 'N/D'
        ]);

        autoTable(doc, {
            startY: currentY + 4,
            head: [['Codice', 'Descrizione', 'Sistema', 'Data']],
            body: diagnosisData,
            theme: 'striped',
            headStyles: { fillColor: COLORS.secondary, fontStyle: 'bold' },
            styles: { fontSize: 8, cellPadding: 3 },
            columnStyles: {
                1: { cellWidth: 70 },
                2: { cellWidth: 22 },
                3: { cellWidth: 24 }
            },
            margin: { left: 14, right: 14 }
        });

        currentY = (doc as unknown as JsPDFWithAutoTable).lastAutoTable.finalY + 8;
    } else {
        doc.setFontSize(10);
        doc.setFont("helvetica", "italic");
        doc.setTextColor(...COLORS.lightText);
        doc.text("Nessuna diagnosi ICD presente.", 14, currentY + 6);
        currentY += 12;
    }

    // --- ACTIVE THERAPY ---
    /* @Codex */
    const activeTherapies = therapies.filter(t => t.status === 'active');

    advanceSection();
    doc.setFontSize(12);
    doc.setTextColor(...COLORS.primary);
    doc.setFont("helvetica", "bold");
    doc.text("Terapia Farmacologica Attiva", 14, currentY);
    currentY += 2;

    if (activeTherapies.length > 0) {
        const therapyData = activeTherapies.map(t => [
            t.drugName,
            t.activePrinciple || '-',
            t.dosage,
            t.motivation || '-'
        ]);

        autoTable(doc, {
            startY: currentY + 4,
            head: [['Farmaco', 'Principio Attivo', 'Posologia', 'Note/Motivazione']],
            body: therapyData,
            theme: 'grid',
            headStyles: { fillColor: COLORS.secondary, fontStyle: 'bold' },
            styles: { fontSize: 9, cellPadding: 3 },
            columnStyles: {
                0: { fontStyle: 'bold', cellWidth: 40 },
                2: { cellWidth: 50 },
                3: { cellWidth: 'auto' } // Wrap text in motivation
            },
            margin: { left: 14, right: 14 }
        });

        currentY = (doc as unknown as JsPDFWithAutoTable).lastAutoTable.finalY + 8;
    } else {
        doc.setFontSize(10);
        doc.setFont("helvetica", "italic");
        doc.setTextColor(...COLORS.lightText);
        doc.text("Nessuna terapia attiva registrata.", 14, currentY + 6);
        currentY += 12;
    }

    // --- CLINICAL DIARY ---
    advanceSection();
    doc.setFontSize(12);
    doc.setTextColor(...COLORS.primary);
    doc.setFont("helvetica", "bold");
    doc.text("Diario Clinico (Ultime Attività)", 14, currentY);
    currentY += 2;

    /* @Codex */
    const diaryEntries = entries.filter((entry) => entry.type !== 'scale' && !entry.deletedAt).slice(0, 30);

    if (diaryEntries.length > 0) {
        const diaryData = diaryEntries.map(e => [
            new Date(e.date).toLocaleDateString('it-IT'),
            e.type.toUpperCase(),
            e.content
        ]);

        autoTable(doc, {
            startY: currentY + 4,
            head: [['Data', 'Tipo', 'Contenuto']],
            body: diaryData,
            theme: 'striped',
            headStyles: { fillColor: COLORS.primary },
            styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' }, // Enabled text wrapping
            columnStyles: {
                0: { cellWidth: 25 },
                1: { cellWidth: 25, fontStyle: 'bold' },
                2: { cellWidth: 'auto' }
            },
            margin: { left: 14, right: 14 }
        });

        currentY = (doc as unknown as JsPDFWithAutoTable).lastAutoTable.finalY + 8;
    } else {
        doc.setFontSize(10);
        doc.setFont("helvetica", "italic");
        doc.setTextColor(...COLORS.lightText);
        doc.text("Nessun elemento nel diario clinico.", 14, currentY + 6);
        currentY += 12;
    }

    // --- LAB OBSERVATIONS (LOINC + UCUM) ---
    advanceSection();
    doc.setFontSize(12);
    doc.setTextColor(...COLORS.primary);
    doc.setFont("helvetica", "bold");
    doc.text("Osservazioni Codificate (LOINC + UCUM)", 14, currentY);
    currentY += 2;

    /* @Codex */
    if (observations.length > 0) {
        const observationData = observations.map((observation) => [
            new Date(observation.observedAt).toLocaleDateString('it-IT'),
            `${observation.codeSystem} ${observation.code}`,
            observation.display || '-',
            `${observation.value} ${observation.unitCode}`,
            observation.notes || '-'
        ]);

        autoTable(doc, {
            startY: currentY + 4,
            head: [['Data', 'Codice LOINC', 'Parametro', 'Valore (UCUM)', 'Note']],
            body: observationData,
            theme: 'plain',
            headStyles: { fillColor: [240, 240, 240], textColor: [50, 50, 50] },
            styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
            columnStyles: {
                1: { cellWidth: 35 },
                2: { cellWidth: 50 },
                4: { cellWidth: 'auto' }
            },
            margin: { left: 14, right: 14 }
        });

        currentY = (doc as unknown as JsPDFWithAutoTable).lastAutoTable.finalY + 8;
    } else {
        doc.setFontSize(10);
        doc.setFont("helvetica", "italic");
        doc.setTextColor(...COLORS.lightText);
        doc.text("Nessuna osservazione codificata disponibile.", 14, currentY + 6);
        currentY += 12;
    }

    // --- RECENT SCALES ---
    // Only show if there's space, otherwise new page
    if (lastScales.length > 0) {
        advanceSection();

        doc.setFontSize(12);
        doc.setTextColor(...COLORS.primary);
        doc.setFont("helvetica", "bold");
        doc.text("Valutazioni Recenti (Scale)", 14, currentY);
        currentY += 2;

        const scaleData = lastScales.map(s => [
            new Date(s.date).toLocaleDateString('it-IT'),
            s.metadata?.title || 'Scala',
            s.metadata?.score || '-',
            s.metadata?.interpretation || '-'
        ]);

        autoTable(doc, {
            startY: currentY + 4,
            head: [['Data', 'Scala', 'Score', 'Interpretazione']],
            body: scaleData,
            theme: 'plain',
            headStyles: { fillColor: [240, 240, 240], textColor: [50, 50, 50] },
            styles: { fontSize: 9, cellPadding: 2 },
            margin: { left: 14, right: 14 },
            // Add light border
            tableLineColor: [200, 200, 200],
            tableLineWidth: 0.1,
        });
    }

    // Save
    const filename = `Report_${patient.lastName}_${patient.firstName}_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(filename);
};
