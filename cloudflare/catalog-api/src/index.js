const API_PREFIX = "/api/v1";
const CACHE_VERSION = "catalog-2026-10-11-import-1";
const ALLOWED_ORIGINS = new Set([
  "https://limalegal--lima-legal.us-east4.hosted.app",
  "https://limalegal.com.ar",
  "https://www.limalegal.com.ar",
  "http://localhost:3000",
]);

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function withCors(response, origin) {
  const headers = new Headers(response.headers);
  headers.set("Vary", "Origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "86400");
  }
  return new Response(response.body, { status: response.status, headers });
}

function boundedText(value, max = 120) {
  return (value || "").trim().slice(0, max);
}

function buildFtsQuery(input) {
  const terms = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-AR")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8)
    .map((term) => `"${term.replaceAll('"', '""')}"*`);
  return terms.join(" AND ");
}

function integerParam(value, fallback, min, max) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function addFilter(clauses, values, column, value) {
  if (value) {
    clauses.push(`${column} = ?`);
    values.push(value);
  }
}

async function all(db, sql, values = []) {
  const result = await db.prepare(sql).bind(...values).all();
  return result.results || [];
}

async function first(db, sql, values = []) {
  return db.prepare(sql).bind(...values).first();
}

async function listOrganizations(request, db) {
  const url = new URL(request.url);
  const q = boundedText(url.searchParams.get("q"), 120);
  const jurisdictionId = boundedText(url.searchParams.get("jurisdictionId"), 80);
  const province = boundedText(url.searchParams.get("province"), 100);
  const region = boundedText(url.searchParams.get("region"), 100);
  const branch = boundedText(url.searchParams.get("branch"), 80);
  const organizationType = boundedText(url.searchParams.get("type"), 80);
  const locality = boundedText(url.searchParams.get("locality"), 100);
  const page = integerParam(url.searchParams.get("page"), 1, 1, 200);
  const pageSize = integerParam(url.searchParams.get("pageSize"), 20, 1, 50);
  const offset = (page - 1) * pageSize;

  const clauses = [];
  const values = [];
  if (q) {
    if (/^\d+$/.test(q)) {
      clauses.push("o.catalog_number = ?");
      values.push(q);
    } else {
      const ftsQuery = buildFtsQuery(q);
      if (!ftsQuery) {
        return json({ data: [], page, pageSize, total: 0, hasMore: false });
      }
      clauses.push("o.id IN (SELECT organization_id FROM organization_search WHERE organization_search MATCH ?)");
      values.push(ftsQuery);
    }
  }
  addFilter(clauses, values, "o.jurisdiction_id", jurisdictionId);
  if (province) { clauses.push("LOWER(o.province_name) = LOWER(?)"); values.push(province); }
  if (region) { clauses.push("LOWER(o.region) = LOWER(?)"); values.push(region); }
  addFilter(clauses, values, "o.branch", branch);
  addFilter(clauses, values, "o.organization_type", organizationType);
  addFilter(clauses, values, "o.locality", locality);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const [countRow, records] = await Promise.all([
    first(db, `SELECT COUNT(*) AS total FROM organizations o ${where}`, values),
    all(
      db,
      `SELECT o.id, o.official_name AS officialName, o.organization_type AS organizationType,
        o.branch, o.instance, o.power, o.jurisdiction_id AS jurisdictionId,
        j.name AS jurisdictionName, o.province_code AS provinceCode,
        o.province_name AS provinceName, o.region,
        o.judicial_district AS judicialDistrict, o.locality,
        o.parent_organization_id AS parentOrganizationId, o.status,
        o.catalog_number AS number, o.source_record_id AS sourceRecordId,
        o.source_hierarchy_json AS sourceHierarchyJson, o.missing_fields_json AS missingFieldsJson,
        o.latitude, o.longitude,
        (SELECT c.value FROM organization_contacts c WHERE c.organization_id = o.id AND c.contact_type = 'address' AND c.is_current = 1 ORDER BY c.id LIMIT 1) AS address,
        o.source_last_verified_at AS sourceLastVerifiedAt
       FROM organizations o LEFT JOIN jurisdictions j ON j.id = o.jurisdiction_id
       ${where} ORDER BY o.official_name COLLATE NOCASE LIMIT ? OFFSET ?`,
      [...values, pageSize, offset],
    ),
  ]);
  const total = Number(countRow?.total || 0);
  return json({ data: records, page, pageSize, total, hasMore: offset + records.length < total });
}

