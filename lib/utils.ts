import { decodeTaxCodeDigits, isValidItalianTaxCode } from './patient-identity';
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function estimateBirthYearFromTaxCode(taxCode: string, identifierType: string = 'cf'): number | null {
  if (identifierType !== 'cf' || !isValidItalianTaxCode(taxCode)) return null;
  const yy = Number(decodeTaxCodeDigits(taxCode.trim().toUpperCase().slice(6, 8)));
  const year = 2000 + yy;
  return year > new Date().getFullYear() ? year - 100 : year;
}