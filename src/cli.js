import 'dotenv/config';
import { generateCode } from './services/claude.js';

// Usage: npm run generate -- "a recipe box app" [existing-project-id]
const [prompt, projectId] = process.argv.slice(2);

if (!prompt) {
  console.error('Usage: npm run generate -- "describe your app" [project-id-to-edit]');
  process.exit(1);
}

try {
  const result = await generateCode(prompt, {
    projectId,
    onEvent(e) {
      if (e.type === 'start') console.log(`Project: ${e.projectId}`);
      if (e.type === 'tool' && e.file) console.log(`  ${e.name}: ${e.file}`);
    },
  });
  console.log(`\n${result.summary}\n`);
  console.log(`Saved in: ${result.dir}`);
  console.log(`Files: ${result.files.join(', ')}`);
  console.log(`Open ${result.dir}/index.html in a browser, or run "npm start" to preview.`);
} catch (err) {
  console.error(`\nSomething went wrong: ${err.message}`);
  process.exit(1);
}
