import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { Product, ReorderReport } from "./types";

export const defaultApiBaseUrl =
  window.location.protocol === "file:"
    ? "http://127.0.0.1:4000/api"
    : "http://localhost:4000/api";

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? defaultApiBaseUrl;

export const moneyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 2,
});

export const posMoneyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export const datetimeFormatter = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "short",
  timeStyle: "short",
});

export function formatProductLabel(name: string, commercialName?: string | null): string {
  const normalizedCommercialName = commercialName?.trim() ?? "";
  return normalizedCommercialName ? `${name} (${normalizedCommercialName})` : name;
}

export function productKindLabel(kind: Product["kind"]): string {
  if (kind === "MEDICAL_SUPPLY") {
    return "Material quirurgico";
  }
  if (kind === "MEDICAL_SERVICE") {
    return "Servicio medico";
  }
  return "Medicamento";
}

export function defaultCategoryForKind(kind: Product["kind"]): string {
  if (kind === "MEDICAL_SUPPLY") {
    return "Material quirurgico";
  }
  if (kind === "MEDICAL_SERVICE") {
    return "Servicio medico";
  }
  return "Medicamento";
}

export function defaultUnitForKind(kind: Product["kind"]): string {
  if (kind === "MEDICAL_SUPPLY") {
    return "pieza";
  }
  if (kind === "MEDICAL_SERVICE") {
    return "servicio";
  }
  return "caja";
}

export function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeSkuToken(value: string): string {
  return stripDiacritics(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function skuPrefixForKind(kind: Product["kind"]): string {
  if (kind === "MEDICAL_SUPPLY") {
    return "INS";
  }
  if (kind === "MEDICAL_SERVICE") {
    return "SER";
  }
  return "MED";
}

export function generateSkuSuggestion(name: string, kind: Product["kind"]): string {
  const tokens = stripDiacritics(name)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return "";
  }

  const stem = [tokens[0]?.slice(0, 4), tokens[1]?.slice(0, 3), tokens[2]?.slice(0, 3)]
    .filter(Boolean)
    .join("-");

  return normalizeSkuToken(`${skuPrefixForKind(kind)}-${stem}`);
}

export function normalizeText(value: string): string {
  return value.toLowerCase().trim();
}

export function localDateTimeValue(date: Date): string {
  const localTimestamp = date.getTime() - date.getTimezoneOffset() * 60_000;
  return new Date(localTimestamp).toISOString().slice(0, 16);
}

export function localDateValue(date: Date): string {
  const localTimestamp = date.getTime() - date.getTimezoneOffset() * 60_000;
  return new Date(localTimestamp).toISOString().slice(0, 10);
}

export function parseIntSafe(value: string, fallback = 0): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function parseFloatSafe(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function roundToPosAmount(value: number): number {
  return Math.floor(Math.max(0, value));
}

export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch {
    throw new Error(
      "No fue posible conectar con la API local. Reinicia la app de escritorio de Farmacia e intenta de nuevo.",
    );
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: "Error de red" }));
    throw new Error(body.message ?? "No se pudo completar la solicitud.");
  }

  return (await response.json()) as T;
}

export function exportRestockReportPdf(report: ReorderReport): void {
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "a4",
  });

  const generatedAtText = datetimeFormatter.format(new Date(report.generatedAt));
  const rangeFromText = report.range.from.slice(0, 10);
  const rangeToText = report.range.to.slice(0, 10);

  doc.setFontSize(16);
  doc.text("Reporte De Surtido (Medicamento Y Material Quirurgico)", 40, 40);
  doc.setFontSize(10);
  doc.text(`Generado: ${generatedAtText}`, 40, 58);
  doc.text(`Rango: ${rangeFromText} al ${rangeToText}`, 40, 74);
  doc.text(
    `Dias analizados: ${report.periodDays} | Cobertura deseada: ${report.coverageDays}`,
    40,
    90,
  );
  doc.text(
    `Productos a surtir: ${report.totalItems} | Unidades sugeridas: ${report.totalUnitsSuggested}`,
    40,
    106,
  );

  const bodyRows =
    report.items.length > 0
      ? report.items.map((item, index) => [
          String(index + 1),
          String(item.productId),
          item.sku,
          formatProductLabel(item.name, item.commercialName),
          item.category ?? "-",
          String(item.stock),
          String(item.minStock),
          String(item.targetStock),
          String(item.suggestedOrder),
          item.dailyVelocity.toFixed(2),
          item.priority,
        ])
      : [["-", "-", "-", "Sin productos para surtir", "-", "-", "-", "-", "-", "-", "-"]];

  autoTable(doc, {
    startY: 122,
    head: [["#", "ID", "SKU", "Producto", "Categoria", "Stock", "Min", "Objetivo", "Sugerido", "Vel/Dia", "Prioridad"]],
    body: bodyRows,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [11, 111, 144] },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 34 },
      2: { cellWidth: 92 },
      3: { cellWidth: 170 },
      4: { cellWidth: 86 },
      5: { cellWidth: 40 },
      6: { cellWidth: 34 },
      7: { cellWidth: 52 },
      8: { cellWidth: 54 },
      9: { cellWidth: 50 },
      10: { cellWidth: 56 },
    },
    didDrawPage: ({ pageNumber }) => {
      doc.setFontSize(9);
      doc.text(
        `Pagina ${pageNumber}`,
        doc.internal.pageSize.getWidth() - 90,
        doc.internal.pageSize.getHeight() - 16,
      );
    },
  });

  const fileDate = new Date().toISOString().slice(0, 10);
  doc.save(`reporte-surtido-${fileDate}.pdf`);
}
