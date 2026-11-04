import { query } from '@anthropic-ai/claude-agent-sdk';
import { mkdir, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Where generated apps are saved. One folder per project.
export const PROJECTS_DIR = process.env.PROJECTS_DIR
  ? path.resolve(process.env.PROJECTS_DIR)
  : path.resolve(here, '../../projects');

// The old README used CLAUDE_API_KEY; the SDK reads ANTHROPIC_API_KEY. Accept both.
if (!process.env.ANTHROPIC_API_KEY && process.env.CLAUDE_API_KEY) {
  process.env.ANTHROPIC_API_KEY = process.env.CLAUDE_API_KEY;
}

const BUILD_RULES = `
You are the code-generation engine of a "describe it and we build it" web app builder.
The user describes an app in plain language. Build it in the current working directory.

Rules:
- Build a self-contained static web app that works by opening index.html. No build step, no npm install.
- Use plain HTML, CSS and JavaScript (ES modules are fine). Put the entry point at ./index.html.
- You may load libraries from a CDN if really needed, but prefer none.
- Make it responsive and usable on a phone, with readable text sizes and good contrast.
- Save user data with localStorage where it makes sense; do not call external servers or APIs.
- If the folder already has an app, treat the request as a change to that app: read the existing files and edit them rather than starting over.
- Only create or edit files inside the current directory.
- When done, reply with 2-3 plain-language sentences saying what you built or changed. No code in the reply.
`.trim();

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{3,40}$/;

export function newProjectId() {
  return `app-${randomBytes(4).toString('hex')}`;
}

export function assertValidProjectId(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new Error('Invalid project id.');
  }
  return id;
}

export function projectPath(id) {
  return path.join(PROJECTS_DIR, assertValidProjectId(id));
}

/** List files in a project folder, relative paths, skipping hidden folders. */
export async function listProjectFiles(id, sub = '') {
  const root = projectPath(id);
  const out = [];
  async function walk(rel) {
    const entries = await readdir(path.join(root, rel), { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const next = path.join(rel, e.name);
      if (e.isDirectory()) await walk(next);
      else out.push(next.split(path.sep).join('/'));
    }
  }
  await walk(sub);
  return out.sort();
}

/**
 * Turn a plain-language prompt into a working app using the Claude Code SDK.
 *
 * @param {string} prompt           What the user wants built (or changed).
 * @param {object} [opts]
 * @param {string} [opts.projectId] Pass an existing id to keep editing that app.
 * @param {(event: object) => void} [opts.onEvent] Progress callback:
 *        {type:'start'|'text'|'tool'|'done'|'error', ...}
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.model]     Optional model override.
 * @param {number} [opts.maxTurns]  Safety cap on agent steps (default 30).
 * @returns {Promise<{projectId:string, dir:string, summary:string, files:string[], costUsd?:number}>}
 */
export async function generateCode(prompt, opts = {}) {
  const { projectId, onEvent = () => {}, signal, model, maxTurns = 30 } = opts;

  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('Please describe what you want to build.');
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('No API key found. Add ANTHROPIC_API_KEY to your .env file.');
  }

  const id = projectId ? assertValidProjectId(projectId) : newProjectId();
  const dir = projectPath(id);
  await mkdir(dir, { recursive: true });

  const abortController = new AbortController();
  if (signal) {
    if (signal.aborted) abortController.abort();
    else signal.addEventListener('abort', () => abortController.abort(), { once: true });
  }

  onEvent({ type: 'start', projectId: id });

  let summary = '';
  let costUsd;
  let failure;

  try {
    const stream = query({
      prompt: prompt.trim(),
      options: {
        cwd: dir,
        model,
        maxTurns,
        abortController,
        // Auto-approve file edits inside the project folder. Everything not listed below is denied.
        permissionMode: 'acceptEdits',
        allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
        disallowedTools: ['Bash', 'WebFetch', 'WebSearch'],
        systemPrompt: { type: 'preset', preset: 'claude_code', append: BUILD_RULES },
      },
    });

    for await (const msg of stream) {
      if (msg.type === 'assistant') {
        for (const block of msg.message?.content ?? []) {
          if (block.type === 'text' && block.text?.trim()) {
            onEvent({ type: 'text', text: block.text });
          } else if (block.type === 'tool_use') {
            const file = block.input?.file_path ? path.relative(dir, block.input.file_path) : undefined;
            onEvent({ type: 'tool', name: block.name, file });
          }
        }
      } else if (msg.type === 'result') {
        costUsd = msg.total_cost_usd;
        if (msg.subtype === 'success' && !msg.is_error) {
          summary = msg.result ?? '';
        } else {
          failure = msg.subtype === 'error_max_turns'
            ? 'The builder ran out of steps before finishing. Try a smaller request.'
            : `The builder stopped early (${msg.subtype}).`;
        }
      }
    }
  } catch (err) {
    failure = abortController.signal.aborted ? 'Cancelled.' : err.message || String(err);
  }

  const files = await listProjectFiles(id);

  if (failure) {
    onEvent({ type: 'error', message: failure });
    const e = new Error(failure);
    e.projectId = id;
    throw e;
  }

  const result = { projectId: id, dir, summary, files, costUsd };
  onEvent({ type: 'done', ...result });
  return result;
}
