export function syntheticTaxCode(seed: number | string = 1): string {
    let hash = typeof seed === 'number' ? seed : [...seed].reduce((value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) >>> 0, 0);
    let letters = '';
    for (let i = 0; i < 6; i++) { letters += String.fromCharCode(65 + hash % 26); hash = Math.floor(hash / 26); }
    const partial = `${letters}80A01H501`;
    const odd = 'BAFHJNPRTVCESULDGIMOQKWZYX';
    let sum = 0;
    for (let i = 0; i < partial.length; i++) {
        const char = partial[i];
        const value = /[0-9]/.test(char) ? Number(char) : char.charCodeAt(0) - 65;
        sum += i % 2 === 0 ? odd.charCodeAt(value) - 65 : value;
    }
    return partial + String.fromCharCode(65 + sum % 26);
}
