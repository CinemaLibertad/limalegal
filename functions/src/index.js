const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { createCipheriv, createDecipheriv, createHash, randomBytes } = require("node:crypto");

const juridicaApiKey = defineSecret("JURIDICA_API_KEY");
const oneDriveClientSecret = defineSecret("ONEDRIVE_CLIENT_SECRET");
const oneDriveTokenEncryptionKey = defineSecret("ONEDRIVE_TOKEN_ENCRYPTION_KEY");
const googleDriveOAuthCredentials = defineSecret("GOOGLE_DRIVE_OAUTH_CREDENTIALS");
const studioId = "lima-legal";
const appOrigins = [
  "https://limalegal--lima-legal.us-east4.hosted.app",
  "https://limalegal.com.ar",
  "https://www.limalegal.com.ar",
];
const oneDriveClientId = "efd07482-a827-4c12-9b15-3fe543d280c3";
const oneDriveRedirectUri = "https://limalegal.com.ar/api/integrations/onedrive/callback";
const oneDriveScopes = "openid profile offline_access User.Read Files.ReadWrite.AppFolder";
const googleDriveRedirectUri = "https://limalegal.com.ar/api/integrations/google-drive/callback";
const googleDriveScopes = "openid email profile https://www.googleapis.com/auth/drive.file";
const allowedEmail = "sebastiancharpentier@gmail.com";
const officialHosts = ["saij.gob.ar", "csjn.gov.ar", "scba.gov.ar"];
const acceptedSearchTypes = new Set(["jurisprudencia", "fallo", "sumario", "legislacion", "ley", "decreto", "doctrina", "dictamen", "todo"]);
let toolSchemaCache = null;

if (!getApps().length) initializeApp();
const adminDb = getFirestore();

function requireOneDriveUser(request) {
  requireAuthorized(request);
  if (request.auth.token.email !== allowedEmail) {
    throw new HttpsError("permission-denied", "La cuenta no está autorizada para administrar el almacenamiento.");
  }
  return request.auth.uid;
}

