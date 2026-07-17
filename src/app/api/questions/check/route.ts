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

        const { questionId, selectedOptionId } = body;

        // 1. Validate inputs
        if (!questionId || typeof questionId !== "string" || !UUID_REGEX.test(questionId)) {
            return NextResponse.json(
                { error: "Invalid or missing questionId" },
                { status: 400 }
            );
        }

        if (!selectedOptionId || typeof selectedOptionId !== "string" || !UUID_REGEX.test(selectedOptionId)) {
            return NextResponse.json(
                { error: "Invalid or missing selectedOptionId" },
                { status: 400 }
            );
        }

        // 2. Fetch question and options
        const question = await prisma.question.findUnique({
            where: { id: questionId },
            include: { options: true }
        });

        if (!question) {
            return NextResponse.json(
                { error: "Question not found" },
                { status: 404 }
            );
        }

        // 3. Find options
        const selectedOption = question.options.find((opt) => opt.id === selectedOptionId);
        const correctOption = question.options.find((opt) => opt.isCorrect);

        if (!selectedOption) {
            return NextResponse.json(
                { error: "Selected option does not belong to this question" },
                { status: 400 }
            );
        }

        const isCorrect = selectedOption.isCorrect;

        // 4. Return results
        return NextResponse.json({
            correct: isCorrect,
            correctOptionId: correctOption?.id || null,
            correctOptionText: correctOption?.text || null,
            points: isCorrect ? question.points : 0
        }, { status: 200 });

    } catch (error: any) {
        return NextResponse.json(
            { error: "Internal Server Error", details: error.message },
            { status: 500 }
        );
    }
}
