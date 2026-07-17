import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../prisma/utils/prisma";
import { Difficulty, Continent } from "../../../generated/prisma/enums";

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);

        // 1. Parse limit
        const limitParam = searchParams.get("limit");
        let limit = 10; // Default limit
        if (limitParam) {
            const parsed = parseInt(limitParam, 10);
            if (!isNaN(parsed) && parsed > 0) {
                limit = Math.min(parsed, 100); // Caps limit at 100
            }
        }

        // 2. Parse category slug
        const categorySlug = searchParams.get("category")?.trim();

        // 3. Parse difficulty
        const difficultyParam = searchParams.get("difficulty")?.toUpperCase();
        let difficulty: Difficulty | undefined;
        if (difficultyParam) {
            const validDifficulties = Object.values(Difficulty) as string[];
            if (validDifficulties.includes(difficultyParam)) {
                difficulty = difficultyParam as Difficulty;
            } else {
                return NextResponse.json(
                    { error: `Invalid difficulty. Must be one of: ${validDifficulties.join(", ")}` },
                    { status: 400 }
                );
            }
        }

        // 4. Parse continent
        const continentParam = searchParams.get("continent")?.toUpperCase();
        let continent: Continent | undefined;
        if (continentParam) {
            const validContinents = Object.values(Continent) as string[];
            if (validContinents.includes(continentParam)) {
                continent = continentParam as Continent;
            } else {
                return NextResponse.json(
                    { error: `Invalid continent. Must be one of: ${validContinents.join(", ")}` },
                    { status: 400 }
                );
            }
        }

        // 5. Parse random flag
        const isRandom = searchParams.get("random") === "true";

        // 6. Build the Prisma where clause
        const where: any = {
            isActive: true
        };

        if (categorySlug) {
            where.category = { slug: categorySlug };
        }

        if (difficulty) {
            where.difficulty = difficulty;
        }

        if (continent) {
            where.country = { continent: continent };
        }

        let questions: any[] = [];

        // 7. Execute Query (handle randomizing vs sequential taking)
        if (isRandom) {
            // Get all matching question IDs
            const allMatching = await prisma.question.findMany({
                where,
                select: { id: true }
            });

            if (allMatching.length > 0) {
                // Shuffle IDs and take up to the requested limit
                const shuffledIds = allMatching
                    .map((q) => q.id)
                    .sort(() => 0.5 - Math.random())
                    .slice(0, limit);

                // Fetch full records for the selected randomized IDs
                const rawQuestions = await prisma.question.findMany({
                    where: { id: { in: shuffledIds } },
                    include: {
                        options: {
                            orderBy: { displayOrder: "asc" }
                        }
                    }
                });

                // Maintain the random order in the final output array
                questions = shuffledIds
                    .map((id) => rawQuestions.find((q) => q.id === id))
                    .filter((q): q is NonNullable<typeof q> => !!q);
            }
        } else {
            questions = await prisma.question.findMany({
                where,
                take: limit,
                include: {
                    options: {
                        orderBy: { displayOrder: "asc" }
                    }
                },
                orderBy: { createdAt: "desc" }
            });
        }

        // 8. Sanitize questions (never expose which option is correct)
        const sanitizedQuestions = questions.map((q) => ({
            id: q.id,
            question: q.question,
            questionType: q.questionType,
            difficulty: q.difficulty,
            points: q.points,
            timeLimitSeconds: q.timeLimitSeconds,
            imagePath: q.imagePath || null,
            hint: q.hint || null,
            explanation: q.explanation || null,
            options: q.options.map((opt: any) => ({
                id: opt.id,
                text: opt.text || null,
                imagePath: opt.imagePath || null,
                displayOrder: opt.displayOrder
            }))
        }));

        return NextResponse.json(sanitizedQuestions, { status: 200 });
    } catch (error: any) {
        return NextResponse.json(
            { error: "Internal Server Error", details: error.message },
            { status: 500 }
        );
    }
}
