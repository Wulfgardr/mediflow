'use client';

import { useState } from 'react';
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
        <div className="glass-panel max-w-2xl mx-auto overflow-hidden flex flex-col min-h-[500px]">
            {/* Header */}
            <div className="p-6 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-indigo-100">
                <h2 className="text-2xl font-bold text-gray-800">{scale.title}</h2>
                <p className="text-gray-600 text-sm mt-1">{scale.description}</p>

                <div className="mt-6 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-blue-500 transition-all duration-500 ease-out"
                        style={{ width: `${progress}%` }}
                    />
                </div>
                <div className="text-right text-xs text-gray-500 mt-1">
                    Domanda {currentStep + 1} di {scale.questions.length}
                </div>
            </div>

            {/* Question Body */}
            <div className="flex-1 p-8 flex flex-col justify-center">
                <h3 className="text-xl font-medium text-gray-800 mb-8 leading-relaxed">
                    {currentQuestion.text}
                </h3>

                <div className="space-y-3">
                    {currentQuestion.type === 'boolean' && (
                        <div className="grid grid-cols-2 gap-4">
                            <button
                                onClick={() => handleAnswer(currentQuestion.id, 1)}
                                className={cn(
                                    "p-6 rounded-2xl border-2 text-lg font-medium transition-all",
                                    answers[currentQuestion.id] === 1
                                        ? "border-blue-500 bg-blue-50 text-blue-700 shadow-md"
                                        : "border-gray-200 hover:border-blue-300 hover:bg-gray-50"
                                )}
                            >
                                Sì / Corretto
                            </button>
                            <button
                                onClick={() => handleAnswer(currentQuestion.id, 0)}
                                className={cn(
                                    "p-6 rounded-2xl border-2 text-lg font-medium transition-all",
                                    answers[currentQuestion.id] === 0
                                        ? "border-red-500 bg-red-50 text-red-700 shadow-md"
                                        : "border-gray-200 hover:border-red-300 hover:bg-gray-50"
                                )}
                            >
                                No / Errato
                            </button>
                        </div>
                    )}

                    {currentQuestion.type === 'choice' && currentQuestion.options?.map(opt => (
                        <button
                            key={opt.label}
                            onClick={() => handleAnswer(currentQuestion.id, opt.value)}
                            className={cn(
                                "w-full p-4 rounded-xl border text-left font-medium transition-all",
                                answers[currentQuestion.id] === opt.value
                                    ? "border-blue-500 bg-blue-50 text-blue-700"
                                    : "border-gray-200 hover:bg-gray-50"
                            )}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Footer Controls */}
            <div className="p-6 border-t border-gray-100 bg-gray-50/50 flex justify-between items-center">
                <button
                    onClick={onCancel}
                    className="px-6 py-2 text-gray-500 hover:bg-gray-200/50 rounded-lg transition-colors"
                >
                    Annulla
                </button>

                <div className="flex gap-3">
                    {currentStep > 0 && (
                        <button
                            onClick={() => setCurrentStep(prev => prev - 1)}
                            className="px-6 py-2 border border-gray-300 rounded-xl font-medium text-gray-700 hover:bg-white transition-colors"
                        >
                            Indietro
                        </button>
                    )}
                    <button
                        onClick={handleNext}
                        disabled={answers[currentQuestion.id] === undefined}
                        className="px-8 py-2 bg-blue-600 text-white rounded-xl font-bold shadow-lg shadow-blue-500/30 hover:bg-blue-700 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {currentStep === scale.questions.length - 1 ? 'Completa' : 'Avanti'}
                    </button>
                </div>
            </div>
        </div>
    );
}
