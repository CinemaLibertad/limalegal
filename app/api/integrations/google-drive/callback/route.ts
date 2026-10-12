import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const publicOrigin = "https://limalegal.com.ar";

export function GET(request: NextRequest) {
  const url = new URL("/panel/configuracion", publicOrigin);
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");

  if (error || !code || !state) {
    url.searchParams.set("google_drive_error", "authorization_failed");
  } else {
    url.searchParams.set("google_drive_code", code);
    url.searchParams.set("google_drive_state", state);
  }

  const response = NextResponse.redirect(url, 303);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
