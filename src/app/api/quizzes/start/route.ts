import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../prisma/utils/prisma";
import { Difficulty, Continent } from "../../../../generated/prisma/enums";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Simple helper to shuffle an array
function shuffle<T>(array: T[]): T[] {
    return [...array].sort(() => 0.5 - Math.random());
}

export async function POST(req: NextRequest) {
    try {
        let body;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json(
                { error: "Invalid JSON body" },
                { status: 400 }
            );
        }

        const { category, difficulty, continent, totalQuestions } = body;

        // 1. Validate inputs
        let limit = 10;
        if (totalQuestions !== undefined) {
            const parsed = parseInt(totalQuestions, 10);
            if (isNaN(parsed) || parsed <= 0 || parsed > 50) {
                return NextResponse.json(
                    { error: "totalQuestions must be a positive number between 1 and 50" },
                    { status: 400 }
                );
            }
            limit = parsed;
        }

        // Validate difficulty
        let difficultyEnum: Difficulty | undefined;
        if (difficulty) {
            const difficultyUpper = difficulty.toUpperCase();
            const validDifficulties = Object.values(Difficulty) as string[];
            if (validDifficulties.includes(difficultyUpper)) {
                difficultyEnum = difficultyUpper as Difficulty;
            } else {
                return NextResponse.json(
                    { error: `Invalid difficulty. Must be one of: ${validDifficulties.join(", ")}` },
                    { status: 400 }
                );
            }
        }

        // Validate continent
        let continentEnum: Continent | undefined;
        if (continent) {
            const continentUpper = continent.toUpperCase();
            const validContinents = Object.values(Continent) as string[];
            if (validContinents.includes(continentUpper)) {
                continentEnum = continentUpper as Continent;
            } else {
                return NextResponse.json(
                    { error: `Invalid continent. Must be one of: ${validContinents.join(", ")}` },
                    { status: 400 }
                );
            }
        }

        // 2. Fetch authenticated user if provided in headers or body
        const clientUserId = body.userId || req.headers.get("x-user-id") || req.headers.get("user-id");
        let resolvedUserId: string | null = null;
        let isGuest = true;

        if (clientUserId && UUID_REGEX.test(clientUserId)) {
            const user = await prisma.user.findUnique({
                where: { id: clientUserId }
            });
            if (user) {
                resolvedUserId = user.id;
                isGuest = false;
            }
        }

        // 3. Build question filters
        const where: any = {
            isActive: true
        };

        if (category) {
            where.category = { slug: category };
        }

        if (difficultyEnum) {
            where.difficulty = difficultyEnum;
        }

        if (continentEnum) {
            where.country = { continent: continentEnum };
        }

        // 4. Fetch matching questions and their options
        const matchingQuestions = await prisma.question.findMany({
            where,
            include: {
                options: {
                    orderBy: { displayOrder: "asc" }
                }
            }
        });

        if (matchingQuestions.length === 0) {
            return NextResponse.json(
                { error: "No questions found matching the specified filters" },
                { status: 404 }
            );
        }

        // Select up to limit random questions
        const selectedQuestions = shuffle(matchingQuestions).slice(0, limit);

        // 5. Create dynamic Quiz record and link the questions
        const quizSlug = `custom-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const quiz = await prisma.quiz.create({
            data: {
                title: "Dynamic Custom Quiz",
                slug: quizSlug,
                description: "A custom quiz generated on-the-fly based on filters.",
                quizType: "CUSTOM",
                status: "PUBLISHED",
                totalQuestions: selectedQuestions.length,
                difficulty: difficultyEnum || null,
                questions: {
                    create: selectedQuestions.map((q, idx) => ({
                        questionId: q.id,
                        displayOrder: idx
                    }))
                }
            }
        });

        // 6. Create the QuizAttempt
        const attempt = await prisma.quizAttempt.create({
            data: {
                userId: resolvedUserId,
                quizId: quiz.id,
                score: 0,
                totalQuestions: selectedQuestions.length,
                correctAnswers: 0,
                wrongAnswers: 0,
                percentage: 0,
                isCompleted: false,
                isGuest,
                difficulty: difficultyEnum || null
            }
        });

        // 7. Sanitize options to never expose which one is correct
        const sanitizedQuestions = selectedQuestions.map((q) => ({
            id: q.id,
            question: q.question,
            questionType: q.questionType,
            difficulty: q.difficulty,
            points: q.points,
            timeLimitSeconds: q.timeLimitSeconds,
            imagePath: q.imagePath || null,
            options: q.options.map((opt) => ({
                id: opt.id,
                text: opt.text || null,
                imagePath: opt.imagePath || null,
                displayOrder: opt.displayOrder
            }))
        }));

        // 8. Return response
        return NextResponse.json({
            quizAttemptId: attempt.id,
            questions: sanitizedQuestions
        }, { status: 201 });

    } catch (error: any) {
        console.error("❌ Error starting quiz attempt:", error);
        return NextResponse.json(
            { 
                error: "Internal Server Error", 
                message: error.message,
                stack: error.stack,
                details: error
            },
            { status: 500 }
        );
    }
}