async function getOrganization(id, db) {
  const organization = await first(
    db,
    `SELECT o.id, o.official_name AS officialName, o.organization_type AS organizationType,
      o.branch, o.instance, o.power, o.jurisdiction_id AS jurisdictionId,
      j.name AS jurisdictionName, o.province_code AS provinceCode,
      o.province_name AS provinceName, o.region,
      o.judicial_district AS judicialDistrict, o.locality,
      o.parent_organization_id AS parentOrganizationId, p.official_name AS parentOrganizationName,
      o.catalog_number AS number, o.source_record_id AS sourceRecordId,
      o.source_hierarchy_json AS sourceHierarchyJson, o.missing_fields_json AS missingFieldsJson,
      o.latitude, o.longitude,
      (SELECT c.value FROM organization_contacts c WHERE c.organization_id = o.id AND c.contact_type = 'address' AND c.is_current = 1 ORDER BY c.id LIMIT 1) AS address,
      o.status, o.source_last_verified_at AS sourceLastVerifiedAt,
      o.created_at AS createdAt, o.updated_at AS updatedAt
     FROM organizations o
     LEFT JOIN jurisdictions j ON j.id = o.jurisdiction_id
     LEFT JOIN organizations p ON p.id = o.parent_organization_id
     WHERE o.id = ? LIMIT 1`,
    [id],
  );
  if (!organization) return json({ error: "organization_not_found" }, 404);

  const [aliases, contacts, links, authorities, provenance, history] = await Promise.all([
    all(db, "SELECT alias, alias_type AS aliasType FROM organization_aliases WHERE organization_id = ? ORDER BY alias", [id]),
    all(db, `SELECT contact_type AS type, label, value, details, valid_from AS validFrom,
      valid_to AS validTo FROM organization_contacts WHERE organization_id = ? AND is_current = 1 ORDER BY contact_type, label`, [id]),
    all(db, `SELECT link_type AS type, label, url FROM organization_links
      WHERE organization_id = ? AND is_current = 1 ORDER BY link_type, label`, [id]),
    all(db, `SELECT person_name AS personName, role, started_on AS startedOn,
      ended_on AS endedOn, appointment_status AS status, source_url AS sourceUrl, verified_at AS verifiedAt
      FROM authority_appointments WHERE organization_id = ? ORDER BY started_on DESC, person_name`, [id]),
    all(db, `SELECT fp.field_path AS fieldPath, s.name AS sourceName, fp.source_url AS sourceUrl,
      fp.retrieved_at AS retrievedAt, fp.verified_at AS verifiedAt, fp.source_license AS sourceLicense
      FROM field_provenance fp LEFT JOIN sources s ON s.id = fp.source_id
      WHERE fp.entity_type = 'organization' AND fp.entity_id = ? ORDER BY fp.field_path, fp.retrieved_at DESC`, [id]),
    all(db, `SELECT field_path AS fieldPath, change_type AS changeType,
      old_value_json AS oldValue, new_value_json AS newValue, changed_at AS changedAt,
      actor_type AS actorType, source_url AS sourceUrl, review_note AS reviewNote
      FROM change_events WHERE entity_type = 'organization' AND entity_id = ?
      ORDER BY changed_at DESC LIMIT 100`, [id]),
  ]);
  return json({ data: {
    ...organization,
    sourceHierarchy: JSON.parse(organization.sourceHierarchyJson || "[]"),
    missingFields: JSON.parse(organization.missingFieldsJson || "[]"),
    aliases, contacts, links, authorities, provenance, history,
  } });
}

async function handleApi(request, env) {
  if (!env.CATALOG_DB) return json({ error: "catalog_database_not_bound" }, 503);
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(`${API_PREFIX}/`)) return json({ error: "not_found" }, 404);
  const route = pathname.slice(API_PREFIX.length).replace(/\/$/, "") || "/";

  if (route === "/health") {
    const result = await first(env.CATALOG_DB, "SELECT COUNT(*) AS organizationCount FROM organizations");
    return json({ status: "ok", organizationCount: Number(result?.organizationCount || 0) });
  }
  if (route === "/organismos") return listOrganizations(request, env.CATALOG_DB);
  if (route === "/jurisdicciones") {
    const data = await all(env.CATALOG_DB, `SELECT j.id, j.code, j.name, j.level,
      j.parent_id AS parentId, COUNT(o.id) AS organizationCount
      FROM jurisdictions j LEFT JOIN organizations o ON o.jurisdiction_id = j.id
      GROUP BY j.id ORDER BY j.name COLLATE NOCASE`);
    return json({ data });
  }
  if (route === "/fuentes") {
    const data = await all(env.CATALOG_DB, `SELECT id, name, publisher, source_url AS sourceUrl,
      format, license_name AS license, terms_url AS termsUrl, update_frequency AS updateFrequency,
      last_checked_at AS lastCheckedAt, last_imported_at AS lastImportedAt, review_status AS reviewStatus
      FROM sources ORDER BY name COLLATE NOCASE`);
    return json({ data });
  }
  if (route === "/cobertura") {
    const [summary, byJurisdiction, sources] = await Promise.all([
      first(env.CATALOG_DB, "SELECT COUNT(*) AS totalOrganizations FROM organizations"),
      all(env.CATALOG_DB, `SELECT j.id AS jurisdictionId, j.name AS jurisdictionName,
        COUNT(o.id) AS organizationCount
        FROM jurisdictions j LEFT JOIN organizations o ON o.jurisdiction_id = j.id
        GROUP BY j.id ORDER BY j.name COLLATE NOCASE`),
      all(env.CATALOG_DB, `SELECT id, name, review_status AS reviewStatus,
        last_checked_at AS lastCheckedAt, last_imported_at AS lastImportedAt FROM sources ORDER BY name`),
    ]);
    return json({
      totalOrganizations: Number(summary?.totalOrganizations || 0),
      jurisdictions: byJurisdiction,
      sources,
      generatedAt: new Date().toISOString(),
    });
  }
  const match = route.match(/^\/organismos\/([^/]+)$/);
  if (match) return getOrganization(decodeURIComponent(match[1]), env.CATALOG_DB);
  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), origin);
    }
    if (request.method !== "GET") {
      return withCors(json({ error: "method_not_allowed" }, 405, { Allow: "GET, OPTIONS" }), origin);
    }

    const cache = caches.default;
    const cacheUrl = new URL(request.url);
    cacheUrl.searchParams.set("_catalogCache", CACHE_VERSION);
    const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
    const cached = await cache.match(cacheKey);
    if (cached) return withCors(cached, origin);

    try {
      const response = await handleApi(request, env);
      if (response.status === 200) ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return withCors(response, origin);
    } catch {
      return withCors(json({ error: "catalog_query_failed" }, 500, { "Cache-Control": "no-store" }), origin);
    }
  },
};
