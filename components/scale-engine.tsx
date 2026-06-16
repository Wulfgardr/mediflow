'use client';

import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface ScaleQuestion {
    id: string;
    text: string;
    type: 'boolean' | 'choice' | 'number';
    options?: { label: string; value: number }[];
    maxScore?: number;
}

export interface ScaleDefinition {
    id: string;
    title: string;
    description: string;
    questions: ScaleQuestion[];
    scoringLogic: (answers: Record<string, string | number>) => number;
    interpretation: (score: number) => string;
}

interface ScaleEngineProps {
    scale: ScaleDefinition;
    onComplete: (result: { score: number; answers: Record<string, string | number>; interpretation: string }) => void;
    onCancel: () => void;
}

function ProgressBar({ progress }: { progress: number }) {
    const barRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (barRef.current) {
            barRef.current.style.width = `${progress}%`;
        }
    }, [progress]);

    return (
        // @Codex WUL-229: progress meter uses MediFlow palette
        <div
            className="mt-6 h-1.5 rounded-full overflow-hidden"
            style={{ background: 'rgba(112, 106, 100, 0.18)' }}
        >
            <div
                ref={barRef}
                className="h-full transition-all duration-500 ease-out"
                style={{
                    background: 'linear-gradient(90deg, var(--mf-primary), #2aa37e)'
                }}
            />
        </div>
    );
}

export default function ScaleEngine({ scale, onComplete, onCancel }: ScaleEngineProps) {
    const [answers, setAnswers] = useState<Record<string, string | number>>({});
    const [currentStep, setCurrentStep] = useState(0);

    const handleAnswer = (questionId: string, value: string | number) => {
        setAnswers(prev => ({ ...prev, [questionId]: value }));
    };

    const handleNext = () => {
        if (currentStep < scale.questions.length - 1) {
            setCurrentStep(prev => prev + 1);
        } else {
            finish();
        }
    };

    const finish = () => {
        const score = scale.scoringLogic(answers);
        const interpretation = scale.interpretation(score);
        onComplete({ score, answers, interpretation });
    };

    const currentQuestion = scale.questions[currentStep];
    const progress = ((currentStep + 1) / scale.questions.length) * 100;

    return (
        // @Codex WUL-273: scale engine can live inside the Kree8 workspace without the old page chrome.
        <div className="patient-detail-section mx-auto flex min-h-[500px] w-full max-w-3xl flex-col overflow-hidden border !p-0">
            <div className="border-b border-[color:rgba(112,106,100,0.12)] p-6">
                <h2 className="text-2xl font-semibold tracking-tight text-[color:var(--mf-ink)]">{scale.title}</h2>
                <p className="mt-1 text-sm text-[color:var(--mf-muted)]">{scale.description}</p>

                <ProgressBar progress={progress} />
                <div className="mt-2 text-right text-xs text-[color:var(--mf-muted)]">
                    Domanda {currentStep + 1} di {scale.questions.length}
                </div>
            </div>

            <div className="flex flex-1 flex-col justify-center p-6 md:p-8">
                <h3 className="mb-8 text-xl font-medium leading-relaxed text-[color:var(--mf-ink)]">
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
                                            borderColor: 'var(--mf-critical)',
                                            background: 'rgba(192, 57, 43, 0.08)',
                                            color: 'var(--mf-critical)'
                                        }
                                        : undefined
                                }
                            >
                                No / non corretto
                            </button>
                        </div>
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
                        disabled={answers[currentQuestion.id] === undefined}
                        className="ui-btn-primary px-8 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {currentStep === scale.questions.length - 1 ? 'Completa' : 'Avanti'}
                    </button>
                </div>
            </div>
        </div>
    );
}
