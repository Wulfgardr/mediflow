'use client';

/* native exclusive choices preserve the canonical answer values. */
import { Disclosure } from '@/components/disclosure';
import { useCallback, useState, useRef, useId, type KeyboardEvent } from 'react';
import styles from '@/components/scales/scale-workspace.module.css';
/* keep answered scales within the prototype navigation guard. */
import { useRuntimeTwinPendingForm } from '@/components/runtime-twin-design';
/* button-driven cancellation needs the same explicit draft decision as links. */
import { useConfirm } from '@/components/ui/confirm-dialog';

// MF085-003: neutral types keep validators executable without React.
import { calculateScaleResult, isScaleAnswerValid, type ScaleDefinition } from '@/lib/scale-validation';
import { scaleDisplayTitle, tinettiScoreLabel, TINETTI_CLINICAL_NOTICE } from '@/lib/scale-history';
import { TINETTI_POMA28_ID } from '@/lib/scales/tinetti-poma28-v1';
import { formatCountLabel } from '@/lib/format-count';
export type { ScaleQuestion, ScaleDefinition } from '@/lib/scale-validation';

interface ScaleEngineProps {
    scale: ScaleDefinition;
    showHeading?: boolean;
    answersLocked?: boolean;
    patientLabel?: string;
    onComplete: (result: { score: number; answers: Record<string, string | number>; interpretation: string }) => void | Promise<void>;
    onCancel: () => void;
}

export default function ScaleEngine({ scale, onComplete, onCancel, showHeading = true, patientLabel, answersLocked = false }: ScaleEngineProps) {
    const confirm = useConfirm();
    const answerGroupId = useId();
    const [answers, setAnswers] = useState<Record<string, string | number>>({});
    useRuntimeTwinPendingForm(Object.keys(answers).length > 0);
    const [currentStep, setCurrentStep] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);
    /* WUL-UIUX: il ref blocca anche il doppio click nello stesso tick,
       prima che lo stato isSubmitting si propaghi al disabled del bottone. */
    const submittingRef = useRef(false);
    const focusQuestion = useCallback((heading: HTMLHeadingElement | null) => { heading?.focus(); }, []);

    const handleAnswer = (questionId: string, value: string | number) => {
        if (submittingRef.current || answersLocked) return;
        setValidationError(null);
        setAnswers(prev => ({ ...prev, [questionId]: value }));
    };

    /* retaining a draft must leave answers, question and context mounted. */
    const handleCancel = async () => {
        if (submittingRef.current) return;
        if (Object.keys(answers).length > 0) {
            const result = await confirm({
                title: 'Lasciare la compilazione?',
                message: 'È aperta una compilazione. Le modifiche non salvate andranno perse.',
                confirmLabel: 'Esci senza salvare',
                cancelLabel: 'Continua la compilazione', tone: 'danger',
            });
            if (!result.confirmed) return;
        }
        if (!submittingRef.current) onCancel();
    };

    const handleNext = () => {
        if (submittingRef.current || isSubmitting || !currentAnswerValid) return;
        if (currentStep < scale.questions.length - 1) {
            setCurrentStep(currentStep + 1);
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

    const isLastQuestion = currentStep === scale.questions.length - 1;
    const options = currentQuestion.type === 'boolean'
        ? [{ label: 'Sì / corretto', value: 1 }, { label: 'No / non corretto', value: 0 }]
        : currentQuestion.type === 'choice' ? currentQuestion.options ?? [] : [];
    const digits = options.map(option => String(option.value)).filter(value => /^[0-9]$/.test(value));
    const handleChoiceKey = (event: KeyboardEvent<HTMLFieldSetElement>) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing || event.repeat
            || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
            || answersLocked || submittingRef.current || event.currentTarget.matches(':disabled')
            || !(event.target instanceof HTMLElement) || !event.target.matches('h3, input[type="radio"]')) return;
        if (event.key === 'Enter' && currentAnswerValid && !isLastQuestion) {
            event.preventDefault();
            setCurrentStep(currentStep + 1);
        } else if (digits.includes(event.key)) {
            event.preventDefault();
            handleAnswer(currentQuestion.id, Number(event.key));
            if (isLastQuestion) {
                event.currentTarget.querySelector<HTMLInputElement>(`input[value="${event.key}"]`)?.focus();
            } else {
                setCurrentStep(currentStep + 1);
            }
        }
    };

    const tinetti = scale.id === TINETTI_POMA28_ID;
    const answeredQuestions = scale.questions.filter(question => Object.prototype.hasOwnProperty.call(answers, question.id));
    let draftResult: ReturnType<typeof calculateScaleResult> | null = null;
    if (scale.questions.every(question => isScaleAnswerValid(question, answers[question.id], Object.prototype.hasOwnProperty.call(answers, question.id)))) {
        draftResult = calculateScaleResult(scale, answers);
    }

    return (
        /* WUL-678: one readable question on the workspace plane. */
        <div className={`${styles.workspace} ${styles.engine}`} aria-busy={isSubmitting}>
            {showHeading && <header><h2>{scaleDisplayTitle(scale)}</h2><p>{scale.description}</p></header>}
            {validationError && <p role="alert">{validationError}</p>}
            <div className={styles.formColumns}>
            <div>
            <p className={styles.progress} aria-live="polite">Domanda {currentStep + 1} di {scale.questions.length}</p>
            <fieldset className={styles.questionGroup} disabled={isSubmitting || answersLocked}
                onKeyDown={options.length ? handleChoiceKey : undefined}>
                <legend className={styles.legend}>
                    <h3 key={currentQuestion.id} ref={focusQuestion} tabIndex={-1} className={styles.question}>{currentQuestion.text}</h3>
                </legend>
                <div key={currentQuestion.id} className={styles.answers}>
                    {options.map(option => (
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
                                aria-keyshortcuts={digits.includes(String(option.value)) ? String(option.value) : undefined}
                                onChange={() => handleAnswer(currentQuestion.id, option.value)}
                            />
                            <span>{option.label}</span>
                        </label>
                    ))}

                    {/* blank numeric fields remain unanswered; text is not coerced to points. */}
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
                {digits.length > 0 && <p className={styles.shortcuts}>
                    {isLastQuestion ? 'Cifre per scegliere. Premi Completa per registrare.' : 'Cifre per scegliere e avanzare. Invio per avanzare dopo la scelta.'}
                </p>}
            </fieldset>

            </div>
            <aside className={styles.draftSummary} aria-label="Risultato in bozza">
                <h3>Risultato in bozza</h3>
                {draftResult ? <><p className={styles.score}>{tinetti ? tinettiScoreLabel(draftResult.score) : draftResult.score}</p><p>{tinetti ? TINETTI_CLINICAL_NOTICE : draftResult.interpretation}</p></> : <p>{formatCountLabel(answeredQuestions.length, 'risposta', 'risposte')} su {scale.questions.length}</p>}
                <Disclosure className={styles.answerDetails} title={<>Risposte compilate · {answeredQuestions.length}</>}><dl>{answeredQuestions.map(question => <div key={question.id}><dt>{question.text}</dt><dd>{question.options?.find(option => option.value === answers[question.id])?.label ?? String(answers[question.id])}</dd></div>)}</dl></Disclosure>
            </aside>
            </div>
            <div className={styles.actions}>
                {patientLabel && <strong className={styles.thresholdContext}>{patientLabel}</strong>}
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
                            onClick={() => { if (!submittingRef.current) setCurrentStep(currentStep - 1); }}
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
                        {isLastQuestion
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
