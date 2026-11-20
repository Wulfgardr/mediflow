'use client';

import { createContext, useContext } from 'react';
import { useRuntimeTwinDesign, useRuntimeTwinFolder } from '@/components/runtime-twin-design';

export const SheetDiaryReadingContext = createContext(false);

export function useSheetDiaryReading(sectionId: string | undefined) {
    const offered = useContext(SheetDiaryReadingContext);
    const folder = useRuntimeTwinFolder();
    const { proposal } = useRuntimeTwinDesign();
    return offered && proposal && folder === 'quadro' && sectionId === 'diario';
}
