import { prisma, pool } from "../utils/prisma";
import { logger } from "../utils/logger";
import { Difficulty, QuestionType } from "../../src/generated/prisma/enums";

// Helper to map Continent enum to human-readable names
const continentNames: Record<string, string> = {
    AFRICA: "Africa",
    ANTARCTICA: "Antarctica",
    ASIA: "Asia",
    EUROPE: "Europe",
    NORTH_AMERICA: "North America",
    OCEANIA: "Oceania",
    SOUTH_AMERICA: "South America"
};

// Shuffles an array randomly
function shuffle<T>(array: T[]): T[] {
    return [...array].sort(() => 0.5 - Math.random());
}

// Selects unique random items from a pool, excluding the correct answer
function getDistractors<T>(pool: T[], correctValue: T, count: number): T[] {
    const filtered = pool.filter((item) => item !== correctValue);
    const unique = Array.from(new Set(filtered));
    return shuffle(unique).slice(0, count);
}

export async function seedQuestions() {
    logger.divider();
    logger.info("❓ Seeding categories and questions...");

    const startTime = Date.now();

    // 1. Seed Categories
    const categoriesData = [
        { name: "Capitals", slug: "capitals", description: "Test your knowledge of world capitals.", displayOrder: 1 },
        { name: "Flags", slug: "flags", description: "Identify countries by their flags.", displayOrder: 2 },
        { name: "Continents", slug: "continents", description: "Identify the continent where a country is located.", displayOrder: 3 },
        { name: "Currencies", slug: "currencies", description: "Identify country currencies.", displayOrder: 4 }
    ];

    const categories: Record<string, any> = {};
    for (const cat of categoriesData) {
        categories[cat.slug] = await prisma.category.upsert({
            where: { slug: cat.slug },
            update: {
                name: cat.name,
                description: cat.description,
                displayOrder: cat.displayOrder
            },
            create: {
                name: cat.name,
                slug: cat.slug,
                description: cat.description,
                displayOrder: cat.displayOrder
            }
        });
    }

    // 2. Fetch seeded countries and their currencies
    const countries = await prisma.country.findMany({
        include: {
            currencies: {
                include: {
                    currency: true
                }
            }
        }
    });

    if (countries.length < 4) {
        logger.error("Not enough countries found to generate distractors. Seed countries first.");
        logger.divider();
        return;
    }

    // OPTIMIZATION 1: Pre-fetch all existing question texts and IDs in one query to avoid 1,000 read queries
    const existingList = await prisma.question.findMany({
        select: { id: true, question: true }
    });
    const questionIdMap = new Map<string, string>(
        existingList.map((q) => [q.question, q.id])
    );

    // Prepare pools for distractors
    const allCapitals = countries
        .map((c) => c.capital?.[0])
        .filter((cap): cap is string => typeof cap === "string" && cap.length > 0);

    const allCountryNames = countries.map((c) => c.name);
    const allContinentNames = Object.values(continentNames);
    const allCurrencyNames = countries
        .flatMap((c) => c.currencies.map((cc) => cc.currency.name))
        .filter((cur): cur is string => typeof cur === "string" && cur.length > 0);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    // OPTIMIZATION 2: Batch process countries in parallel chunks of 4 to avoid database connection pool starvation
    const chunkSize = 4;
    for (let i = 0; i < countries.length; i += chunkSize) {
        const chunk = countries.slice(i, i + chunkSize);

        await Promise.all(
            chunk.map(async (country, chunkIdx) => {
                const idx = i + chunkIdx;

                // Determine difficulty dynamically by index to distribute evenly
                const difficulty = idx % 3 === 0
                    ? Difficulty.EASY
                    : idx % 3 === 1
                        ? Difficulty.MEDIUM
                        : Difficulty.HARD;

                // Points and time limits based on difficulty
                const points = difficulty === Difficulty.EASY ? 10 : difficulty === Difficulty.MEDIUM ? 20 : 30;
                const timeLimitSeconds = difficulty === Difficulty.EASY ? 15 : difficulty === Difficulty.MEDIUM ? 20 : 25;

                const questionsToSeed: Array<{
                    categoryId: string;
                    questionText: string;
                    correctAnswer: string;
                    distractors: string[];
                    imagePath?: string;
                }> = [];

                // --- Question A: Capitals ---
                const correctCapital = country.capital?.[0];
                if (correctCapital) {
                    const distractors = getDistractors(allCapitals, correctCapital, 3);
                    if (distractors.length === 3) {
                        questionsToSeed.push({
                            categoryId: categories["capitals"].id,
                            questionText: `What is the capital of ${country.name}?`,
                            correctAnswer: correctCapital,
                            distractors
                        });
                    }
                }

                // --- Question B: Flags ---
                if (country.flagEmoji) {
                    const distractors = getDistractors(allCountryNames, country.name, 3);
                    if (distractors.length === 3) {
                        questionsToSeed.push({
                            categoryId: categories["flags"].id,
                            questionText: `Which country does this flag belong to?`,
                            correctAnswer: country.name,
                            distractors,
                            imagePath: country.flagSvg
                        });
                    }
                }

                // --- Question C: Continents ---
                const correctContinent = continentNames[country.continent];
                if (correctContinent) {
                    const distractors = getDistractors(allContinentNames, correctContinent, 3);
                    if (distractors.length === 3) {
                        questionsToSeed.push({
                            categoryId: categories["continents"].id,
                            questionText: `Which continent is ${country.name} located in?`,
                            correctAnswer: correctContinent,
                            distractors
                        });
                    }
                }

                // --- Question D: Currencies ---
                const correctCurrency = country.currencies?.[0]?.currency?.name;
                if (correctCurrency) {
                    const distractors = getDistractors(allCurrencyNames, correctCurrency, 3);
                    if (distractors.length === 3) {
                        questionsToSeed.push({
                            categoryId: categories["currencies"].id,
                            questionText: `What is the currency of ${country.name}?`,
                            correctAnswer: correctCurrency,
                            distractors
                        });
                    }
                }

                if (questionsToSeed.length === 0) return;

                // Perform db transaction per country to handle question upsert
                try {
                    await prisma.$transaction(async (tx: any) => {
                        for (const q of questionsToSeed) {
                            // Check in-memory map instead of running database read query
                            const existingId = questionIdMap.get(q.questionText);

                            // Build and shuffle options
                            const options = shuffle([
                                { text: q.correctAnswer, isCorrect: true },
                                ...q.distractors.map((d) => ({ text: d, isCorrect: false }))
                            ]);

                            if (existingId) {
                                // Idempotent update: Re-create options to keep clean state
                                await tx.question.update({
                                    where: { id: existingId },
                                    data: {
                                        difficulty,
                                        points,
                                        timeLimitSeconds,
                                        imagePath: q.imagePath || null,
                                        options: {
                                            deleteMany: {},
                                            create: options.map((opt, oIdx) => ({
                                                text: opt.text,
                                                isCorrect: opt.isCorrect,
                                                displayOrder: oIdx
                                            }))
                                        }
                                    }
                                });
                                updated++;
                            } else {
                                // Create new question with options
                                await tx.question.create({
                                    data: {
                                        categoryId: q.categoryId,
                                        countryId: country.id,
                                        question: q.questionText,
                                        questionType: QuestionType.MULTIPLE_CHOICE,
                                        difficulty,
                                        points,
                                        timeLimitSeconds,
                                        imagePath: q.imagePath || null,
                                        options: {
                                            create: options.map((opt, oIdx) => ({
                                                text: opt.text,
                                                isCorrect: opt.isCorrect,
                                                displayOrder: oIdx
                                            }))
                                        }
                                    }
                                });
                                inserted++;
                            }
                        }
                    }, {
                        timeout: 30000 // 30 seconds to handle network latency
                    });
                } catch (dbErr: any) {
                    skipped += questionsToSeed.length;
                    logger.warn(`Failed to seed questions for ${country.name}: ${dbErr.message}`);
                }
            })
        );
    }

    const duration = Date.now() - startTime;
    logger.success("Seeding completed!");
    logger.info(`Inserted Questions: ${inserted}`);
    logger.info(`Updated Questions: ${updated}`);
    logger.info(`Skipped Questions: ${skipped}`);
    logger.info(`Execution time: ${duration}ms`);
    logger.divider();

    // Disconnect of the pool will be handled by the main seed orchestrator
}
