// Exec-form container HEALTHCHECK for the distroless image (no shell, no curl).
const port = process.env.PORT ?? '8080';
fetch(`http://127.0.0.1:${port}/healthz/ready`, { signal: AbortSignal.timeout(2000) })
  .then((res) => process.exit(res.ok ? 0 : 1))
  .catch(() => process.exit(1));
