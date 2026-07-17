import { prisma, pool } from "../utils/prisma";
import { logger } from "../utils/logger";
import { readJsonFile } from "../utils/file";
import { mapRegionToContinent } from "../utils/continent";
import type { CountryData } from "../types/country";

/**
 * SCHEMA INTEGRITY & DATA AVAILABILITY EXPLANATION:
 * 
 * 1. flagSvg (Required String in Country):
 *    - Derived from the ISO-2 country code (`cca2`), e.g., `flags/${cca2.toLowerCase()}.svg`.
 * 
 * 2. symbol (Required String in Currency):
 *    - Falls back to the currency's 3-letter code if `symbol` is missing in the JSON data.
 * 
 * 3. population, description, drivingSide (Nullable fields in CountryDetail):
 *    - Set to null because they are not available in countries.json.
 * 
 * 4. timezones (Required String[] in CountryDetail):
 *    - Set to [] because timezone data is not present in countries.json.
 * 
 * 5. callingCodes (Required String[] in CountryDetail):
 *    - Constructed from `idd.root` and `idd.suffixes` in countries.json. Defaults to [] if missing.
 */

// Simplifies country common name to a URL-safe slug
function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "") // Remove non-alphanumeric except space and hyphen
        .replace(/\s+/g, "-")        // Replace spaces with hyphens
        .replace(/-+/g, "-")         // Replace consecutive hyphens
        .replace(/^-+|-+$/g, "");    // Trim hyphens from ends
}

// Simple validation checking that required identifiers are present
function isValidCountry(record: any): record is CountryData {
    if (!record) return false;
    if (typeof record.cca2 !== "string" || record.cca2.trim().length !== 2) return false;
    if (typeof record.cca3 !== "string" || record.cca3.trim().length !== 3) return false;
    if (!record.name || typeof record.name.common !== "string" || typeof record.name.official !== "string") return false;
    return true;
}

export async function seedCountries() {
    logger.divider();
    logger.info("🌍 Seeding countries...");

    const startTime = Date.now();
    let countries: any[];

    try {
        countries = await readJsonFile<any[]>("prisma/data/countries/countries.json");
    } catch (err: any) {
        logger.error(`Failed to read countries.json: ${err.message}`);
        logger.divider();
        return;
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const record of countries) {
        // Validate record structure
        if (!isValidCountry(record)) {
            skipped++;
            logger.warn(`Skipping invalid country record: ${record?.name?.common ?? "Unknown"}`);
            continue;
        }

        // Print progress to trace which country is currently being seeded
        const progressNum = inserted + updated + skipped + 1;
        logger.info(`[${progressNum}/${countries.length}] Seeding ${record.name.common}...`);

        try {
            // Run operations in an atomic transaction per country
            await prisma.$transaction(async (tx: any) => {
                const rawRecord = record as any;
                const cca2 = record.cca2.toUpperCase();
                const cca3 = record.cca3.toUpperCase();
                const slug = slugify(record.name.common);
                const continent = mapRegionToContinent(record.region);
                const flagSvg = `flags/${cca2.toLowerCase()}.svg`;

                // Query database to check if this is an insert or update
                const existing = await tx.country.findUnique({
                    where: { iso2: cca2 }
                });

                // Extract calling codes
                const callingCodes: string[] = [];
                if (rawRecord.idd?.root) {
                    const suffixes = rawRecord.idd.suffixes || [];
                    for (const suffix of suffixes) {
                        callingCodes.push(rawRecord.idd.root + suffix);
                    }
                }

                const internetTld = rawRecord.tld?.[0] || null;
                const area = typeof rawRecord.area === "number" ? rawRecord.area : null;
                const flagEmoji = rawRecord.flag || "";

                // Upsert Country and nested CountryDetail
                const country = await tx.country.upsert({
                    where: { iso2: cca2 },
                    update: {
                        name: record.name.common,
                        officialName: record.name.official,
                        slug,
                        region: record.region || null,
                        iso3: cca3,
                        capital: record.capital || [],
                        continent,
                        flagEmoji,
                        flagSvg,
                        detail: {
                            upsert: {
                                create: {
                                    areaKm2: area,
                                    callingCodes,
                                    internetTld,
                                    latitude: record.latlng?.[0] || null,
                                    longitude: record.latlng?.[1] || null,
                                    population: null,
                                    timezones: []
                                },
                                update: {
                                    areaKm2: area,
                                    callingCodes,
                                    internetTld,
                                    latitude: record.latlng?.[0] || null,
                                    longitude: record.latlng?.[1] || null,
                                    population: null,
                                    timezones: []
                                }
                            }
                        }
                    },
                    create: {
                        name: record.name.common,
                        officialName: record.name.official,
                        slug,
                        region: record.region || null,
                        iso2: cca2,
                        iso3: cca3,
                        capital: record.capital || [],
                        continent,
                        flagEmoji,
                        flagSvg,
                        detail: {
                            create: {
                                areaKm2: area,
                                callingCodes,
                                internetTld,
                                latitude: record.latlng?.[0] || null,
                                longitude: record.latlng?.[1] || null,
                                population: null,
                                timezones: []
                            }
                        }
                    }
                });

                // Seed Currencies & CountryCurrency connections
                if (record.currencies) {
                    for (const code of Object.keys(record.currencies)) {
                        const cur = record.currencies[code];
                        if (cur?.name) {
                            const symbol = cur.symbol || code;

                            const currency = await tx.currency.upsert({
                                where: { code },
                                update: { name: cur.name, symbol },
                                create: { code, name: cur.name, symbol }
                            });

                            await tx.countryCurrency.upsert({
                                where: {
                                    countryId_currencyId: {
                                        countryId: country.id,
                                        currencyId: currency.id
                                    }
                                },
                                update: {},
                                create: {
                                    countryId: country.id,
                                    currencyId: currency.id
                                }
                            });
                        }
                    }
                }

                // Seed Languages & CountryLanguage connections
                if (record.languages) {
                    for (const code of Object.keys(record.languages)) {
                        const langName = record.languages[code];
                        if (typeof langName === "string") {
                            const language = await tx.language.upsert({
                                where: { code },
                                update: { name: langName },
                                create: { code, name: langName }
                            });

                            await tx.countryLanguage.upsert({
                                where: {
                                    countryId_languageId: {
                                        countryId: country.id,
                                        languageId: language.id
                                    }
                                },
                                update: {},
                                create: {
                                    countryId: country.id,
                                    languageId: language.id,
                                    isOfficial: false
                                }
                            });
                        }
                    }
                }

                if (existing) {
                    updated++;
                } else {
                    inserted++;
                }
            }, {
                timeout: 30000
            });
        } catch (dbErr: any) {
            skipped++;
            logger.warn(`Failed to seed country ${record.name?.common || "Unknown"}: ${dbErr.message}`);
        }
    }

    const duration = Date.now() - startTime;
    logger.success(`Seeding summary:`);
    logger.info(`Inserted: ${inserted}`);
    logger.info(`Updated: ${updated}`);
    logger.info(`Skipped: ${skipped}`);
    logger.info(`Execution time: ${duration}ms`);
    logger.divider();

    // Disconnect Prisma Client to close active pg connection pool handles
    await prisma.$disconnect();
    await pool.end();
}