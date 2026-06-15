import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "Needs review";
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 0
  }).format(Number(value));
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "Needs review";
  return new Intl.DateTimeFormat("en-PK", { dateStyle: "medium" }).format(new Date(value));
}
