import { seedCountries } from "./seeders/countrySeeder";

async function main() {
    await seedCountries();
}

main()
    .then(() => {
        console.log("✅ Seed completed");
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });