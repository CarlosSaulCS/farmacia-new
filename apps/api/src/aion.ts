import { config } from "./config.js";

export type PriceAdjustmentSuggestion = {
  productId: number;
  productName?: string;
  suggestedPrice: number;
  reason: string;
  confidence: number;
  currentCost?: number;
  currentPrice?: number;
  marginPct?: number;
  trigger?: "manual" | "monthly-cutoff" | "cost-increase";
  source: "aion" | "local";
};

function buildAionUrl(route: string): string {
  const base = config.aionUrl.endsWith("/")
    ? config.aionUrl.slice(0, -1)
    : config.aionUrl;
  const path = route.startsWith("/") ? route : `/${route}`;
  return `${base}${path}`;
}

async function postToAion<T>(route: string, payload: unknown): Promise<T | null> {
  if (!config.aionUrl) {
    return null;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.aionApiKey) {
    headers.Authorization = `Bearer ${config.aionApiKey}`;
  }

  try {
    const response = await fetch(buildAionUrl(route), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`AION respondio con estado ${response.status}`);
      return null;
    }

    return (await response.json()) as T;
  } catch (error) {
    console.error("No fue posible consultar AION:", error);
    return null;
  }
}

export async function requestAionPriceAdjustments(
  payload: unknown,
): Promise<PriceAdjustmentSuggestion[] | null> {
  const response = await postToAion<{ suggestions?: PriceAdjustmentSuggestion[] }>(
    "/api/price-adjustments",
    payload,
  );

  if (!response || !Array.isArray(response.suggestions)) {
    return null;
  }

  return response.suggestions;
}

export async function requestAionBusinessInsights(
  payload: unknown,
): Promise<string[] | null> {
  const response = await postToAion<{ insights?: string[] }>(
    "/api/business-insights",
    payload,
  );

  if (!response || !Array.isArray(response.insights)) {
    return null;
  }

  return response.insights;
}
