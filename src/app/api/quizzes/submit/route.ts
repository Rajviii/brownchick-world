import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../prisma/utils/prisma";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

        const { quizAttemptId, answers, timeTakenSeconds } = body;

        // 1. Validate inputs
        if (!quizAttemptId || typeof quizAttemptId !== "string" || !UUID_REGEX.test(quizAttemptId)) {
            return NextResponse.json(
                { error: "Invalid or missing quizAttemptId" },
                { status: 400 }
            );
        }

        if (!Array.isArray(answers)) {
            return NextResponse.json(
                { error: "answers must be an array of question answers" },
                { status: 400 }
            );
        }

        // 2. Run completion logic in database transaction
        const result = await prisma.$transaction(async (tx: any) => {
            const attempt = await tx.quizAttempt.findUnique({
                where: { id: quizAttemptId },
                include: {
                    quiz: {
                        include: {
                            questions: {
                                include: {
                                    question: {
                                        include: {
                                            options: true
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            });

            if (!attempt) {
                throw new Error("QUIZ_ATTEMPT_NOT_FOUND");
            }

            if (attempt.isCompleted) {
                throw new Error("QUIZ_ATTEMPT_ALREADY_COMPLETED");
            }

            const quizQuestions = attempt.quiz.questions;
            const totalQuestions = attempt.totalQuestions;
            let correctAnswersCount = 0;
            let wrongAnswersCount = 0;
            let score = 0;

            // Process each question associated with the quiz attempt
            for (const qq of quizQuestions) {
                const question = qq.question;
                const submittedAns = answers.find(
                    (ans: any) => ans && ans.questionId === question.id
                );

                let isCorrect = false;
                let selectedOptionId: string | null = null;

                if (submittedAns && submittedAns.selectedOptionId) {
                    selectedOptionId = submittedAns.selectedOptionId;
                    const option = question.options.find(
                        (opt: any) => opt.id === selectedOptionId
                    );
                    
                    if (option && option.isCorrect) {
                        isCorrect = true;
                        correctAnswersCount++;
                        score += question.points;
                    } else {
                        wrongAnswersCount++;
                    }
                } else {
                    wrongAnswersCount++;
                }

                // Log response details to database
                await tx.quizAnswer.create({
                    data: {
                        quizAttemptId: attempt.id,
                        questionId: question.id,
                        selectedOptionId: selectedOptionId,
                        isCorrect: isCorrect
                    }
                });
            }

            const percentage = totalQuestions > 0 ? (correctAnswersCount / totalQuestions) * 100 : 0;

            // Update QuizAttempt record
            const updatedAttempt = await tx.quizAttempt.update({
                where: { id: attempt.id },
                data: {
                    score,
                    correctAnswers: correctAnswersCount,
                    wrongAnswers: wrongAnswersCount,
                    percentage,
                    isCompleted: true,
                    completedAt: new Date(),
                    timeTakenSeconds: typeof timeTakenSeconds === "number" ? timeTakenSeconds : null
                }
            });

            // 3. User progress and streak check (only for authenticated non-guest users)
            if (!attempt.isGuest && attempt.userId) {
                const progress = await tx.userProgress.findUnique({
                    where: { userId: attempt.userId }
                });

                if (progress) {
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);

                    let currentStreak = progress.currentStreak;
                    const lastActive = progress.lastActiveAt ? new Date(progress.lastActiveAt) : null;

                    if (lastActive) {
                        lastActive.setHours(0, 0, 0, 0);
                        const diffTime = today.getTime() - lastActive.getTime();
                        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

                        if (diffDays === 1) {
                            currentStreak += 1;
                        } else if (diffDays > 1) {
                            currentStreak = 1;
                        }
                    } else {
                        currentStreak = 1;
                    }

                    const bestStreak = Math.max(progress.bestStreak, currentStreak);

                    await tx.userProgress.update({
                        where: { userId: attempt.userId },
                        data: {
                            xp: { increment: score },
                            currentStreak,
                            bestStreak,
                            lastActiveAt: new Date()
                        }
                    });
                }
            }

            return {
                score: updatedAttempt.score,
                correctAnswers: updatedAttempt.correctAnswers,
                wrongAnswers: updatedAttempt.wrongAnswers,
                percentage: updatedAttempt.percentage,
                earnedXP: attempt.isGuest ? 0 : score,
                isGuest: attempt.isGuest
            };
        }, {
            timeout: 15000 // 15 seconds limit
        });

        return NextResponse.json(result, { status: 200 });

    } catch (error: any) {
        if (error.message === "QUIZ_ATTEMPT_NOT_FOUND") {
            return NextResponse.json({ error: "Quiz attempt not found" }, { status: 404 });
        }
        if (error.message === "QUIZ_ATTEMPT_ALREADY_COMPLETED") {
            return NextResponse.json({ error: "Quiz attempt has already been completed" }, { status: 400 });
        }

        console.error("❌ Error submitting quiz:", error);
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
