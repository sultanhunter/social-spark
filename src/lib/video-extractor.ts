import ffmpeg from "fluent-ffmpeg";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";

const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);

/**
 * Parses a timecode string like "0:30-1:00" and returns the start time in seconds (30).
 * Defaults to 0 if parsing fails.
 */
export function parseStartTimeSeconds(timecode?: string): number {
    if (!timecode) return 0;

    const startPart = timecode.split("-")[0]?.trim();
    if (!startPart) return 0;

    const parts = startPart.split(":").map(Number);

    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return parts[0] * 60 + parts[1];
    } else if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    return 0;
}

/**
 * Downloads a video from a URL and extracts a single frame at the specific timestamp.
 * 
 * @param videoUrl URL of the absolute video to extract from
 * @param timeSeconds The exact second from which to pull the frame
 * @returns The absolute path to the locally extracted image frame
 */
export async function extractVideoFrame(videoUrl: string, timeSeconds: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const tempDir = os.tmpdir();
        const filename = `frame-${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
        const outputPath = path.join(tempDir, filename);

        ffmpeg(videoUrl)
            .on("end", async () => {
                try {
                    // Verify file was actually created and has size
                    const stats = await stat(outputPath);
                    if (stats.size === 0) {
                        throw new Error("Extracted frame is empty");
                    }
                    resolve(outputPath);
                } catch (err) {
                    reject(err);
                }
            })
            .on("error", (err) => {
                reject(new Error(`FFmpeg extraction failed: ${err.message}`));
            })
            .seekInput(timeSeconds)
            .frames(1)
            .outputOptions(["-q:v 2"]) // High quality JPEG
            .output(outputPath)
            .run();
    });
}

/**
 * Clean up a temporary file from the file system
 */
export async function cleanupTempFile(filePath: string): Promise<void> {
    try {
        if (fs.existsSync(filePath)) {
            await unlink(filePath);
        }
    } catch (err) {
        console.error(`Failed to cleanup temp file ${filePath}:`, err);
    }
}
