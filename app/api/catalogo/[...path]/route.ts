import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const catalogOrigin = process.env.NEXT_PUBLIC_JUDICIAL_CATALOG_API_URL?.trim()
  || "https://catalogo-judicial-api.sebastiancharpentier.workers.dev";

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const endpoint = path.join("/");
  const allowedEndpoint = endpoint === "cobertura"
    || endpoint === "jurisdicciones"
    || endpoint === "organismos"
    || (endpoint.startsWith("organismos/") && !endpoint.slice("organismos/".length).includes("/"));

  if (!allowedEndpoint) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const upstreamUrl = new URL(`/api/v1/${path.map(encodeURIComponent).join("/")}`, catalogOrigin);
  upstreamUrl.search = request.nextUrl.search;

  try {
    const upstream = await fetch(upstreamUrl, { method: "GET", cache: "no-store" });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "catalog_unavailable" }, { status: 502 });
  }
}
