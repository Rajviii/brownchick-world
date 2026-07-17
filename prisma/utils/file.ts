import fs from "node:fs/promises";
import path from "node:path";

export async function readJsonFile<T>(filePath: string): Promise<T> {
    const fullPath = path.resolve(filePath);

    const file = await fs.readFile(fullPath, "utf-8");

    return JSON.parse(file) as T;
}