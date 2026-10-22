/**
 * ALLOWED_ORIGIN may list several origins, comma separated (e.g. the site
 * with and without www). a single value works as before
 */
export function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
