// Loads the built SPA into memory once at startup. Requests are resolved against this map
// only, so path traversal is impossible by construction.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

export function loadStatic(dir) {
  const files = new Map();
  if (!existsSync(dir)) return files;
  for (const full of walk(dir)) {
    const type = TYPES[extname(full)];
    if (!type) continue;
    const urlPath = `/${relative(dir, full).split(sep).join('/')}`;
    const body = readFileSync(full);
    files.set(urlPath, {
      body,
      type,
      etag: `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`,
      // Vite fingerprints everything under /assets, so those can be cached forever.
      cacheControl: urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
  }
  return files;
}
