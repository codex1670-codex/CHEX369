// Wires CODEX AI together with the real providers, the app database and the uploads folder.
import { aiConfig } from './config.js';
import { ensureAiSchema } from './schema.js';
import { createSettings } from './settings.js';
import { createUsage } from './usage.js';
import { createMemory } from './memory/index.js';
import { createMedia } from './media.js';
import { createGroq } from './providers/groq.js';
import { createCloudflare } from './providers/cloudflare.js';
import { createVideo } from './providers/pollinations.js';
import { createCodexAI } from './orchestrator.js';
import { parseCommand } from '../nlu.js';

// Everything is injectable so tests can run the whole stack against stub providers and a throw-away database.
export function buildCodexAI({ db, uploadsRoot, env = process.env, fetchImpl = fetch, memory, now } = {}) {
  const config = aiConfig(env);
  ensureAiSchema(db);
  const settings = createSettings({ db, config });
  const usage = createUsage({ db, config, settings, now });
  const media = createMedia({ db, uploadsRoot });
  const providers = {
    groq: createGroq(config.groq, fetchImpl),
    cloudflare: createCloudflare(config.cloudflare, fetchImpl),
    video: createVideo(config.video, fetchImpl),
  };
  const mem = memory || createMemory({ db, config });
  const codex = createCodexAI({ config, settings, usage, memory: mem, media, providers, parse: parseCommand, now });
  return { config, settings, usage, media, providers, memory: mem, codex };
}
