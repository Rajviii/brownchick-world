import { Continent } from "@/generated/prisma/enums";

export function mapRegionToContinent(
    region: string | undefined
): Continent {
    switch (region) {
        case "Africa":
            return Continent.AFRICA;

        case "Antarctic":
            return Continent.ANTARCTICA;

        case "Asia":
            return Continent.ASIA;

        case "Europe":
            return Continent.EUROPE;

        case "Oceania":
            return Continent.OCEANIA;

        case "Americas":
            return Continent.NORTH_AMERICA;

        default:
            return Continent.ASIA;
    }
}