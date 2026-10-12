export type CatalogJurisdiction = {
  id: string;
  code: string;
  name: string;
  level: string;
  parentId: string | null;
  organizationCount: number;
};

export type CatalogOrganization = {
  id: string;
  officialName: string;
  organizationType: string;
  branch: string | null;
  instance: string | null;
  power: string | null;
  jurisdictionId: string | null;
  jurisdictionName: string | null;
  provinceCode: string | null;
  provinceName: string | null;
  region: string | null;
  judicialDistrict: string | null;
  locality: string | null;
  number?: string | null;
  sourceRecordId?: string | null;
  sourceHierarchy?: string[];
  missingFields?: string[];
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  parentOrganizationId: string | null;
  parentOrganizationName?: string | null;
  status: string;
  sourceLastVerifiedAt: string | null;
};

export type CatalogPage = {
  data: CatalogOrganization[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
};

export type CatalogCoverage = {
  totalOrganizations: number;
  jurisdictions: Array<{
    jurisdictionId: string;
    jurisdictionName: string;
    organizationCount: number;
  }>;
  sources: Array<{
    id: string;
    name: string;
    reviewStatus: string;
    lastCheckedAt: string | null;
    lastImportedAt: string | null;
  }>;
  generatedAt: string;
};

export type CatalogFilters = {
  q?: string;
  jurisdictionId?: string;
  province?: string;
  region?: string;
  branch?: string;
  type?: string;
  locality?: string;
  page?: number;
  pageSize?: number;
};

export function getCatalogApiUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_JUDICIAL_CATALOG_API_URL?.trim()
    || "https://catalogo-judicial-api.sebastiancharpentier.workers.dev";
  return value ? value.replace(/\/$/, "") : null;
}

export async function requestCatalog<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (!getCatalogApiUrl()) throw new Error("La API del Catálogo Judicial todavía no está configurada.");
  const response = await fetch(`/api/catalogo${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(response.status === 503
      ? "El catálogo no está disponible en este momento."
      : "No se pudo consultar el Catálogo Judicial.");
  }
  return response.json() as Promise<T>;
}
