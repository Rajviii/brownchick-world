export interface CountryData {
    cca2: string;
    cca3: string;

    name: {
        common: string;
        official: string;
    };

    capital?: string[];

    region: string;

    subregion?: string;

    population: number;

    latlng: number[];

    timezones: string[];

    currencies?: Record<
        string,
        {
            name: string;
            symbol?: string;
        }
    >;

    languages?: Record<string, string>;
}