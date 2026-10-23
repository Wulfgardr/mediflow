'use client';

import { useState } from 'react';
import { FunctionModelPicker, useFunctionModelPicker } from '@/components/function-models/function-model-picker';

export default function ChoiceFieldFixture() {
    const picker = useFunctionModelPicker('patient_insight', 'synthetic-choice-fixture');
    const [renders, setRenders] = useState(0);
    const [disabled, setDisabled] = useState(false);
    const [error, setError] = useState(false);
    return <main className="mx-auto max-w-3xl space-y-4 p-4" data-testid="choice-fixture">
        <h1 className="type-page-title">Scelta del modello</h1>
        <p>Esempio sintetico. Nessuna proposta viene generata.</p>
        <FunctionModelPicker picker={{ ...picker, active: picker.active && !disabled,
            view: { ...picker.view, error: error ? 'Errore sintetico: impossibile confermare il modello.' : picker.view.error } }} />
        <div className="flex flex-wrap gap-3">
            <button className="mf-button-secondary" onClick={() => setRenders(value => value + 1)}>Aggiorna vista</button>
            <button className="mf-button-secondary" onClick={() => setDisabled(value => !value)}>Cambia disabilitazione</button>
            <button className="mf-button-secondary" onClick={() => setError(value => !value)}>Cambia errore</button>
        </div>
        <p>Render aggiuntivi: {renders}</p>
    </main>;
}