function encryptOneDriveToken(token) {
  const key = Buffer.from(oneDriveTokenEncryptionKey.value(), "base64");
  if (key.length !== 32) throw new HttpsError("failed-precondition", "La clave de cifrado de OneDrive no está configurada correctamente.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

exports.startOneDriveOAuth = onCall({ region: "southamerica-east1", maxInstances: 2, cors: appOrigins }, async (request) => {
  const uid = requireOneDriveUser(request);
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  await adminDb.doc(`studios/${studioId}/oneDriveOAuthStates/${state}`).set({
    uid, codeVerifier, createdAt: FieldValue.serverTimestamp(), expiresAt: Date.now() + 10 * 60 * 1000,
  });
  const authorize = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  authorize.search = new URLSearchParams({
    client_id: oneDriveClientId,
    response_type: "code",
    redirect_uri: oneDriveRedirectUri,
    response_mode: "query",
    scope: oneDriveScopes,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { authorizationUrl: authorize.toString() };
});

exports.completeOneDriveOAuth = onCall(
  { region: "southamerica-east1", secrets: [oneDriveClientSecret, oneDriveTokenEncryptionKey], timeoutSeconds: 30, maxInstances: 2, cors: appOrigins },
  async (request) => {
    const uid = requireOneDriveUser(request);
    const code = typeof request.data?.code === "string" ? request.data.code : "";
    const state = typeof request.data?.state === "string" ? request.data.state : "";
    if (!code || code.length > 4096 || !/^[A-Za-z0-9_-]{32,128}$/.test(state)) throw new HttpsError("invalid-argument", "La respuesta OAuth no es válida.");

    const stateRef = adminDb.doc(`studios/${studioId}/oneDriveOAuthStates/${state}`);
    const stateSnapshot = await stateRef.get();
    const stateData = stateSnapshot.data();
    if (!stateSnapshot.exists || stateData.uid !== uid || stateData.expiresAt < Date.now()) {
      if (stateSnapshot.exists) await stateRef.delete();
      throw new HttpsError("permission-denied", "La autorización venció o no corresponde a esta sesión. Volvé a conectar OneDrive.");
    }

    let tokenResponse;
    try {
      const response = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: oneDriveClientId,
          client_secret: oneDriveClientSecret.value(),
          grant_type: "authorization_code",
          code,
          code_verifier: stateData.codeVerifier,
          redirect_uri: oneDriveRedirectUri,
          scope: oneDriveScopes,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("token exchange rejected");
      tokenResponse = await response.json();
    } catch {
      throw new HttpsError("failed-precondition", "Microsoft no pudo completar la conexión. Revisá el permiso y volvé a intentarlo.");
    }

    if (typeof tokenResponse.refresh_token !== "string" || typeof tokenResponse.access_token !== "string") {
      throw new HttpsError("failed-precondition", "Microsoft no devolvió credenciales renovables. Volvé a autorizar el acceso solicitado.");
    }

    let accountLabel = null;
    try {
      const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName", {
        headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (profileResponse.ok) {
        const profile = await profileResponse.json();
        accountLabel = profile.mail || profile.userPrincipalName || profile.displayName || null;
      }
    } catch { /* The connection remains valid without a display label. */ }

    const encrypted = encryptOneDriveToken(tokenResponse.refresh_token);
    await adminDb.doc(`studios/${studioId}/integrations/onedrive`).set({
      provider: "microsoft-onedrive",
      accountLabel,
      encryptedRefreshToken: encrypted,
      grantedScopes: tokenResponse.scope || oneDriveScopes,
      connectedBy: uid,
      connectedAt: FieldValue.serverTimestamp(),
      status: "connected",
    });
    await stateRef.delete();
    return { connected: true, accountLabel };
  },
);

exports.getOneDriveStatus = onCall({ region: "southamerica-east1", maxInstances: 2, cors: appOrigins }, async (request) => {
  requireOneDriveUser(request);
  const snapshot = await adminDb.doc(`studios/${studioId}/integrations/onedrive`).get();
  if (!snapshot.exists || snapshot.data().status !== "connected") return { connected: false };
  const data = snapshot.data();
  return { connected: true, accountLabel: data.accountLabel || null, connectedAt: data.connectedAt?.toDate?.().toISOString() || null };
});

exports.disconnectOneDrive = onCall({ region: "southamerica-east1", maxInstances: 2, cors: appOrigins }, async (request) => {
  requireOneDriveUser(request);
  await adminDb.doc(`studios/${studioId}/integrations/onedrive`).delete();
  return { connected: false };
});

exports.createOneDriveUploadSession = onCall(
  { region: "southamerica-east1", secrets: [oneDriveClientSecret, oneDriveTokenEncryptionKey], timeoutSeconds: 30, maxInstances: 2, cors: appOrigins },
  async (request) => {
    const uid = requireOneDriveUser(request);
    const name = typeof request.data?.name === "string" ? request.data.name.trim() : "";
    const size = request.data?.size;
    if (!name || name.length > 255 || /[\\/\u0000-\u001f]/.test(name) || !Number.isSafeInteger(size) || size < 0 || size > 250 * 1024 * 1024) {
      throw new HttpsError("invalid-argument", "El nombre o tamaño del archivo no es válido (máximo 250 MB).");
    }
    const integrationRef = adminDb.doc(`studios/${studioId}/integrations/onedrive`);
    const integration = (await integrationRef.get()).data();
    if (!integration || integration.status !== "connected" || integration.connectedBy !== uid || !integration.encryptedRefreshToken) {
      throw new HttpsError("failed-precondition", "Conectá OneDrive desde Configuración antes de guardar documentos.");
    }
    let tokenResponse;
    try {
      const response = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: oneDriveClientId,
          client_secret: oneDriveClientSecret.value(),
          grant_type: "refresh_token",
          refresh_token: decryptGoogleDriveToken(integration.encryptedRefreshToken),
          scope: oneDriveScopes,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("token renewal rejected");
      tokenResponse = await response.json();
    } catch {
      throw new HttpsError("failed-precondition", "La autorización de OneDrive venció. Volvé a conectar la cuenta.");
    }
    const uploadResponse = await fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${encodeURIComponent(name)}:/createUploadSession`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenResponse.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename", name } }),
      signal: AbortSignal.timeout(15000),
    });
    const uploadUrl = (await uploadResponse.json().catch(() => ({}))).uploadUrl;
    if (!uploadResponse.ok || typeof uploadUrl !== "string" || !uploadUrl.startsWith("https://")) {
      throw new HttpsError("unavailable", "Microsoft no pudo iniciar la carga en OneDrive.");
    }
    return { uploadUrl };
  },
);

function decryptGoogleDriveToken(encrypted) {
  const key = Buffer.from(oneDriveTokenEncryptionKey.value(), "base64");
  if (key.length !== 32) throw new HttpsError("failed-precondition", "La clave de cifrado de integraciones no está configurada correctamente.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function getGoogleDriveOAuthCredentials() {
  try {
    const parsed = JSON.parse(googleDriveOAuthCredentials.value());
    const credentials = parsed.web || parsed.installed;
    if (typeof credentials?.client_id !== "string" || typeof credentials?.client_secret !== "string") throw new Error("invalid credentials");
    return credentials;
  } catch {
    throw new HttpsError("failed-precondition", "Las credenciales OAuth de Google Drive no están configuradas correctamente.");
  }
}

async function getGoogleDriveAccessToken(uid) {
  const credentials = getGoogleDriveOAuthCredentials();
  const integrationRef = adminDb.doc(`studios/${studioId}/integrations/google-drive`);
  const snapshot = await integrationRef.get();
  const integration = snapshot.data();
  if (!snapshot.exists || integration.status !== "connected" || integration.connectedBy !== uid || !integration.encryptedRefreshToken) {
    throw new HttpsError("failed-precondition", "Conectá Google Drive desde Configuración antes de guardar documentos.");
  }

  let response;
  try {
    response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        grant_type: "refresh_token",
        refresh_token: decryptGoogleDriveToken(integration.encryptedRefreshToken),
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new HttpsError("unavailable", "No se pudo renovar el acceso a Google Drive.");
  }
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) {
      await integrationRef.update({ status: "reauthorization-required" });
      throw new HttpsError("failed-precondition", "La autorización de Google Drive venció. Volvé a conectar la cuenta.");
    }
    throw new HttpsError("unavailable", "Google Drive no pudo renovar la autorización.");
  }
  const token = await response.json();
  if (typeof token.access_token !== "string") throw new HttpsError("unavailable", "Google no devolvió un token de acceso válido.");
  return token.access_token;
}

exports.startGoogleDriveOAuth = onCall(
  { region: "southamerica-east1", secrets: [googleDriveOAuthCredentials], maxInstances: 2, cors: appOrigins },
  async (request) => {
    const uid = requireOneDriveUser(request);
    const credentials = getGoogleDriveOAuthCredentials();
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    await adminDb.doc(`studios/${studioId}/googleDriveOAuthStates/${state}`).set({
      uid, codeVerifier, createdAt: FieldValue.serverTimestamp(), expiresAt: Date.now() + 10 * 60 * 1000,
    });
    const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorize.search = new URLSearchParams({
      client_id: credentials.client_id,
      redirect_uri: googleDriveRedirectUri,
      response_type: "code",
      scope: googleDriveScopes,
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent select_account",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    return { authorizationUrl: authorize.toString() };
  },
);

exports.completeGoogleDriveOAuth = onCall(
  { region: "southamerica-east1", secrets: [googleDriveOAuthCredentials, oneDriveTokenEncryptionKey], timeoutSeconds: 30, maxInstances: 2, cors: appOrigins },
  async (request) => {
    const uid = requireOneDriveUser(request);
    const credentials = getGoogleDriveOAuthCredentials();
    const code = typeof request.data?.code === "string" ? request.data.code : "";
    const state = typeof request.data?.state === "string" ? request.data.state : "";
    if (!code || code.length > 4096 || !/^[A-Za-z0-9_-]{32,128}$/.test(state)) throw new HttpsError("invalid-argument", "La respuesta OAuth de Google no es válida.");

    const stateRef = adminDb.doc(`studios/${studioId}/googleDriveOAuthStates/${state}`);
    const stateSnapshot = await stateRef.get();
    const stateData = stateSnapshot.data();
    if (!stateSnapshot.exists || stateData.uid !== uid || stateData.expiresAt < Date.now()) {
      if (stateSnapshot.exists) await stateRef.delete();
      throw new HttpsError("permission-denied", "La autorización venció o no corresponde a esta sesión. Volvé a conectar Google Drive.");
    }

    let tokenResponse;
    try {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: credentials.client_id,
          client_secret: credentials.client_secret,
          grant_type: "authorization_code",
          code,
          code_verifier: stateData.codeVerifier,
          redirect_uri: googleDriveRedirectUri,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("token exchange rejected");
      tokenResponse = await response.json();
    } catch {
      throw new HttpsError("failed-precondition", "Google no pudo completar la conexión. Revisá la configuración OAuth y volvé a intentarlo.");
    }
    if (typeof tokenResponse.refresh_token !== "string" || typeof tokenResponse.access_token !== "string") {
      throw new HttpsError("failed-precondition", "Google no devolvió credenciales renovables. Volvé a autorizar el acceso solicitado.");
    }

    let profile;
    try {
      const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!profileResponse.ok) throw new Error("profile unavailable");
      profile = await profileResponse.json();
    } catch {
      throw new HttpsError("unavailable", "No se pudo confirmar la cuenta de Google autorizada.");
    }

    const existingRootResponse = await fetch("https://www.googleapis.com/drive/v3/files?q=mimeType%3D'application%2Fvnd.google-apps.folder'%20and%20appProperties%20has%20%7B%20key%3D'bernabeStudioFolder'%20and%20value%3D'root'%20%7D%20and%20trashed%3Dfalse&fields=files(id,name)&pageSize=1", {
      headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!existingRootResponse.ok) throw new HttpsError("unavailable", "No se pudo consultar la carpeta del estudio en Google Drive.");
    const existingRoots = await existingRootResponse.json();
    let rootFolder = existingRoots.files?.[0];
    if (!rootFolder) {
      const rootResponse = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType", {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenResponse.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Estudio Jurídico", mimeType: "application/vnd.google-apps.folder", appProperties: { bernabeStudioFolder: "root" } }),
        signal: AbortSignal.timeout(15000),
      });
      if (!rootResponse.ok) throw new HttpsError("unavailable", "No se pudo preparar la carpeta de documentos en Google Drive.");
      rootFolder = await rootResponse.json();
    }
    const encrypted = encryptOneDriveToken(tokenResponse.refresh_token);
    await adminDb.doc(`studios/${studioId}/integrations/google-drive`).set({
      provider: "google-drive",
      accountLabel: typeof profile.email === "string" ? profile.email : null,
      rootFolderId: rootFolder.id,
      encryptedRefreshToken: encrypted,
      grantedScopes: tokenResponse.scope || googleDriveScopes,
      connectedBy: uid,
      connectedAt: FieldValue.serverTimestamp(),
      status: "connected",
    });
    await stateRef.delete();
    return { connected: true, accountLabel: typeof profile.email === "string" ? profile.email : null };
  },
);

exports.getGoogleDriveStatus = onCall({ region: "southamerica-east1", maxInstances: 2, cors: appOrigins }, async (request) => {
  requireOneDriveUser(request);
  const snapshot = await adminDb.doc(`studios/${studioId}/integrations/google-drive`).get();
  if (!snapshot.exists || snapshot.data().status !== "connected") return { connected: false };
  const data = snapshot.data();
  return { connected: true, accountLabel: data.accountLabel || null, connectedAt: data.connectedAt?.toDate?.().toISOString() || null };
});

exports.disconnectGoogleDrive = onCall({ region: "southamerica-east1", maxInstances: 2, cors: appOrigins }, async (request) => {
  requireOneDriveUser(request);
  await adminDb.doc(`studios/${studioId}/integrations/google-drive`).delete();
  return { connected: false };
});

exports.createGoogleDriveUploadSession = onCall(
  { region: "southamerica-east1", secrets: [googleDriveOAuthCredentials, oneDriveTokenEncryptionKey], timeoutSeconds: 30, maxInstances: 2, cors: appOrigins },
  async (request) => {
    const uid = requireOneDriveUser(request);
    const credentials = getGoogleDriveOAuthCredentials();
    const name = typeof request.data?.name === "string" ? request.data.name.trim() : "";
    const mimeType = typeof request.data?.mimeType === "string" ? request.data.mimeType.trim() : "";
    const size = request.data?.size;
    if (!name || name.length > 255 || /[\\/\u0000-\u001f]/.test(name) || !mimeType || mimeType.length > 200 || !Number.isSafeInteger(size) || size < 0 || size > 5 * 1024 * 1024 * 1024 * 1024) {
      throw new HttpsError("invalid-argument", "El nombre, tipo o tamaño del archivo no es válido.");
    }
  const integration = (await adminDb.doc(`studios/${studioId}/integrations/google-drive`).get()).data();
    if (!integration?.rootFolderId) throw new HttpsError("failed-precondition", "Conectá Google Drive antes de guardar documentos.");
    const accessToken = await getGoogleDriveAccessToken(uid);
    let response;
    try {
      response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,webViewLink", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mimeType,
          "X-Upload-Content-Length": String(size),
        },
        body: JSON.stringify({ name, mimeType, parents: [integration.rootFolderId] }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new HttpsError("unavailable", "No se pudo iniciar la carga en Google Drive.");
    }
    const uploadUrl = response.headers.get("Location");
    if (!response.ok || !uploadUrl || !uploadUrl.startsWith("https://www.googleapis.com/upload/drive/")) {
      throw new HttpsError("unavailable", "Google Drive no devolvió una sesión de carga válida.");
    }
    return { uploadUrl };
  },
);

function optionalString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizeSource(value) {
  if (typeof value !== "string") return null;
  const source = value.toLowerCase();
  if (source.includes("saij")) return "SAIJ";
  if (source.includes("csjn") || source.includes("corte suprema de justicia de la nación")) return "CSJN";
  if (source.includes("juba") || source.includes("buenos aires") || source.includes("scba")) return "JUBA";
  return null;
}

function officialUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const isOfficial = url.protocol === "https:" && officialHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
    return isOfficial ? url.toString() : null;
  } catch { return null; }
}

function normalizeResult(item) {
  item = item && typeof item === "object" ? item : {};
  const source = [item.source, item.fuente, item.sourceName, item.source_name, item.database, item.base]
    .map((value) => value && typeof value === "object" ? value.name || value.title || value.id : value)
    .map((value) => normalizeSource(value)).find(Boolean) || null;
  return {
    providerId: optionalString(item.uuid, item.id, item.caseId, item.case_id, item.falloId, item.fallo_id, item.identifier),
    source,
    type: optionalString(item.type, item.tipo, item.documentType, item.document_type),
    title: optionalString(item.title, item.titulo, item.caratula, item.caption),
    caption: optionalString(item.caratula, item.caption, item.title, item.titulo),
    court: optionalString(item.court, item.tribunal, item.courtName, item.court_name),
    decisionDate: optionalString(item.decisionDate, item.decision_date, item.fecha, item.date),
    jurisdiction: optionalString(item.jurisdiction, item.jurisdiccion, item.jurisdictionName),
    text: optionalString(item.fullText, item.full_text, item.text, item.texto, item.content, item.sumario, item.excerpt, item.snippet),
    officialUrl: officialUrl(item.officialUrl || item.official_url || item.sourceUrl || item.source_url || item.url || item.link),
  };
}

function parseResponseBody(text) {
  if (!text) return null;
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* Streamable HTTP may wrap JSON-RPC in SSE. */ }
  const dataLines = trimmed.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
  for (const line of dataLines.reverse()) {
    try { return JSON.parse(line); } catch { /* Ignore non-JSON keepalive frames. */ }
  }
  return null;
}

async function postMcp(body, apiKey, sessionId) {
  let response;
  try {
    response = await fetch("https://juridica.ar/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(body.method === "initialize" ? {} : { "MCP-Protocol-Version": "2025-11-25" }),
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(9000),
    });
  } catch {
    throw new HttpsError("unavailable", "No se pudo conectar con el servicio de jurisprudencia.");
  }
  const responseSession = response.headers.get("Mcp-Session-Id") || sessionId || null;
  const text = response.status === 202 ? "" : await response.text();
  const parsed = parseResponseBody(text);
  if (!response.ok) {
    const status = response.status === 401 ? "La clave del proveedor fue rechazada." : response.status === 429 ? "Se alcanzó el límite diario del proveedor." : "El proveedor no pudo completar la consulta.";
    throw new HttpsError(response.status === 401 ? "failed-precondition" : response.status === 429 ? "resource-exhausted" : "unavailable", status);
  }
  return { data: parsed, sessionId: responseSession };
}

async function connectMcp(apiKey) {
  const initialized = await postMcp({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: {
      protocolVersion: "2025-11-25", capabilities: {},
      clientInfo: { name: "bernabe-estudio-juridico", version: "0.1.0" },
    },
  }, apiKey, null);
  if (initialized.data?.error) throw new HttpsError("unavailable", "No se pudo iniciar la conexión de búsqueda jurídica.");

  await postMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, apiKey, initialized.sessionId);

  if (!toolSchemaCache) {
    const listed = await postMcp({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, apiKey, initialized.sessionId);
    const tools = listed.data?.result?.tools;
    if (!Array.isArray(tools)) throw new HttpsError("data-loss", "El proveedor no devolvió el contrato de herramientas esperado.");
    toolSchemaCache = tools;
  }
  return initialized.sessionId;
}

function makeSearchArguments(tool, query, type, offset) {
  const schema = tool.inputSchema || {};
  const properties = schema.properties || {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const args = {};
  const names = Object.keys(properties);
  const queryName = names.find((name) => ["query", "q", "search", "searchQuery", "search_query", "term", "terms", "text", "texto", "busqueda"].includes(name.toLowerCase()))
    || required.find((name) => properties[name]?.type === "string");
  if (!queryName) throw new HttpsError("failed-precondition", "El contrato de búsqueda del proveedor cambió y requiere adaptación.");
  args[queryName] = query;

  const sourceName = names.find((name) => ["sources", "source", "fuentes", "fuente"].includes(name.toLowerCase()));
  if (sourceName) {
    const property = properties[sourceName];
    const enumValues = property.items?.enum || property.enum || [];
    const available = enumValues.length ? enumValues : ["SAIJ", "CSJN", "JUBA"];
    const all = available.filter((item) => normalizeSource(String(item)) !== null);
    args[sourceName] = property.type === "array" || property.items ? all : "all";
  }

  const typeName = names.find((name) => ["type", "documentType", "document_type", "tipo"].includes(name.toLowerCase()));
  if (typeName) {
    const enumValues = properties[typeName].enum;
    args[typeName] = Array.isArray(enumValues) && !enumValues.includes(type) ? enumValues.find((item) => String(item).toLowerCase() === type) ?? enumValues[0] : type;
  }
  const offsetName = names.find((name) => ["offset", "pageOffset", "page_offset"].includes(name.toLowerCase()));
  if (offsetName) args[offsetName] = offset;
  const limitName = names.find((name) => ["limit", "pageSize", "page_size", "count"].includes(name.toLowerCase()));
  if (limitName) args[limitName] = Math.min(25, properties[limitName].maximum || 10);
  return args;
}

function toolPayload(result, allowPlainText = false) {
  if (result?.isError) throw new HttpsError("unavailable", "La búsqueda jurídica fue rechazada por el proveedor.");
  if (result?.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const text = Array.isArray(result?.content) ? result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n") : "";
  const parsed = parseResponseBody(text);
  if (parsed && typeof parsed === "object") return parsed;
  if (allowPlainText && text) return { text };
  throw new HttpsError("data-loss", "La respuesta del proveedor no contiene resultados estructurados.");
}

function extractResults(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["results", "items", "cases", "documents", "matches", "fallos"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  for (const key of ["data", "result", "response"]) {
    if (payload[key] && typeof payload[key] === "object") {
      const rows = extractResults(payload[key]);
      if (rows) return rows;
    }
  }
  return null;
}

async function searchTool(query, type, offset, apiKey, sessionId) {
  const tool = toolSchemaCache?.find((item) => item.name === "search-jurisprudence");
  if (!tool) throw new HttpsError("failed-precondition", "La herramienta de búsqueda multi-fuente no está disponible en el proveedor.");
  const called = await postMcp({
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: tool.name, arguments: makeSearchArguments(tool, query, type, offset) },
  }, apiKey, sessionId);
  return toolPayload(called.data?.result);
}

async function detailTool(providerId, apiKey, sessionId) {
  const tool = toolSchemaCache?.find((item) => item.name === "get-case-details");
  if (!tool) throw new HttpsError("failed-precondition", "La consulta de texto completo no está disponible en el proveedor.");
  const schema = tool.inputSchema || {};
  const properties = schema.properties || {};
  const names = Object.keys(properties);
  const idName = names.find((name) => ["id", "uuid", "caseId", "case_id", "falloId", "fallo_id", "identifier"].includes(name.toLowerCase()))
    || (Array.isArray(schema.required) ? schema.required[0] : null);
  if (!idName) throw new HttpsError("failed-precondition", "El contrato de detalle del proveedor requiere adaptación.");
  const called = await postMcp({
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: tool.name, arguments: { [idName]: providerId } },
  }, apiKey, sessionId);
  const payload = toolPayload(called.data?.result, true);
  const details = payload.document || payload.case || payload.fallo || payload.result || payload.data || payload;
  const normalized = normalizeResult(details && typeof details === "object" ? details : payload);
  return { ...normalized, providerId: normalized.providerId || providerId };
}

function requireAuthorized(request) {
  const email = request.auth?.token?.email;
  if (!request.auth || email !== allowedEmail || request.auth.token.email_verified !== true) {
    throw new HttpsError("permission-denied", "La cuenta no está autorizada para consultar jurisprudencia.");
  }
}

function requireKey() {
  const key = juridicaApiKey.value();
  if (!key) throw new HttpsError("failed-precondition", "La clave de Jurídica todavía no está configurada en Secret Manager.");
  return key;
}

exports.searchJurisprudence = onCall(
  { region: "southamerica-east1", secrets: [juridicaApiKey], timeoutSeconds: 45, maxInstances: 2, cors: appOrigins },
  async (request) => {
    requireAuthorized(request);
    const query = typeof request.data?.query === "string" ? request.data.query.trim() : "";
    const type = typeof request.data?.type === "string" ? request.data.type : "jurisprudencia";
    const offset = Number.isInteger(request.data?.offset) ? request.data.offset : 0;
    if (query.length < 2 || query.length > 300 || offset < 0 || offset > 5000 || !acceptedSearchTypes.has(type)) {
      throw new HttpsError("invalid-argument", "La búsqueda debe tener entre 2 y 300 caracteres y una página válida.");
    }
    const apiKey = requireKey();
    const sessionId = await connectMcp(apiKey);
    const payload = await searchTool(query, type, offset, apiKey, sessionId);
    const rawResults = extractResults(payload);
    if (!rawResults) throw new HttpsError("data-loss", "El proveedor no devolvió una lista de resultados reconocible.");
    return {
      query,
      type,
      total: Number.isInteger(payload.total) ? payload.total : Number.isInteger(payload.totalCount) ? payload.totalCount : null,
      count: rawResults.length,
      offset,
      provider: "juridica-multisource",
      results: rawResults.map(normalizeResult),
    };
  },
);

exports.getJurisprudenceDetails = onCall(
  { region: "southamerica-east1", secrets: [juridicaApiKey], timeoutSeconds: 45, maxInstances: 2, cors: appOrigins },
  async (request) => {
    requireAuthorized(request);
    const providerId = typeof request.data?.providerId === "string" ? request.data.providerId.trim() : "";
    if (!providerId || providerId.length > 300) throw new HttpsError("invalid-argument", "Falta un identificador válido del resultado.");
    const apiKey = requireKey();
    const sessionId = await connectMcp(apiKey);
    return { provider: "juridica-multisource", result: await detailTool(providerId, apiKey, sessionId) };
  },
);
