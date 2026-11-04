# Loveable Clone

Type what you want in plain language, and Claude builds it as a small working web app. Keep typing to ask for changes.

Built on the [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview) (`@anthropic-ai/claude-agent-sdk`, the current name of the Claude Code SDK).

## Scope (version 0.1)

One thing, done well: **a function that takes a prompt and uses Claude Code to build it.**

```js
import { generateCode } from './src/services/claude.js';

const { projectId, dir, summary, files } = await generateCode('A big-button medication checklist');

// Ask for a change to the same app:
await generateCode('Make the text bigger', { projectId });
```

Each app is saved in its own folder under `projects/`, as plain HTML/CSS/JS that works by opening `index.html`.

## Setup

You need Node.js 18 or newer and an Anthropic API key.

```bash
npm install
cp .env.example .env     # then put your key in .env
```

## Use it

**In the browser** (prompt box, live preview, follow-up changes):

```bash
npm start
```

Open http://localhost:3000.

**From the command line:**

```bash
npm run generate -- "a recipe box app"
npm run generate -- "add a search box" app-1a2b3c4d     # edit an existing app
```

## How it works

| File | What it does |
|---|---|
| `src/services/claude.js` | `generateCode(prompt, { projectId, onEvent, signal })`. Runs the SDK's `query()` inside the project folder. |
| `src/server.js` | Web server. `POST /api/generate` streams progress; previews are served on a second port. |
| `src/cli.js` | Command-line wrapper. |
| `public/index.html` | The prompt box and preview page. |

## Safety choices

- Claude can only **read, write, edit, and search files** in the project folder. Shell commands and web access are turned off.
- The server listens on your own computer only (`127.0.0.1`). It has no login, so don't expose it to the internet: anyone who could reach it could spend your API credits.
- One build runs at a time, and each build is capped at 30 steps.
- Previews run on a different port than the builder, in a sandboxed frame, so a generated app can't reach the builder page.

## Settings (`.env`)

`ANTHROPIC_API_KEY` (required), and optionally `PORT`, `PREVIEW_PORT`, `HOST`, `PROJECTS_DIR`.

## Ideas for later

- [ ] Project list and history
- [ ] Undo a change (git per project)
- [ ] Multi-file frameworks such as React, with a build step
- [ ] Publish an app to a public link
- [ ] Sign-in, so it can be shared safely
