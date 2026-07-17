-- AlterTable
ALTER TABLE "QuizAttempt" ADD COLUMN     "isGuest" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "score" SET DEFAULT 0,
ALTER COLUMN "correctAnswers" SET DEFAULT 0,
ALTER COLUMN "wrongAnswers" SET DEFAULT 0,
ALTER COLUMN "percentage" SET DEFAULT 0;

-- CreateIndex
CREATE INDEX "QuizAttempt_isGuest_idx" ON "QuizAttempt"("isGuest");
