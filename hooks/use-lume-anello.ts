import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';

// @Codex: keeps the touch-origin ring local to one direct interaction.
type LumeAnello = {
  x: number;
  y: number;
};

export function useLumeAnello() {
  const [anello, setAnello] = useState<LumeAnello | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const onLumePointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setAnello({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });

    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setAnello(null);
      timeoutRef.current = null;
    }, 360);
  }, []);

  return { anello, onLumePointerDown };
}
