import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function estimateBirthYearFromTaxCode(taxCode: string): number | null {
  if (!taxCode || taxCode.length !== 16) return null;

  const yearPart = taxCode.substring(6, 8);
  if (!/^\d{2}$/.test(yearPart)) return null;

  const yy = parseInt(yearPart, 10);
  const currentYear = new Date().getFullYear();

  // Pivot logic: if 20xx is in the future, assume 19xx.
  // This simple heuristic works for classic tax codes.
  // Note: This doesn't account for "Omocodia" where digits are replaced by letters,
  // but the prompt asked for estimation based on 7th and 8th chars which are year digits.
  // If they are letters due to omocodia, this will return null (safe).

  let fullYear = 2000 + yy;
  if (fullYear > currentYear) {
    fullYear -= 100;
  }

  return fullYear;
}

export function calculateAge(birthYear: number): number {
  const currentYear = new Date().getFullYear();
  return currentYear - birthYear;
}
