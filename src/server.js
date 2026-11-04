import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import {
  generateCode,
  listProjectFiles,
  assertValidProjectId,
  PROJECTS_DIR,
} from './services/claude.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || '127.0.0.1'; // local only by default: this spends your API credits
const PORT = Number(process.env.PORT) || 3000;
const PREVIEW_PORT = Number(process.env.PREVIEW_PORT) || PORT + 1;

await mkdir(PROJECTS_DIR, { recursive: true });

/* ---------- Builder app (prompt box + API) ---------- */
const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.resolve(here, '../public')));

let busy = false; // one build at a time keeps costs predictable

app.post('/api/generate', async (req, res) => {
  const { prompt, projectId } = req.body ?? {};

  if (typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'Please describe what you want to build.' });
  }
  if (prompt.length > 4000) {
    return res.status(400).json({ error: 'That prompt is too long. Please keep it under 4000 characters.' });
  }
  if (projectId) {
    try { assertValidProjectId(projectId); } catch { return res.status(400).json({ error: 'Invalid project id.' }); }
  }
  if (busy) {
    return res.status(429).json({ error: 'A build is already running. Please wait for it to finish.' });
  }

  busy = true;
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const controller = new AbortController();
  let finished = false;
  res.on('close', () => { if (!finished) controller.abort(); });

  const send = (obj) => { if (!res.writableEnded) res.write(JSON.stringify(obj) + '\n'); };

  try {
    await generateCode(prompt, { projectId, signal: controller.signal, onEvent: send });
  } catch (err) {
    // generateCode already emitted an 'error' event for build failures; cover setup errors too.
    if (!res.writableEnded) send({ type: 'error', message: err.message });
  } finally {
    finished = true;
    busy = false;
    res.end();
  }
});

app.get('/api/projects/:id/files', async (req, res) => {
  try {
    res.json({ files: await listProjectFiles(req.params.id) });
  } catch {
    res.status(400).json({ error: 'Invalid project id.' });
  }
});

app.get('/api/config', (_req, res) => {
  res.json({ previewOrigin: `http://localhost:${PREVIEW_PORT}`, hasKey: Boolean(process.env.ANTHROPIC_API_KEY) });
});

/* ---------- Preview server (separate origin so generated apps can't touch the builder) ---------- */
const preview = express();
preview.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
preview.use('/p', express.static(PROJECTS_DIR, { index: 'index.html', dotfiles: 'deny' }));

app.listen(PORT, HOST, () => {
  console.log(`Builder:  http://localhost:${PORT}`);
});
preview.listen(PREVIEW_PORT, HOST, () => {
  console.log(`Previews: http://localhost:${PREVIEW_PORT}/p/<project-id>/`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('\nNo ANTHROPIC_API_KEY found. Copy .env.example to .env and add your key.');
  }
});
