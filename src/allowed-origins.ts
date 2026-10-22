// the app's origins (react native sends none in practice, kept as before)
const APP_ORIGINS = ['shwerni://', 'exp://'];
// the website on a dev machine, never accepted in production
const LOCAL_DEV_ORIGIN = 'http://localhost:3000';

/**
 * ALLOWED_ORIGIN may list several origins, comma separated (e.g. the site
 * with and without www). a single value works as before. a trailing slash
 * is dropped: a browser's Origin header never has one
 */
export function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

// every origin cors accepts, read from the env on each call
export function corsOrigins(): string[] {
  const origins = [...allowedOrigins(), ...APP_ORIGINS];
  if (process.env.NODE_ENV !== 'production') origins.push(LOCAL_DEV_ORIGIN);
  return origins;
}

/**
 * the cors `origin` option for express and socket.io. a callback, so the env
 * is read per request: the gateway's decorator runs when its module is
 * imported, before ConfigModule.forRoot() has loaded .env
 */
export function corsOrigin(
  _requestOrigin: string | undefined,
  callback: (err: Error | null, origins?: string[]) => void,
) {
  callback(null, corsOrigins());
}
