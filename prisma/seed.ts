import { seedCountries } from "./seeders/countrySeeder";
import { seedQuestions } from "./seeders/questionSeeder";
import { prisma, pool } from "./utils/prisma";
import { logger } from "./utils/logger";

async function main() {
    const countryCount = await prisma.country.count();
    if (countryCount === 0) {
        await seedCountries();
    } else {
        logger.info("🌍 Countries already seeded, skipping country seeding.");
    }
    await seedQuestions();
}

main()
    .then(async () => {
        await prisma.$disconnect();
        await pool.end();
        console.log("✅ Seed completed");
    })
    .catch(async (error) => {
        console.error(error);
        try {
            await prisma.$disconnect();
            await pool.end();
        } catch (e) {}
        process.exit(1);
    });