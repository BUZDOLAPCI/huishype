/**
 * Shared helpers for multi-country PBF import scripts.
 *
 * Resolves PBF file paths from the country-config registry and parses
 * the --country CLI flag used by all import scripts.
 */
import path from 'path';
import fs from 'fs';
import {
  getCountryConfig,
  getAllCountryCodes,
  isValidCountryCode,
  type CountryCode,
} from '@huishype/shared/config';

export const DATA_DIR = path.resolve(import.meta.dirname, '../../../../../data_sources');

/**
 * Derive the PBF filename from a Geofabrik download URL.
 * e.g. ".../europe/netherlands-latest.osm.pbf" → "netherlands-latest.osm.pbf"
 */
function pbfFilenameFromUrl(url: string): string {
  return url.split('/').pop()!;
}

/** Get the expected PBF path for a country: data_sources/{CODE}/{geofabrik-filename} */
export function getPbfPath(code: CountryCode): string {
  const cfg = getCountryConfig(code);
  const filename = pbfFilenameFromUrl(cfg.pbfUrl);
  return path.join(DATA_DIR, code, filename);
}

/** Check if PBF file exists for a country. */
export function hasPbf(code: CountryCode): boolean {
  return fs.existsSync(getPbfPath(code));
}

/**
 * Parse --country CLI flag. Returns array of country codes to process.
 *
 * --country NL   → ['NL']
 * --country all  → all codes
 * (no flag)      → all codes
 */
export function parseCountryArg(args: string[] = process.argv.slice(2)): CountryCode[] {
  const idx = args.indexOf('--country');
  if (idx === -1 || idx + 1 >= args.length) {
    return getAllCountryCodes();
  }
  const val = args[idx + 1].toUpperCase();
  if (val === 'ALL') return getAllCountryCodes();
  if (!isValidCountryCode(val)) {
    console.error(`Unknown country code: ${val}`);
    console.error(`Valid codes: ${getAllCountryCodes().join(', ')}`);
    process.exit(1);
  }
  return [val];
}

/**
 * Filter requested countries to those with a PBF on disk.
 * Logs download hints for missing countries.
 */
export function filterAvailableCountries(codes: CountryCode[]): CountryCode[] {
  const available: CountryCode[] = [];
  for (const code of codes) {
    if (hasPbf(code)) {
      available.push(code);
    } else {
      const cfg = getCountryConfig(code);
      console.warn(`  Skipping ${code} (${cfg.name}): PBF not found at ${getPbfPath(code)}`);
      console.warn(`    Download: ${cfg.pbfUrl}`);
    }
  }
  return available;
}
