const json = (data, init = {}) => {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
};

const text = (body, init = {}) => {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "text/plain; charset=utf-8");
  return new Response(body, { ...init, headers });
};

const FOLDER_MARKER = ".r2drive-folder";
const SHARE_PREFIX = ".r2drive-shares";

function withCors(response, origin) {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  headers.set("access-control-allow-headers", "authorization,content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("access-control-max-age", "86400");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function withCookie(response, cookie) {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function getCorsOrigin(request, env) {
  if (!env.ALLOWED_ORIGIN || env.ALLOWED_ORIGIN === "*") {
    return request.headers.get("origin") || "*";
  }

  const origin = request.headers.get("origin");
  return origin === env.ALLOWED_ORIGIN ? origin : env.ALLOWED_ORIGIN;
}

function unauthorized(message = "Unauthorized") {
  return json({ error: message }, { status: 401 });
}

function badRequest(message) {
  return json({ error: message }, { status: 400 });
}

function normalizeKey(input) {
  return input.replace(/^\/+|\/+$/g, "").replace(/\\/g, "/");
}

function validateUserKey(key) {
  if (!key) {
    throw new Error("Missing key");
  }

  if (key === SHARE_PREFIX || key.startsWith(`${SHARE_PREFIX}/`)) {
    throw new Error("Reserved key prefix");
  }
}

function parseBearerToken(request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function parseCookies(request) {
  const cookieHeader = request.headers.get("cookie") || "";
  return cookieHeader.split(";").reduce((cookies, part) => {
    const [name, ...rest] = part.trim().split("=");
    if (!name) {
      return cookies;
    }

    cookies[name] = decodeURIComponent(rest.join("="));
    return cookies;
  }, {});
}

function toBase64Url(value) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return atob(padded);
}

function buildSessionCookie(token, maxAge, isSecure) {
  return `r2drive_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isSecure ? "; Secure" : ""}`;
}

function clearSessionCookie(isSecure) {
  return `r2drive_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure ? "; Secure" : ""}`;
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signDownload(key, expiresAt, env) {
  return sha256Hex(`${env.SIGNING_KEY}:${key}:${expiresAt}`);
}

async function verifyDownloadSignature(key, expiresAt, signature, env) {
  const expected = await signDownload(key, expiresAt, env);
  return expected === signature;
}

async function signSession(username, expiresAt, env) {
  return sha256Hex(`${env.SIGNING_KEY}:session:${username}:${expiresAt}`);
}

async function createSessionToken(username, env) {
  const maxAge = 60 * 60 * 24 * 7;
  const expiresAt = Math.floor(Date.now() / 1000) + maxAge;
  const signature = await signSession(username, expiresAt, env);
  return {
    token: toBase64Url(`${username}.${expiresAt}.${signature}`),
    maxAge,
    expiresAt
  };
}

async function readSession(request, env) {
  const bearerToken = parseBearerToken(request);
  if (bearerToken && env.ADMIN_TOKEN && bearerToken === env.ADMIN_TOKEN) {
    return { authenticated: true, username: env.ADMIN_USERNAME || "admin" };
  }

  const cookies = parseCookies(request);
  if (!cookies.r2drive_session) {
    return { authenticated: false };
  }

  try {
    const raw = fromBase64Url(cookies.r2drive_session);
    const [username, expiresAtValue, signature] = raw.split(".");
    const expiresAt = Number(expiresAtValue || "0");
    if (!username || !expiresAt || !signature) {
      return { authenticated: false };
    }

    if (Math.floor(Date.now() / 1000) > expiresAt) {
      return { authenticated: false };
    }

    if (username !== env.ADMIN_USERNAME) {
      return { authenticated: false };
    }

    const expected = await signSession(username, expiresAt, env);
    if (expected !== signature) {
      return { authenticated: false };
    }

    return { authenticated: true, username };
  } catch {
    return { authenticated: false };
  }
}

async function requireAdmin(request, env) {
  const session = await readSession(request, env);
  return session.authenticated;
}

async function verifyLogin(username, password, env) {
  return username === env.ADMIN_USERNAME && password === env.ADMIN_PASSWORD;
}

function buildFileUrl(request, key) {
  const url = new URL(request.url);
  url.pathname = `/d/${key.split("/").map(encodeURIComponent).join("/")}`;
  url.search = "";
  return url.toString();
}

function buildShareUrl(request, id) {
  const url = new URL(request.url);
  url.pathname = `/s/${encodeURIComponent(id)}`;
  url.search = "";
  return url.toString();
}

function shareObjectKey(id) {
  return `${SHARE_PREFIX}/${id}.json`;
}

function computeExpiresAt(ttlSeconds) {
  if (ttlSeconds == null) {
    return null;
  }

  const normalizedTtl = Math.max(60, Math.min(Number(ttlSeconds || 3600), 604800));
  return Math.floor(Date.now() / 1000) + normalizedTtl;
}

function normalizeShare(record) {
  return {
    id: record.id,
    key: record.key,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt ?? null,
    updatedAt: record.updatedAt ?? record.createdAt,
    permanent: record.expiresAt == null
  };
}

async function readShare(env, id) {
  const object = await env.BUCKET.get(shareObjectKey(id));
  if (!object) {
    return null;
  }

  const payload = await object.json();
  return normalizeShare(payload);
}

async function writeShare(env, share) {
  const normalized = normalizeShare(share);
  await env.BUCKET.put(shareObjectKey(normalized.id), JSON.stringify(normalized), {
    httpMetadata: {
      contentType: "application/json",
      cacheControl: "private, max-age=0, no-store"
    }
  });
  return normalized;
}

async function deleteShare(env, id) {
  await env.BUCKET.delete(shareObjectKey(id));
}

async function listShares(env) {
  let cursor = undefined;
  const shares = [];

  do {
    const listed = await env.BUCKET.list({ prefix: `${SHARE_PREFIX}/`, cursor, limit: 1000 });
    for (const object of listed.objects) {
      const payload = await env.BUCKET.get(object.key);
      if (!payload) {
        continue;
      }
      shares.push(normalizeShare(await payload.json()));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  shares.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  return shares;
}

async function listFiles(env, prefix) {
  const listed = await env.BUCKET.list({ prefix, limit: 1000 });
  const folders = [];
  const files = [];

  for (const object of listed.objects) {
    if (object.key.startsWith(`${SHARE_PREFIX}/`)) {
      continue;
    }

    if (object.key.endsWith(`/${FOLDER_MARKER}`)) {
      folders.push({
        key: object.key.slice(0, -(`/${FOLDER_MARKER}`.length)),
        uploaded: object.uploaded
      });
      continue;
    }

    files.push({
      key: object.key,
      size: object.size,
      uploaded: object.uploaded,
      etag: object.etag
    });
  }

  return { files, folders };
}

async function createFolder(env, folderPath) {
  const normalized = normalizeKey(folderPath);
  if (!normalized) {
    throw new Error("Missing folder path");
  }

  validateUserKey(normalized);

  await env.BUCKET.put(`${normalized}/${FOLDER_MARKER}`, "", {
    httpMetadata: {
      contentType: "text/plain",
      cacheControl: "private, max-age=0, no-store"
    },
    customMetadata: {
      folder: "true"
    }
  });

  return normalized;
}

async function deleteFolder(env, folderPath) {
  const normalized = normalizeKey(folderPath);
  if (!normalized) {
    throw new Error("Missing folder path");
  }

  validateUserKey(normalized);

  let cursor = undefined;
  do {
    const listed = await env.BUCKET.list({ prefix: `${normalized}/`, cursor, limit: 1000 });
    if (listed.objects.length) {
      await env.BUCKET.delete(listed.objects.map((object) => object.key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return normalized;
}

async function handleLogin(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return badRequest("Invalid JSON body");
  }

  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || !password) {
    return badRequest("Missing username or password");
  }

  const valid = await verifyLogin(username, password, env);
  if (!valid) {
    return unauthorized("账号或密码错误");
  }

  const session = await createSessionToken(username, env);
  const response = json({
    ok: true,
    session: {
      username,
      expiresAt: session.expiresAt
    }
  });
  const isSecure = new URL(request.url).protocol === "https:";
  return withCookie(response, buildSessionCookie(session.token, session.maxAge, isSecure));
}

async function handleSession(request, env) {
  const session = await readSession(request, env);
  return json({
    authenticated: session.authenticated,
    session: session.authenticated ? { username: session.username } : null
  });
}

function handleLogout(request) {
  const isSecure = new URL(request.url).protocol === "https:";
  return withCookie(json({ ok: true }), clearSessionCookie(isSecure));
}

async function handleList(request, env) {
  if (!await requireAdmin(request, env)) {
    return unauthorized();
  }

  const url = new URL(request.url);
  const prefix = normalizeKey(url.searchParams.get("prefix") || "");
  const listing = await listFiles(env, prefix);
  return json(listing);
}

async function handleUpload(request, env) {
  if (!await requireAdmin(request, env)) {
    return unauthorized();
  }

  const url = new URL(request.url);
  const key = normalizeKey(url.searchParams.get("key") || "");
  if (!key) {
    return badRequest("Missing key query parameter");
  }

  validateUserKey(key);

  const contentLength = Number(request.headers.get("content-length") || "0");
  const maxUploadSize = Number(env.MAX_UPLOAD_SIZE || "0");
  if (maxUploadSize > 0 && contentLength > maxUploadSize) {
    return json({ error: `Upload exceeds MAX_UPLOAD_SIZE=${maxUploadSize}` }, { status: 413 });
  }

  const contentType = request.headers.get("content-type") || "application/octet-stream";
  await env.BUCKET.put(key, request.body, {
    httpMetadata: {
      contentType,
      cacheControl: "private, max-age=0, no-store"
    },
    customMetadata: {
      uploadedBy: "R2Drive"
    }
  });

  return json({ ok: true, key, url: buildFileUrl(request, key) }, { status: 201 });
}

async function handleCreateFolder(request, env) {
  if (!await requireAdmin(request, env)) {
    return unauthorized();
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return badRequest("Invalid JSON body");
  }

  const path = normalizeKey(body.path || "");
  if (!path) {
    return badRequest("Missing folder path");
  }

  const folder = await createFolder(env, path);
  return json({ ok: true, folder }, { status: 201 });
}

async function handleDelete(request, env, key) {
  if (!await requireAdmin(request, env)) {
    return unauthorized();
  }

  validateUserKey(key);

  await env.BUCKET.delete(key);
  return json({ ok: true, key });
}

async function handleDeleteFolder(request, env, key) {
  if (!await requireAdmin(request, env)) {
    return unauthorized();
  }

  const folder = await deleteFolder(env, key);
  return json({ ok: true, folder });
}

async function handleSignedLink(request, env) {
  if (!await requireAdmin(request, env)) {
    return unauthorized();
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return badRequest("Invalid JSON body");
  }

  const key = normalizeKey(body.key || "");
  if (!key) {
    return badRequest("Missing key");
  }

  validateUserKey(key);

  const permanent = Boolean(body.permanent);
  const expiresAt = permanent ? null : computeExpiresAt(body.ttlSeconds);
  const share = await writeShare(env, {
    id: crypto.randomUUID(),
    key,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt
  });

  return json({
    id: share.id,
    key: share.key,
    ttlSeconds: share.expiresAt == null ? null : Math.max(0, share.expiresAt - Math.floor(Date.now() / 1000)),
    expiresAt: share.expiresAt,
    permanent: share.permanent,
    url: buildShareUrl(request, share.id)
  });
}

async function handlePreviewLink(request, env) {
  if (!await requireAdmin(request, env)) {
    return unauthorized();
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return badRequest("Invalid JSON body");
  }

  const key = normalizeKey(body.key || "");
  if (!key) {
    return badRequest("Missing key");
  }

  validateUserKey(key);

  const expiresAt = computeExpiresAt(body.ttlSeconds || 1800);
  const signature = await signDownload(key, expiresAt, env);
  const url = new URL(buildFileUrl(request, key));
  url.searchParams.set("expires", String(expiresAt));
  url.searchParams.set("sig", signature);

  return json({
    key,
    ttlSeconds: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)),
    expiresAt,
    url: url.toString()
  });
}

async function handleListLinks(request, env) {
  if (!await requireAdmin(request, env)) {
    return unauthorized();
  }

  const shares = await listShares(env);
  return json({ links: shares.map((share) => ({
    ...share,
    remainingSeconds: share.expiresAt == null ? null : Math.max(0, share.expiresAt - Math.floor(Date.now() / 1000)),
    url: buildShareUrl(request, share.id)
  })) });
}

async function handleUpdateLink(request, env, id) {
  if (!await requireAdmin(request, env)) {
    return unauthorized();
  }

  const current = await readShare(env, id);
  if (!current) {
    return text("Not Found", { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return badRequest("Invalid JSON body");
  }

  const updated = await writeShare(env, {
    ...current,
    updatedAt: new Date().toISOString(),
    expiresAt: body.permanent ? null : computeExpiresAt(body.ttlSeconds)
  });

  return json({
    link: {
      ...updated,
      remainingSeconds: updated.expiresAt == null ? null : Math.max(0, updated.expiresAt - Math.floor(Date.now() / 1000)),
      url: buildShareUrl(request, updated.id)
    }
  });
}

async function handleDeleteLink(request, env, id) {
  if (!await requireAdmin(request, env)) {
    return unauthorized();
  }

  await deleteShare(env, id);
  return json({ ok: true, id });
}

async function handleSharedDownload(request, env, id) {
  const share = await readShare(env, id);
  if (!share) {
    return text("Not Found", { status: 404 });
  }

  if (share.expiresAt != null && Math.floor(Date.now() / 1000) > share.expiresAt) {
    return unauthorized("Shared link expired");
  }

  const object = await env.BUCKET.get(share.key);
  if (!object) {
    return text("Not Found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(share.key.split("/").pop() || share.key)}`);
  return new Response(object.body, { headers });
}

async function handleDownload(request, env, key) {
  const url = new URL(request.url);
  const expires = Number(url.searchParams.get("expires") || "0");
  const signature = url.searchParams.get("sig") || "";

  if (!expires || !signature) {
    return unauthorized("Missing signed link parameters");
  }

  if (Math.floor(Date.now() / 1000) > expires) {
    return unauthorized("Signed link expired");
  }

  const valid = await verifyDownloadSignature(key, expires, signature, env);
  if (!valid) {
    return unauthorized("Invalid signature");
  }

  const object = await env.BUCKET.get(key);
  if (!object) {
    return text("Not Found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(key.split("/").pop() || key)}`);
  return new Response(object.body, { headers });
}

async function handleHealth(request, env) {
  const session = await readSession(request, env);
  return json({
    ok: true,
    app: "R2Drive",
    authenticated: session.authenticated,
    username: session.authenticated ? session.username : null,
    hasSigningKey: Boolean(env.SIGNING_KEY),
    hasAdminUsername: Boolean(env.ADMIN_USERNAME),
    hasAdminPassword: Boolean(env.ADMIN_PASSWORD)
  });
}

function isApiRequest(pathname) {
  return pathname === "/api/health"
    || pathname === "/api/login"
    || pathname === "/api/logout"
    || pathname === "/api/session"
    || pathname === "/api/files"
    || pathname === "/api/links"
    || pathname === "/api/folders"
    || pathname === "/api/upload"
    || pathname === "/api/direct-link"
    || pathname === "/api/preview-link"
    || pathname.startsWith("/api/files/")
    || pathname.startsWith("/api/links/")
    || pathname.startsWith("/api/folders/")
    || pathname.startsWith("/s/")
    || pathname.startsWith("/d/");
}

export default {
  async fetch(request, env) {
    const origin = getCorsOrigin(request, env);

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), origin);
    }

    if (!env.BUCKET) {
      return withCors(json({ error: "Missing R2 bucket binding" }, { status: 500 }), origin);
    }

    if (!env.SIGNING_KEY || !env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
      return withCors(json({ error: "Missing ADMIN_USERNAME, ADMIN_PASSWORD, or SIGNING_KEY secret" }, { status: 500 }), origin);
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      if (!isApiRequest(pathname)) {
        if (!env.ASSETS) {
          return text("Static assets binding is not configured", { status: 500 });
        }

        return env.ASSETS.fetch(request);
      }

      if (request.method === "GET" && pathname === "/api/health") {
        return withCors(await handleHealth(request, env), origin);
      }

      if (request.method === "GET" && pathname === "/api/session") {
        return withCors(await handleSession(request, env), origin);
      }

      if (request.method === "POST" && pathname === "/api/login") {
        return withCors(await handleLogin(request, env), origin);
      }

      if (request.method === "POST" && pathname === "/api/logout") {
        return withCors(handleLogout(request), origin);
      }

      if (request.method === "GET" && pathname === "/api/files") {
        return withCors(await handleList(request, env), origin);
      }

      if (request.method === "GET" && pathname === "/api/links") {
        return withCors(await handleListLinks(request, env), origin);
      }

      if (request.method === "POST" && pathname === "/api/folders") {
        return withCors(await handleCreateFolder(request, env), origin);
      }

      if (request.method === "DELETE" && pathname.startsWith("/api/folders/")) {
        const key = normalizeKey(decodeURIComponent(pathname.slice("/api/folders/".length)));
        return withCors(await handleDeleteFolder(request, env, key), origin);
      }

      if (request.method === "POST" && pathname === "/api/upload") {
        return withCors(await handleUpload(request, env), origin);
      }

      if (request.method === "POST" && pathname === "/api/direct-link") {
        return withCors(await handleSignedLink(request, env), origin);
      }

      if (request.method === "POST" && pathname === "/api/preview-link") {
        return withCors(await handlePreviewLink(request, env), origin);
      }

      if ((request.method === "PATCH" || request.method === "POST") && pathname.startsWith("/api/links/")) {
        const id = normalizeKey(decodeURIComponent(pathname.slice("/api/links/".length)));
        return withCors(await handleUpdateLink(request, env, id), origin);
      }

      if (request.method === "DELETE" && pathname.startsWith("/api/links/")) {
        const id = normalizeKey(decodeURIComponent(pathname.slice("/api/links/".length)));
        return withCors(await handleDeleteLink(request, env, id), origin);
      }

      if (request.method === "DELETE" && pathname.startsWith("/api/files/")) {
        const key = normalizeKey(decodeURIComponent(pathname.slice("/api/files/".length)));
        return withCors(await handleDelete(request, env, key), origin);
      }

      if (request.method === "GET" && pathname.startsWith("/d/")) {
        const key = normalizeKey(decodeURIComponent(pathname.slice(3)));
        return withCors(await handleDownload(request, env, key), origin);
      }

      if (request.method === "GET" && pathname.startsWith("/s/")) {
        const id = normalizeKey(decodeURIComponent(pathname.slice(3)));
        return withCors(await handleSharedDownload(request, env, id), origin);
      }

      return withCors(text("Not Found", { status: 404 }), origin);
    } catch (error) {
      return withCors(json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 }), origin);
    }
  }
};
