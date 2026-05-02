/* @Codex */
const CONTOUR_PATHS = [
    'M-20 180 C 180 40, 320 40, 560 160 S 900 360, 1260 220',
    'M-40 260 C 160 110, 380 110, 620 240 S 980 420, 1320 300',
    'M-10 360 C 150 220, 370 210, 650 330 S 980 520, 1320 420',
    'M-30 470 C 220 320, 420 310, 700 420 S 1010 630, 1320 560',
    'M40 600 C 280 450, 470 460, 750 540 S 1020 720, 1320 690',
    'M140 -20 C 40 180, 60 360, 190 560 S 470 930, 330 1260',
    'M310 -40 C 170 180, 180 410, 330 620 S 600 960, 500 1260',
    'M480 -40 C 340 180, 360 420, 530 640 S 780 980, 710 1260',
    'M720 -20 C 610 170, 620 390, 760 610 S 1020 930, 980 1260',
    'M930 -20 C 820 160, 830 360, 940 590 S 1170 930, 1160 1260',
];

/* @Codex */
export function FlowFieldBackground() {
    return (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
            <div className="absolute inset-0 mediflow-ambient-plane" />
            <div className="absolute inset-x-0 top-[-8%] h-[48%] mediflow-flow-bloom mediflow-flow-bloom-top" />
            <div className="absolute right-[-12%] top-[10%] h-[34%] w-[42%] mediflow-flow-bloom mediflow-flow-bloom-side" />
            <div className="absolute bottom-[-12%] left-[-8%] h-[40%] w-[48%] mediflow-flow-bloom mediflow-flow-bloom-bottom" />
            <svg
                className="mediflow-flow-contours-primary absolute inset-0 h-full w-full text-[color:var(--mf-flow-primary)] opacity-40"
                viewBox="0 0 1280 1280"
                preserveAspectRatio="none"
                fill="none"
            >
                {CONTOUR_PATHS.map((path, index) => (
                    <path
                        key={`primary-${index}`}
                        d={path}
                        stroke="currentColor"
                        strokeWidth={index < 5 ? 1.4 : 1.1}
                        strokeLinecap="round"
                        strokeOpacity={index < 5 ? 0.26 : 0.16}
                    />
                ))}
            </svg>
            <svg
                className="mediflow-flow-contours-secondary absolute inset-0 h-full w-full text-[color:var(--mf-flow-secondary)] opacity-25 mix-blend-multiply"
                viewBox="0 0 1280 1280"
                preserveAspectRatio="none"
                fill="none"
            >
                {CONTOUR_PATHS.slice(0, 5).map((path, index) => (
                    <path
                        key={`secondary-${index}`}
                        d={path}
                        transform={`translate(${index * 24} ${index * 22}) scale(${1 + index * 0.02})`}
                        stroke="currentColor"
                        strokeWidth={1}
                        strokeLinecap="round"
                        strokeOpacity={0.16}
                    />
                ))}
            </svg>
        </div>
    );
}
