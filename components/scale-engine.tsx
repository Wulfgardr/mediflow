'use client';

/* @Codex: native exclusive choices preserve the canonical answer values. */
import { useState, useRef, useEffect, useId } from 'react';
import styles from '@/components/scales/scale-workspace.module.css';
/* @Codex: keep answered scales within the prototype navigation guard. */
import { useRuntimeTwinPendingForm } from '@/components/runtime-twin-design';
/* @Codex: button-driven cancellation needs the same explicit draft decision as links. */
import { useConfirm } from '@/components/ui/confirm-dialog';

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
    const confirm = useConfirm();
    const answerGroupId = useId();
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
        if (submittingRef.current) return;
        setValidationError(null);
        setAnswers(prev => ({ ...prev, [questionId]: value }));
    };

    /* @Codex: retaining a draft must leave answers, question and context mounted. */
    const handleCancel = async () => {
        if (submittingRef.current) return;
        if (Object.keys(answers).length > 0) {
            const result = await confirm({
                title: 'Lasciare la compilazione?',
                message: 'È aperta una compilazione. Le modifiche non salvate andranno perse.',
                confirmLabel: 'Esci senza salvare',
                cancelLabel: 'Continua a scrivere',
            });
            if (!result.confirmed) return;
        }
        if (!submittingRef.current) onCancel();
    };

    const handleNext = () => {
        if (submittingRef.current || isSubmitting || !currentAnswerValid) return;
        if (currentStep < scale.questions.length - 1) {
            setCurrentStep(prev => prev + 1);
        } else {
            void finish();
        }
    };

    const finish = async () => {
        if (submittingRef.current) return;
        submittingRef.current = true;
        setValidationError(null);
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
        <div className={`${styles.workspace} ${styles.engine}`} aria-busy={isSubmitting}>
            {showHeading && <header><h2>{scale.title}</h2><p>{scale.description}</p></header>}
            {validationError && <p role="alert">{validationError}</p>}
            <p className={styles.progress} aria-live="polite">Domanda {currentStep + 1} di {scale.questions.length}</p>
            <fieldset className={styles.questionGroup} disabled={isSubmitting}>
                <legend className={styles.legend}>
                    <h3 ref={questionRef} tabIndex={-1} className={styles.question}>{currentQuestion.text}</h3>
                </legend>
                <div key={currentQuestion.id} className={styles.answers}>
                    {/* @Codex: Tab enters the group; arrow keys select one exact answer. */}
                    {(currentQuestion.type === 'choice' || currentQuestion.type === 'boolean') && (
                        currentQuestion.type === 'boolean'
                            ? [{ label: 'Sì / corretto', value: 1 }, { label: 'No / non corretto', value: 0 }]
                            : currentQuestion.options ?? []
                    ).map(option => (
                        <label
                            key={option.label}
                            className={styles.choice}
                            data-selected={answers[currentQuestion.id] === option.value}
                        >
                            <input
                                type="radio"
                                name={`${answerGroupId}-${currentQuestion.id}`}
                                value={option.value}
                                checked={answers[currentQuestion.id] === option.value}
                                onChange={() => handleAnswer(currentQuestion.id, option.value)}
                            />
                            <span>{option.label}</span>
                        </label>
                    ))}

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
                                if (submittingRef.current) return;
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
                </div>
            </fieldset>

            <div className={styles.actions}>
                <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => { void handleCancel(); }}
                    className={styles.control}
                >
                    Annulla
                </button>

                <div className={styles.navigation}>
                    {currentStep > 0 && (
                        <button
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => { if (!submittingRef.current) setCurrentStep(prev => prev - 1); }}
                            className={styles.control}
                        >
                            Indietro
                        </button>
                    )}
                    <button
                        type="button"
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
