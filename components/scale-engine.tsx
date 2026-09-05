'use client';

import { useState, useRef } from 'react';
import { cn } from '@/lib/utils';

// @Codex MF085-003: neutral types keep validators executable without React.
import { calculateScaleResult, isScaleAnswerValid, type ScaleDefinition } from '@/lib/scale-validation';
export type { ScaleQuestion, ScaleDefinition } from '@/lib/scale-validation';

interface ScaleEngineProps {
    scale: ScaleDefinition;
    onComplete: (result: { score: number; answers: Record<string, string | number>; interpretation: string }) => void | Promise<void>;
    onCancel: () => void;
}

function ProgressBar({ progress }: { progress: number }) {
    return (
        // @Codex WUL-229: progress meter uses MediFlow palette
        <div
            className="mt-6 h-1.5 rounded-full overflow-hidden"
            style={{ background: 'color-mix(in srgb, var(--lume-ink) 18%, transparent)' }}
        >
            <div
                className="h-full transition-[width] duration-[var(--lume-dur-firma)] ease-[var(--lume-ease)]"
                style={{
                    background: 'var(--lume-accent)',
                    width: `${progress}%`,
                }}
            />
        </div>
    );
}

export default function ScaleEngine({ scale, onComplete, onCancel }: ScaleEngineProps) {
    const [answers, setAnswers] = useState<Record<string, string | number>>({});
    const [currentStep, setCurrentStep] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);
    /* @Codex WUL-UIUX: il ref blocca anche il doppio click nello stesso tick,
       prima che lo stato isSubmitting si propaghi al disabled del bottone. */
    const submittingRef = useRef(false);

    const handleAnswer = (questionId: string, value: string | number) => {
        setValidationError(null);
        setAnswers(prev => ({ ...prev, [questionId]: value }));
    };

    const handleNext = () => {
        if (isSubmitting || !currentAnswerValid) return;
        if (currentStep < scale.questions.length - 1) {
            setCurrentStep(prev => prev + 1);
        } else {
            void finish();
        }
    };

    const finish = async () => {
        if (submittingRef.current) return;
        submittingRef.current = true;
        setIsSubmitting(true);
        try {
            const result = calculateScaleResult(scale, answers);
            await onComplete(result);
        } catch {
            setValidationError('Valutazione non inviata. Verificare le risposte e riprovare.');
        } finally {
            submittingRef.current = false;
            setIsSubmitting(false);
        }
    };

    const currentQuestion = scale.questions[currentStep];
    const currentAnswerValid = currentQuestion !== undefined && isScaleAnswerValid(
        currentQuestion, answers[currentQuestion.id],
        Object.prototype.hasOwnProperty.call(answers, currentQuestion.id),
    );
    const progress = ((currentStep + 1) / scale.questions.length) * 100;
    if (!currentQuestion || scale.retired) return <p role="alert">Scala non disponibile per nuove valutazioni.</p>;

    return (
        // @Codex WUL-273: scale engine can live inside the Kree8 workspace without the old page chrome.
        <div className="patient-detail-section mx-auto flex min-h-[500px] w-full max-w-3xl flex-col overflow-hidden border !p-0">
            <div className="border-b border-[color:rgba(112,106,100,0.12)] p-6">
                <h2 className="text-2xl font-semibold tracking-tight text-[color:var(--lume-ink)]">{scale.title}</h2>
                <p className="mt-1 text-sm text-[color:var(--lume-ink-muted)]">{scale.description}</p>

                {validationError && <p role="alert">{validationError}</p>}
                <ProgressBar progress={progress} />
                <div className="mt-2 text-right text-xs text-[color:var(--lume-ink-muted)]">
                    Domanda {currentStep + 1} di {scale.questions.length}
                </div>
            </div>

            <div className="flex flex-1 flex-col justify-center p-6 md:p-8">
                <h3 className="mb-8 text-xl font-medium leading-relaxed text-[color:var(--lume-ink)]">
                    {currentQuestion.text}
                </h3>

                <div className="space-y-3">
                    {currentQuestion.type === 'boolean' && (
                        <div className="grid grid-cols-2 gap-4">
                            <button
                                onClick={() => handleAnswer(currentQuestion.id, 1)}
                                className={cn(
                                    'mf-option-card !p-6 text-lg font-medium justify-center text-center',
                                    answers[currentQuestion.id] === 1 && 'is-active'
                                )}
                            >
                                Sì / corretto
                            </button>
                            <button
                                onClick={() => handleAnswer(currentQuestion.id, 0)}
                                className={cn(
                                    'mf-option-card !p-6 text-lg font-medium justify-center text-center',
                                    answers[currentQuestion.id] === 0 && 'is-active'
                                )}
                                style={
                                    answers[currentQuestion.id] === 0
                                        ? {
                                            borderColor: 'var(--lume-signal-critical)',
                                            background: 'rgba(192, 57, 43, 0.08)',
                                            color: 'var(--lume-signal-critical)'
                                        }
                                        : undefined
                                }
                            >
                                No / non corretto
                            </button>
                        </div>
                    )}

                    {/* @Codex: blank numeric fields remain unanswered; text is not coerced to points. */}
                    {(currentQuestion.type === 'number' || currentQuestion.type === 'text') && (
                        <input
                            aria-label={currentQuestion.text}
                            type={currentQuestion.type === 'number' ? 'number' : 'text'}
                            min={currentQuestion.minScore}
                            max={currentQuestion.maxScore}
                            value={answers[currentQuestion.id] ?? ''}
                            onChange={event => {
                                const value = event.currentTarget.value;
                                if (currentQuestion.type === 'number' && value === '') {
                                    setAnswers(previous => {
                                        const next = { ...previous };
                                        delete next[currentQuestion.id];
                                        return next;
                                    });
                                } else {
                                    handleAnswer(currentQuestion.id, currentQuestion.type === 'number' ? Number(value) : value);
                                }
                            }}
                        />
                    )}

                    {currentQuestion.type === 'choice' && currentQuestion.options?.map(opt => (
                        <button
                            key={opt.label}
                            onClick={() => handleAnswer(currentQuestion.id, opt.value)}
                            className={cn(
                                'mf-option-card w-full font-medium',
                                answers[currentQuestion.id] === opt.value && 'is-active'
                            )}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:rgba(112,106,100,0.12)] p-5 md:p-6">
                <button
                    onClick={onCancel}
                    className="mf-btn-secondary"
                >
                    Annulla
                </button>

                <div className="flex flex-wrap gap-3">
                    {currentStep > 0 && (
                        <button
                            onClick={() => setCurrentStep(prev => prev - 1)}
                            className="mf-btn-secondary"
                        >
                            Indietro
                        </button>
                    )}
                    <button
                        onClick={handleNext}
                        disabled={!currentAnswerValid || isSubmitting}
                        className="ui-btn-primary px-8 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {currentStep === scale.questions.length - 1
                            ? isSubmitting
                                ? 'Salvataggio...'
                                : 'Completa'
                            : 'Avanti'}
                    </button>
                </div>
            </div>
        </div>
    );
}
