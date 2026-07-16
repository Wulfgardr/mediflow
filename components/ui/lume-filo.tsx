'use client';

/* @Codex */
import { type CSSProperties, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

type LumeFiloTone = 'accent' | 'muted';

interface LumeFiloBaseProps {
    className?: string;
    style?: CSSProperties;
    tone?: LumeFiloTone;
}

interface LumeFiloSpinaProps extends LumeFiloBaseProps {
    variant: 'spina';
    anchorSelector?: string;
    nodeCount?: number;
}

interface LumeFiloConnettoreProps extends LumeFiloBaseProps {
    variant: 'connettore';
    fill: number;
    path?: string;
    viewBox?: string;
}

export type LumeFiloProps = LumeFiloSpinaProps | LumeFiloConnettoreProps;

type LumeFiloStyle = CSSProperties & {
    '--lume-filo-fill'?: string;
    '--lume-spina-scale'?: number;
};

const DEFAULT_CONNECTOR_PATH = 'M 1 1 C 1 8 7 11 19 11';
const CONNECTOR_DRAW_FALLBACK_MS = 300;

let activeFiloMotion: { id: string; stop: () => void } | null = null;

function claimFiloMotion(id: string, stop: () => void, preempt: boolean): boolean {
    if (activeFiloMotion?.id === id) return true;
    if (activeFiloMotion && !preempt) return false;
    activeFiloMotion?.stop();
    activeFiloMotion = { id, stop };
    return true;
}

function releaseFiloMotion(id: string) {
    if (activeFiloMotion?.id === id) activeFiloMotion = null;
}

function filoColor(tone: LumeFiloTone): string {
    return tone === 'muted' ? 'var(--lume-ink-muted)' : 'var(--lume-accent)';
}

/* @Codex: un solo primitivo SVG per la continuita temporale e la provenienza. */
export function LumeFilo(props: LumeFiloProps) {
    const tone = props.tone ?? 'accent';

    if (props.variant === 'spina') {
        if (props.nodeCount !== undefined && props.nodeCount < 2) return null;
        return (
            <LumeSpina
                anchorSelector={props.anchorSelector}
                className={props.className}
                color={filoColor(tone)}
                nodeCount={props.nodeCount}
                style={props.style}
            />
        );
    }

    return (
        <LumeConnettore
            className={props.className}
            color={filoColor(tone)}
            fill={props.fill}
            path={props.path ?? DEFAULT_CONNECTOR_PATH}
            style={props.style}
            viewBox={props.viewBox ?? '0 0 20 14'}
        />
    );
}

function LumeSpina({
    anchorSelector,
    className,
    color,
    nodeCount,
    style,
}: {
    anchorSelector?: string;
    className?: string;
    color: string;
    nodeCount?: number;
    style?: CSSProperties;
}) {
    const motionId = useId();
    const svgRef = useRef<SVGSVGElement>(null);

    useLayoutEffect(() => {
        const svg = svgRef.current;
        const container = svg?.parentElement;
        if (!svg || !container || !anchorSelector) return;

        const updateGeometry = () => {
            const nodes = container.querySelectorAll<Element>(anchorSelector);
            const first = nodes.item(0);
            const last = nodes.item(nodes.length - 1);
            if (!first || !last) return;

            const containerRect = container.getBoundingClientRect();
            const firstRect = first.getBoundingClientRect();
            const lastRect = last.getBoundingClientRect();
            const start = firstRect.top - containerRect.top + firstRect.height / 2;
            const end = lastRect.top - containerRect.top + lastRect.height / 2;
            svg.style.top = `${start}px`;
            svg.style.height = `${Math.max(end - start, 0)}px`;
        };

        const resizeObserver = new ResizeObserver(updateGeometry);
        const mutationObserver = new MutationObserver(updateGeometry);
        resizeObserver.observe(container);
        mutationObserver.observe(container, { childList: true, subtree: true });
        updateGeometry();

        return () => {
            mutationObserver.disconnect();
            resizeObserver.disconnect();
        };
    }, [anchorSelector]);

    useEffect(() => {
        const svg = svgRef.current;
        if (!svg) return;

        let previousHeight = svg.getBoundingClientRect().height;
        let frame = 0;
        let fallback = 0;
        const release = () => releaseFiloMotion(motionId);
        const stopAtCurrentValue = () => {
            const currentTransform = getComputedStyle(svg).transform;
            svg.dataset.lumeFiloStatic = 'true';
            svg.style.transition = 'none';
            svg.style.transform = currentTransform === 'none' ? '' : currentTransform;
        };
        const scheduleRelease = () => {
            window.clearTimeout(fallback);
            fallback = window.setTimeout(release, CONNECTOR_DRAW_FALLBACK_MS);
        };
        const startDraw = (startScale: number, preempt: boolean) => {
            const ownsMotion = claimFiloMotion(motionId, stopAtCurrentValue, preempt);
            cancelAnimationFrame(frame);
            svg.style.transform = '';
            svg.style.transition = '';
            if (!ownsMotion) {
                svg.dataset.lumeFiloStatic = 'true';
                svg.style.setProperty('--lume-spina-scale', '1');
                return;
            }
            svg.dataset.lumeFiloStatic = 'true';
            svg.style.setProperty('--lume-spina-scale', String(startScale));
            svg.getBoundingClientRect();
            delete svg.dataset.lumeFiloStatic;
            frame = requestAnimationFrame(() => {
                svg.style.setProperty('--lume-spina-scale', '1');
                scheduleRelease();
            });
        };

        const handleTransitionEnd = (event: TransitionEvent) => {
            if (event.propertyName === 'transform') release();
        };
        svg.addEventListener('transitionend', handleTransitionEnd);
        startDraw(0, false);

        const observer = new ResizeObserver(([entry]) => {
            const nextHeight = entry?.contentRect.height ?? 0;
            if (previousHeight > 0 && nextHeight > previousHeight + 0.5) {
                startDraw(previousHeight / nextHeight, true);
            }
            previousHeight = nextHeight;
        });

        observer.observe(svg);
        return () => {
            cancelAnimationFrame(frame);
            window.clearTimeout(fallback);
            svg.removeEventListener('transitionend', handleTransitionEnd);
            observer.disconnect();
            release();
        };
    }, [motionId]);

    return (
        <svg
            ref={svgRef}
            aria-hidden="true"
            focusable="false"
            className={`lume-filo-spina pointer-events-none ${className ?? ''}`}
            data-lume-filo="spina"
            data-lume-filo-node-count={nodeCount}
            preserveAspectRatio="none"
            viewBox="0 0 1 100"
            style={{ ...style, color, '--lume-spina-scale': 0 } as LumeFiloStyle}
        >
            <line
                x1="0.5"
                x2="0.5"
                y1="0"
                y2="100"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
}

function LumeConnettore({
    className,
    color,
    fill,
    path,
    style,
    viewBox,
}: {
    className?: string;
    color: string;
    fill: number;
    path: string;
    style?: CSSProperties;
    viewBox: string;
}) {
    const drawId = useId();
    const pathRef = useRef<SVGPathElement>(null);
    const didMount = useRef(false);
    const targetFill = Math.min(100, Math.max(0, fill));
    const [visibleFill, setVisibleFill] = useState(0);
    const [draws, setDraws] = useState(false);

    useEffect(() => {
        const isEntrance = !didMount.current;
        didMount.current = true;
        const pathElement = pathRef.current;
        if (!pathElement) return;

        const stopAtCurrentValue = () => {
            const offset = Number.parseFloat(getComputedStyle(pathElement).strokeDashoffset);
            setDraws(false);
            if (Number.isFinite(offset)) setVisibleFill(Math.min(100, Math.max(0, 100 - offset)));
        };
        const ownsDraw = claimFiloMotion(drawId, stopAtCurrentValue, !isEntrance);
        if (!ownsDraw) {
            setDraws(false);
            setVisibleFill(targetFill);
            return;
        }

        setDraws(true);
        const frame = requestAnimationFrame(() => setVisibleFill(targetFill));
        const release = () => releaseFiloMotion(drawId);
        const fallback = window.setTimeout(release, CONNECTOR_DRAW_FALLBACK_MS);
        pathElement.addEventListener('transitionend', release, { once: true });

        return () => {
            cancelAnimationFrame(frame);
            window.clearTimeout(fallback);
            pathElement.removeEventListener('transitionend', release);
            release();
        };
    }, [drawId, targetFill]);

    return (
        <svg
            aria-hidden="true"
            focusable="false"
            className={`pointer-events-none overflow-visible ${className ?? ''}`}
            data-lume-filo="connettore"
            preserveAspectRatio="none"
            viewBox={viewBox}
            style={{ ...style, color } as CSSProperties}
        >
            <path
                ref={pathRef}
                className="lume-filo-draw"
                data-lume-filo-static={draws ? undefined : 'true'}
                d={path}
                fill="none"
                pathLength="100"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1"
                style={{
                    '--lume-filo-fill': `${visibleFill}%`,
                } as LumeFiloStyle}
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
}
