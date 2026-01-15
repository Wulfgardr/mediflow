import { ScaleDefinition } from '@/components/scale-engine';

export const SCALES: Record<string, ScaleDefinition> = {
    // === FUNZIONALI / MOTORIE ===
    'tinetti': {
        id: 'tinetti',
        title: 'Scala Tinetti (Balance & Gait)',
        description: 'Valutazione del rischio di caduta (Equilibrio + Andatura). Max 28 punti.',
        questions: [
            // EQUILIBRIO (Max 16)
            { id: 'b1', text: 'Equilibrio seduto', type: 'choice', options: [{ label: '0. Si inclina o scivola', value: 0 }, { label: '1. Fermo e sicuro', value: 1 }] },
            { id: 'b2', text: 'Alzarsi dalla sedia', type: 'choice', options: [{ label: '0. Impossibile senza aiuto', value: 0 }, { label: '1. Usa le braccia', value: 1 }, { label: '2. Senza usare le braccia', value: 2 }] },
            { id: 'b3', text: 'Tentativi di alzarsi', type: 'choice', options: [{ label: '0. Impossibile senza aiuto', value: 0 }, { label: '1. >1 tentativo', value: 1 }, { label: '2. Riesce al 1° tentativo', value: 2 }] },
            { id: 'b4', text: 'Equilibrio immediato in piedi (primi 5 sec)', type: 'choice', options: [{ label: '0. Instabile', value: 0 }, { label: '1. Stabile (base larga/ausilio)', value: 1 }, { label: '2. Stabile (base stretta)', value: 2 }] },
            { id: 'b5', text: 'Equilibrio in piedi prolungato', type: 'choice', options: [{ label: '0. Instabile', value: 0 }, { label: '1. Stabile (base larga)', value: 1 }, { label: '2. Stabile (piedi uniti)', value: 2 }] },
            { id: 'b6', text: 'Nudging (spinta leggera sterno)', type: 'choice', options: [{ label: '0. Cade', value: 0 }, { label: '1. Vacilla', value: 1 }, { label: '2. Stabile', value: 2 }] },
            { id: 'b7', text: 'Occhi chiusi (in piedi)', type: 'choice', options: [{ label: '0. Instabile', value: 0 }, { label: '1. Stabile', value: 1 }] },
            { id: 'b8', text: 'Giro di 360 gradi', type: 'choice', options: [{ label: '0. Passi discontinui/instabile', value: 0 }, { label: '1. Continuo/Stabile', value: 1 }] },
            { id: 'b9', text: 'Sedersi', type: 'choice', options: [{ label: '0. Insicuro', value: 0 }, { label: '1. Usa braccia', value: 1 }, { label: '2. Sicuro/Fluido', value: 2 }] },
            // ANDATURA (Max 12)
            { id: 'g1', text: 'Inizio andatura', type: 'choice', options: [{ label: '0. Esitazione', value: 0 }, { label: '1. Nessuna esitazione', value: 1 }] },
            { id: 'g2', text: 'Lunghezza/Altezza Passo (DX)', type: 'choice', options: [{ label: '0. Non supera SX', value: 0 }, { label: '1. Supera SX', value: 1 }] },
            { id: 'g3', text: 'Lunghezza/Altezza Passo (SX)', type: 'choice', options: [{ label: '0. Non supera DX', value: 0 }, { label: '1. Supera DX', value: 1 }] },
            { id: 'g4', text: 'Simmetria del passo', type: 'choice', options: [{ label: '0. Asimmetrico', value: 0 }, { label: '1. Simmetrico', value: 1 }] },
            { id: 'g5', text: 'Continuità del passo', type: 'choice', options: [{ label: '0. Discontinuo', value: 0 }, { label: '1. Continuo', value: 1 }] },
            { id: 'g6', text: 'Traiettoria', type: 'choice', options: [{ label: '0. Deviazione marcata', value: 0 }, { label: '1. Lieve/Ausilio', value: 1 }, { label: '2. Diritta senza ausilio', value: 2 }] },
            { id: 'g7', text: 'Tronco', type: 'choice', options: [{ label: '0. Oscillazione/Flessione', value: 0 }, { label: '1. Stabile', value: 1 }] },
            { id: 'g8', text: 'Cammino (Talloni)', type: 'choice', options: [{ label: '0. Distanziati', value: 0 }, { label: '1. Quasi si toccano', value: 1 }] }
        ],
        scoringLogic: (answers) => Object.values(answers).reduce<number>((a, b) => a + (Number(b) || 0), 0),
        interpretation: (score) => {
            if (score <= 18) return 'ALTO Rischio di Caduta (< 19)';
            if (score <= 24) return 'MEDIO Rischio di Caduta (19-24)';
            return 'BASSO Rischio di Caduta (> 24)';
        }
    },

    'adl': {
        id: 'adl',
        title: 'ADL (Indice di Katz)',
        description: 'Autonomia nelle attività della vita quotidiana (1 = Autonomo, 0 = Dipendente).',
        questions: [
            { id: 'bath', text: 'Fare il bagno', type: 'choice', options: [{ label: '0. Dipendente', value: 0 }, { label: '1. Autonomo (senza supervisione)', value: 1 }] },
            { id: 'dress', text: 'Vestirsi', type: 'choice', options: [{ label: '0. Dipendente', value: 0 }, { label: '1. Autonomo (anche allacciare scarpe)', value: 1 }] },
            { id: 'toilet', text: 'Uso del Bagno', type: 'choice', options: [{ label: '0. Dipendente', value: 0 }, { label: '1. Autonomo (svestirsi, pulirsi, rivestirsi)', value: 1 }] },
            { id: 'transfer', text: 'Spostarsi', type: 'choice', options: [{ label: '0. Dipendente (aiuto per letto/sedia)', value: 0 }, { label: '1. Autonomo (letto-sedia)', value: 1 }] },
            { id: 'cont', text: 'Continenza', type: 'choice', options: [{ label: '0. Incontinente (sfinterale/urina)', value: 0 }, { label: '1. Continente', value: 1 }] },
            { id: 'feed', text: 'Alimentarsi', type: 'choice', options: [{ label: '0. Dipendente (imboccato)', value: 0 }, { label: '1. Autonomo (porta cibo alla bocca)', value: 1 }] }
        ],
        scoringLogic: (answers) => Object.values(answers).reduce<number>((a, b) => a + (Number(b) || 0), 0),
        interpretation: (score) => {
            if (score === 6) return 'Autonomia Conservata (6/6)';
            if (score >= 4) return 'Compromissione Lieve (4-5/6)';
            if (score >= 2) return 'Compromissione Moderata (2-3/6)';
            return 'Compromissione Grave (0-1/6)';
        }
    },

    'iadl': {
        id: 'iadl',
        title: 'IADL (Indice di Lawton)',
        description: 'Attività Strumentali della vita quotidiana (1 = F, 0 = NF). Nota: Storicamente 8 item per donne, 5 per uomini.',
        questions: [
            { id: 'q1', text: '1. Capace di usare il telefono', type: 'choice', options: [{ label: '0. No (non usa/non risponde)', value: 0 }, { label: '1. Si (chiama/risponde autonomamente)', value: 1 }] },
            { id: 'q2', text: '2. Fare acquisti', type: 'choice', options: [{ label: '0. No (incapace/accompagnato)', value: 0 }, { label: '1. Si (provvede autonomamente)', value: 1 }] },
            { id: 'q3', text: '3. Preparazione cibo', type: 'choice', options: [{ label: '0. No (non cucina/riscalda)', value: 0 }, { label: '1. Si (pianifica/prepara/serve)', value: 1 }] },
            { id: 'q4', text: '4. Governo della casa', type: 'choice', options: [{ label: '0. No (non fa nulla/aiuto)', value: 0 }, { label: '1. Si (mantiene casa/piccoli lavori)', value: 1 }] },
            { id: 'q5', text: '5. Bucato', type: 'choice', options: [{ label: '0. No (tutto da terzi)', value: 0 }, { label: '1. Si (lava/stira piccole cose)', value: 1 }] },
            { id: 'q6', text: '6. Mezzi di trasporto', type: 'choice', options: [{ label: '0. No (non viaggia/taxi accompagnato)', value: 0 }, { label: '1. Si (usa mezzi pubblici/guida)', value: 1 }] },
            { id: 'q7', text: '7. Assunzione farmaci', type: 'choice', options: [{ label: '0. No (incapace/preparati da altri)', value: 0 }, { label: '1. Si (responsabile per dosi/orari)', value: 1 }] },
            { id: 'q8', text: '8. Gestione finanze', type: 'choice', options: [{ label: '0. No (incapace)', value: 0 }, { label: '1. Si (gestisce conto/spese)', value: 1 }] }
        ],
        scoringLogic: (answers) => Object.values(answers).reduce<number>((a, b) => a + (Number(b) || 0), 0),
        interpretation: (score) => `Punteggio totale: ${score}/8. (Minore è il punteggio, maggiore è la dipendenza strumentale).`
    },

    'mmse': {
        id: 'mmse',
        title: 'MMSE (Folstein)',
        description: 'Mini-Mental State Examination. Somministrazione standardizzata.',
        questions: [
            // ORIENTAMENTO TEMPORALE (5)
            { id: 'ot1', text: 'In che anno siamo?', type: 'choice', options: [{ label: 'Erra', value: 0 }, { label: 'Corretto', value: 1 }] },
            { id: 'ot2', text: 'In che stagione?', type: 'choice', options: [{ label: 'Erra', value: 0 }, { label: 'Corretto', value: 1 }] },
            { id: 'ot3', text: 'In che mese?', type: 'choice', options: [{ label: 'Erra', value: 0 }, { label: 'Corretto', value: 1 }] },
            { id: 'ot4', text: 'In che giorno del mese?', type: 'choice', options: [{ label: 'Erra', value: 0 }, { label: 'Corretto', value: 1 }] },
            { id: 'ot5', text: 'In che giorno della settimana?', type: 'choice', options: [{ label: 'Erra', value: 0 }, { label: 'Corretto', value: 1 }] },
            // ORIENTAMENTO SPAZIALE (5)
            { id: 'os1', text: 'In che stato siamo?', type: 'choice', options: [{ label: 'Erra', value: 0 }, { label: 'Corretto', value: 1 }] },
            { id: 'os2', text: 'In che regione?', type: 'choice', options: [{ label: 'Erra', value: 0 }, { label: 'Corretto', value: 1 }] },
            { id: 'os3', text: 'In che città?', type: 'choice', options: [{ label: 'Erra', value: 0 }, { label: 'Corretto', value: 1 }] },
            { id: 'os4', text: 'In che luogo siamo (ospedale/casa/studio)?', type: 'choice', options: [{ label: 'Erra', value: 0 }, { label: 'Corretto', value: 1 }] },
            { id: 'os5', text: 'A che piano siamo?', type: 'choice', options: [{ label: 'Erra', value: 0 }, { label: 'Corretto', value: 1 }] },
            // REGISTRAZIONE (3)
            { id: 'reg1', text: 'Ripete "PALLA"?', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì', value: 1 }] },
            { id: 'reg2', text: 'Ripete "BANDIERA"?', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì', value: 1 }] },
            { id: 'reg3', text: 'Ripete "ALBERO"?', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì', value: 1 }] },
            // ATTENZIONE E CALCOLO (5)
            { id: 'att1', text: '100 - 7 (93)?', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì', value: 1 }] },
            { id: 'att2', text: '93 - 7 (86)?', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì', value: 1 }] },
            { id: 'att3', text: '86 - 7 (79)?', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì', value: 1 }] },
            { id: 'att4', text: '79 - 7 (72)?', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì', value: 1 }] },
            { id: 'att5', text: '72 - 7 (65)?', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì', value: 1 }] },
            // RICHIAMO (3)
            { id: 'rec1', text: 'Ricorda "PALLA"?', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì', value: 1 }] },
            { id: 'rec2', text: 'Ricorda "BANDIERA"?', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì', value: 1 }] },
            { id: 'rec3', text: 'Ricorda "ALBERO"?', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì', value: 1 }] },
            // LINGUAGGIO (9)
            { id: 'lang1', text: 'Denomina OROLOGIO', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì', value: 1 }] },
            { id: 'lang2', text: 'Denomina MATITA', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì', value: 1 }] },
            { id: 'lang3', text: 'Ripete "SOPRA LA PANCA LA CAPRA CAMPA"', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì (Esatta)', value: 1 }] },
            { id: 'lang4', text: 'Comando triplo (Prendi foglio, piega, posa)', type: 'choice', options: [{ label: '0/3', value: 0 }, { label: '1/3', value: 1 }, { label: '2/3', value: 2 }, { label: '3/3', value: 3 }] },
            { id: 'lang5', text: 'Legge ed esegue "CHIUDA GLI OCCHI"', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì', value: 1 }] },
            { id: 'lang6', text: 'Scrive una frase (Sogg + Pred)', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì', value: 1 }] },
            { id: 'lang7', text: 'Copia il disegno (Pentagoni)', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì (Angoli/Intersezione)', value: 1 }] }
        ],
        scoringLogic: (answers) => Object.values(answers).reduce<number>((a, b) => a + (Number(b) || 0), 0),
        interpretation: (score) => {
            // Cut-offs corretti per scolarità/età andrebbero applicati, ma diamo un range standard grezzo
            if (score >= 24) return 'Assenza di decadimento cognitivo (24-30)';
            if (score >= 18) return 'Decadimento Lieve-Moderato (18-23)';
            if (score >= 10) return 'Decadimento Moderato-Grave (10-17)';
            return 'Decadimento Grave (< 10)';
        }
    },

    'gds': {
        id: 'gds',
        title: 'GDS (Geriatric Depression Scale 15)',
        description: 'Scala depressione. Risposte in grassetto = Depressive (+1).',
        questions: [
            { id: 'g1', text: '1. È soddisfatto della sua vita?', type: 'choice', options: [{ label: 'Sì', value: 0 }, { label: 'No (+1)', value: 1 }] },
            { id: 'g2', text: '2. Ha rinunciato a molte attività?', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì (+1)', value: 1 }] },
            { id: 'g3', text: '3. Sente che la sua vita è vuota?', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì (+1)', value: 1 }] },
            { id: 'g4', text: '4. Si annoia spesso?', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì (+1)', value: 1 }] },
            { id: 'g5', text: '5. È di buon umore gran parte del tempo?', type: 'choice', options: [{ label: 'Sì', value: 0 }, { label: 'No (+1)', value: 1 }] },
            { id: 'g6', text: '6. Teme le accada qualcosa di brutto?', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì (+1)', value: 1 }] },
            { id: 'g7', text: '7. Si sente felice gran parte del tempo?', type: 'choice', options: [{ label: 'Sì', value: 0 }, { label: 'No (+1)', value: 1 }] },
            { id: 'g8', text: '8. Si sente spesso impotente?', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì (+1)', value: 1 }] },
            { id: 'g9', text: '9. Preferisce stare a casa?', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì (+1)', value: 1 }] },
            { id: 'g10', text: '10. Problemi di memoria più di altri?', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì (+1)', value: 1 }] },
            { id: 'g11', text: '11. Pensa sia meraviglioso essere vivi?', type: 'choice', options: [{ label: 'Sì', value: 0 }, { label: 'No (+1)', value: 1 }] },
            { id: 'g12', text: '12. Si sente inutile così com\'è?', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì (+1)', value: 1 }] },
            { id: 'g13', text: '13. Si sente pieno di energie?', type: 'choice', options: [{ label: 'Sì', value: 0 }, { label: 'No (+1)', value: 1 }] },
            { id: 'g14', text: '14. Pensa che la sua situazione sia senza speranza?', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì (+1)', value: 1 }] },
            { id: 'g15', text: '15. Pensa che gli altri stiano meglio?', type: 'choice', options: [{ label: 'No', value: 0 }, { label: 'Sì (+1)', value: 1 }] }
        ],
        scoringLogic: (answers) => Object.values(answers).reduce<number>((a, b) => a + (Number(b) || 0), 0),
        interpretation: (score) => {
            if (score <= 5) return 'Normale (0-5)';
            if (score <= 10) return 'Depressione Lieve (6-10)';
            return 'Depressione Severa (11-15)';
        }
    }
};
