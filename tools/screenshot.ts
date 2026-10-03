/**
 * tools/screenshot.ts — headless visual verification helper (dev tool, not
 * part of the game bundle).
 *
 * Firefox's `--screenshot` CLI does not composite WebGL canvases, so we drive
 * a running headless Firefox over WebDriver BiDi instead: navigate, wait,
 * capture a compositor screenshot (WebGL included) and dump console output.
 *
 * Usage:
 *   1. start firefox:
 *      firefox --headless --no-remote --profile /tmp/ffprof2 \
 *        --remote-debugging-port=9222 about:blank
 *   2. bun tools/screenshot.ts <url> <out.png> [waitMs]
 */

const WS_URL = 'ws://127.0.0.1:9222/session';

const url = process.argv[2];
const out = process.argv[3];
const waitMs = Number(process.argv[4] ?? 4000);
if (!url || !out) {
  console.error('usage: bun tools/screenshot.ts <url> <out.png> [waitMs]');
  process.exit(2);
}

interface BiDiResponse {
  id?: number;
  /** Remote-agent errors come as top-level strings (not a nested object). */
  error?: string;
  message?: string;
  result?: unknown;
}

const logs: string[] = [];
let nextId = 0;
const pending = new Map<number, (r: BiDiResponse) => void>();

const ws = new WebSocket(WS_URL);

await new Promise<void>((resolve, reject) => {
  ws.addEventListener('open', () => resolve(), { once: true });
  ws.addEventListener('error', () => reject(new Error('ws connect failed')), {
    once: true,
  });
});

ws.addEventListener('message', (ev: MessageEvent<string>) => {
  const msg = JSON.parse(ev.data) as BiDiResponse;
  if (typeof msg.id === 'number') {
    const cb = pending.get(msg.id);
    if (cb) {
      pending.delete(msg.id);
      cb(msg);
    }
    return;
  }
  const m = msg as unknown as { method?: string; params?: Record<string, unknown> };
  if (m.method === 'log.entryAdded') {
    const e = m.params?.entry as
      | { level: string; text: string; timestamp?: number }
      | undefined;
    if (e) logs.push(`[${e.level}] ${e.text}`);
  }
});

function command(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, (r) => {
      if (r.error) reject(new Error(`${method}: ${r.error} — ${r.message ?? ''}`));
      else resolve(r.result);
    });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`${method}: timeout`));
      }
    }, 20000);
  });
}

try {
  await command('session.new', { capabilities: {} });
  await command('session.subscribe', { events: ['log.entryAdded'] });

  const tree = (await command('browsingContext.getTree')) as {
    contexts: { context: string }[];
  };
  const context = tree.contexts[0]?.context;
  if (!context) throw new Error('no browsing context');

  await command('browsingContext.navigate', { context, url, wait: 'complete' });
  await new Promise((r) => setTimeout(r, waitMs));

  const shot = (await command('browsingContext.captureScreenshot', {
    context,
    format: { type: 'png' },
  })) as { data: string };

  const fs = await import('node:fs');
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`saved ${out}`);

  console.log(
    logs.length ? `--- console ---\n${logs.join('\n')}` : '--- console: (empty) ---',
  );

  // Read anything the page put on screen (error overlay). Not all Firefox
  // builds expose script evaluation on the remote agent.
  try {
    const text = (await command('browsingContext.evaluate', {
      expression: 'document.body.innerText.slice(0, 1500)',
      target: { context },
      awaitPromise: false,
      resultOwnership: 'none',
    })) as { result: { type: string; value?: string } };
    if (text.result?.value?.trim()) {
      console.log(`--- page text ---\n${text.result.value}`);
    }
  } catch (err) {
    console.log(`page text unavailable: ${err instanceof Error ? err.message : err}`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  try {
    await command('session.end');
  } catch {
    // best effort
  }
  ws.close();
  await new Promise((r) => setTimeout(r, 300));
}
