'use client';

import { useState, useRef, useEffect } from 'react';
import styles from '@/components/scales/scale-workspace.module.css';
/* @Codex: keep answered scales within the prototype navigation guard. */
import { useRuntimeTwinPendingForm } from '@/components/runtime-twin-design';

// @Codex MF085-003: neutral types keep validators executable without React.
import { calculateScaleResult, isScaleAnswerValid, type ScaleDefinition } from '@/lib/scale-validation';
export type { ScaleQuestion, ScaleDefinition } from '@/lib/scale-validation';

interface ScaleEngineProps {
    scale: ScaleDefinition;
    showHeading?: boolean;
    onComplete: (result: { score: number; answers: Record<string, string | number>; interpretation: string }) => void | Promise<void>;
    onCancel: () => void;
}

export default function ScaleEngine({ scale, onComplete, onCancel, showHeading = true }: ScaleEngineProps) {
    const [answers, setAnswers] = useState<Record<string, string | number>>({});
    useRuntimeTwinPendingForm(Object.keys(answers).length > 0);
    const [currentStep, setCurrentStep] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);
    /* @Codex WUL-UIUX: il ref blocca anche il doppio click nello stesso tick,
       prima che lo stato isSubmitting si propaghi al disabled del bottone. */
    const submittingRef = useRef(false);
    /* @Codex: orient keyboard users on each question without changing answers. */
    const questionRef = useRef<HTMLHeadingElement>(null);
    useEffect(() => { questionRef.current?.focus(); }, [currentStep]);

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
    if (!currentQuestion || scale.retired) return <p role="alert">Scala non disponibile per nuove valutazioni.</p>;

    return (
        /* @Codex WUL-678: one readable question on the workspace plane. */
        <div className={`${styles.workspace} ${styles.engine}`}>
            {showHeading && <header><h2>{scale.title}</h2><p>{scale.description}</p></header>}
            {validationError && <p role="alert">{validationError}</p>}
            <p className={styles.progress} aria-live="polite">Domanda {currentStep + 1} di {scale.questions.length}</p>
            <div>
                <h3 ref={questionRef} tabIndex={-1} className={styles.question}>{currentQuestion.text}</h3>
                <div className={styles.answers}>
                    {currentQuestion.type === 'boolean' && (
                        <div className={styles.answers}>
                            <button
                                type="button"
                                aria-pressed={answers[currentQuestion.id] === 1}
                                onClick={() => handleAnswer(currentQuestion.id, 1)}
                                className={styles.choice}
                            >
                                Sì / corretto
                                {answers[currentQuestion.id] === 1 && <span aria-hidden="true">✓</span>}
                            </button>
                            <button
                                type="button"
                                aria-pressed={answers[currentQuestion.id] === 0}
                                onClick={() => handleAnswer(currentQuestion.id, 0)}
                                className={styles.choice}
                            >
                                No / non corretto
                                {answers[currentQuestion.id] === 0 && <span aria-hidden="true">✓</span>}
                            </button>
                        </div>
                    )}

                    {/* @Codex: blank numeric fields remain unanswered; text is not coerced to points. */}
                    {(currentQuestion.type === 'number' || currentQuestion.type === 'text') && (
                        <input
                            className={styles.input}
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
                            type="button"
                            aria-pressed={answers[currentQuestion.id] === opt.value}
                            onClick={() => handleAnswer(currentQuestion.id, opt.value)}
                            className={styles.choice}
                        >
                            {opt.label}
                            {answers[currentQuestion.id] === opt.value && <span aria-hidden="true">✓</span>}
                        </button>
                    ))}
                </div>
            </div>

            <div className={styles.actions}>
                <button
                    onClick={onCancel}
                    className={styles.control}
                >
                    Annulla
                </button>

                <div className={styles.navigation}>
                    {currentStep > 0 && (
                        <button
                            onClick={() => setCurrentStep(prev => prev - 1)}
                            className={styles.control}
                        >
                            Indietro
                        </button>
                    )}
                    <button
                        onClick={handleNext}
                        disabled={!currentAnswerValid || isSubmitting}
                        className={`${styles.control} ${styles.primary}`}
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
