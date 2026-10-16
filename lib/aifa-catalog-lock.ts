export class AifaUpdateError extends Error {
    constructor(message: string, public status: number) { super(message); }
}

export class AifaReductionError extends AifaUpdateError {
    constructor(public confirmation: string, public previousCount: number, public nextCount: number) {
        super(`Il nuovo file contiene ${nextCount} confezioni, meno del 90% delle ${previousCount} locali. Catalogo conservato.`, 409);
    }
}

let active = false;

export function acquireAifaCatalogOperation(): () => void {
    if (active) throw new AifaUpdateError('Operazione AIFA già in corso', 409);
    active = true;
    return () => { active = false; };
}
