const HEADERS = { "Cache-Control": "no-store" };

export function loader() {
  return Response.json({ version: __APP_VERSION__ }, { headers: HEADERS });
}
