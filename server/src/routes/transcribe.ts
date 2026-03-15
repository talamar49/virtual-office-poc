/**
 * POST /api/transcribe — Audio transcription via whisper.cpp
 * Accepts audio file (multipart), returns transcribed text
 */
import { Router } from 'express';
import multer from 'multer';
import { execFile } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

export const transcribeRouter: ReturnType<typeof Router> = Router();

const upload = multer({
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
  storage: multer.memoryStorage(),
});

const WHISPER_MODEL = process.env.WHISPER_MODEL || join(process.env.HOME || '/root', 'models', 'ggml-base.bin');
const WHISPER_BIN = process.env.WHISPER_BIN || 'whisper-server';

// Convert audio to WAV 16kHz mono using ffmpeg
async function toWav16k(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-i', inputPath, '-ar', '16000', '-ac', '1', '-f', 'wav', '-y', outputPath], { timeout: 30000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Transcribe using whisper.cpp CLI
async function transcribeWithWhisper(wavPath: string, lang: string = 'auto'): Promise<string> {
  // Use whisper-cli instead of whisper-server for one-shot transcription
  const whisperCli = process.env.WHISPER_CLI || 'whisper-cli';
  return new Promise((resolve, reject) => {
    const args = [
      '-m', WHISPER_MODEL,
      '-f', wavPath,
      '-l', lang,
      '--no-timestamps',
      '-nt', // no timestamps in output
    ];
    execFile(whisperCli, args, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        // Fallback: try whisper-server approach
        reject(new Error(`Whisper failed: ${stderr || err.message}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

transcribeRouter.post('/', upload.single('audio') as any, async (req: any, res: any) => {
  if (!req.file) {
    res.status(400).json({ error: 'No audio file provided' });
    return;
  }

  const id = randomBytes(8).toString('hex');
  const inputPath = join(tmpdir(), `vo-audio-${id}.webm`);
  const wavPath = join(tmpdir(), `vo-audio-${id}.wav`);
  const lang = (req.body?.lang as string) || 'auto';

  try {
    // Write uploaded file
    await writeFile(inputPath, req.file.buffer);

    // Convert to WAV 16kHz
    await toWav16k(inputPath, wavPath);

    // Transcribe
    const text = await transcribeWithWhisper(wavPath, lang);

    res.json({ ok: true, text, lang });
  } catch (err) {
    console.error('[transcribe] Error:', err);
    res.status(500).json({ error: 'Transcription failed', details: (err as Error).message });
  } finally {
    // Cleanup temp files
    await unlink(inputPath).catch(() => {});
    await unlink(wavPath).catch(() => {});
  }
});
