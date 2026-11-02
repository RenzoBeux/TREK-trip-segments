// Builds both shipped artifacts, then asserts the things that would fail
// SILENTLY at runtime if we got them wrong.
//
// The client ships as ONE file: client/index.html, with the bundled CSS and JS
// inlined into it. It used to load ./app.js and ./app.css as subresources, and
// behind some reverse proxies those two requests died with a bare 500 — TREK's
// global cors() middleware throws "Not allowed by CORS" when a proxy forwards an
// Origin it does not recognise (#2). The frame's CSP also only re-allows the
// plugin's own asset URLs by interpolating the request's Host header, which a
// proxy can rewrite. Either way the tab rendered blank. An inline <script> and
// <style> make no requests at all, and the frame CSP explicitly allows them
// ('unsafe-inline' — the sandbox, not script-src, is the isolation boundary;
// plugin-frame.controller.ts).
//
// Why esbuild and not Vite, and why still IIFE: a `<script type="module">` is
// fetched in CORS mode from the frame's OPAQUE origin and is blocked in a real
// production TREK, so if anyone ever reintroduces an external bundle it must be
// a classic script. Inline, a module would at least run, but the IIFE keeps the
// two options interchangeable. Hence: format 'iife', and the assertions below.

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const shared = { bundle: true, legalComments: 'none', logLevel: 'warning' };

mkdirSync('server', { recursive: true });
mkdirSync('client', { recursive: true });

// The host injects `require('trek-plugin-sdk')` into the child process — a frozen
// shim exposing only definePlugin. It must stay external and unbundled.
await build({
  ...shared,
  entryPoints: ['src/server/index.ts'],
  outfile: 'server/index.js',
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['trek-plugin-sdk'],
});

const outputText = (result) => result.outputFiles[0].text;

const js = outputText(
  await build({
    ...shared,
    entryPoints: ['client-src/main.ts'],
    outfile: 'app.js',
    write: false,
    platform: 'browser',
    target: 'es2020',
    format: 'iife',
  }),
);

const css = outputText(
  await build({
    ...shared,
    entryPoints: ['client-src/app.css'],
    outfile: 'app.css',
    write: false,
  }),
);

// Inside <script>/<style> raw text, the only thing that can end the element
// early is its own closing tag. `<\/` is the same string in JS (a string,
// template or regex alike), and CSS has no reason to contain `</style` at all.
const inlineJs = js.replace(/<\/(script)/gi, (_, tag) => `<\\/${tag}`);
assert.ok(!/<!--/.test(inlineJs), 'the client bundle contains "<!--", which changes how <script> text is parsed');
assert.ok(!/<\/style/i.test(css), 'the client stylesheet contains "</style"');

const template = readFileSync('client-src/index.html', 'utf8');
assert.ok(template.includes('<!-- seg:app-css -->'), 'client-src/index.html lost the <!-- seg:app-css --> marker');
assert.ok(template.includes('<!-- seg:app-js -->'), 'client-src/index.html lost the <!-- seg:app-js --> marker');

// Function replacers on purpose: a string replacement would expand `$&`, `$'`
// and friends wherever they occur in the bundle.
const html = template
  .replace('<!-- seg:app-css -->', () => `<style>\n${css}</style>`)
  .replace('<!-- seg:app-js -->', () => `<script>\n${inlineJs}</script>`);
writeFileSync('client/index.html', html);

// Earlier builds wrote these. Left behind they would ship in the zip, unused.
for (const stale of ['client/app.js', 'client/app.css']) rmSync(stale, { force: true });

// ---------------------------------------------------------------------------
// Guard rails. Each of these fails in a way that produces NO console output and
// NO server error — a blank white tab — so they have to be caught here.
// ---------------------------------------------------------------------------

// Without the marker, `pack`/`dev` inject nothing, window.trek is undefined, and
// the tab renders blank with an empty console.
assert.ok(html.includes('<!-- trek:ui -->'), 'client/index.html lost the <!-- trek:ui --> marker');

// The whole point of #2: the page must not fetch anything of its own.
assert.ok(!/<script\b[^>]*\bsrc\s*=/i.test(html), 'client/index.html loads an external script');
assert.ok(!/<link\b[^>]*\bstylesheet\b/i.test(html), 'client/index.html loads an external stylesheet');

// A module script (or a `crossorigin` attribute) is the CORS trap described above.
assert.ok(
  !/type\s*=\s*["']module["']/.test(html),
  'client/index.html uses <script type="module"> — blocked at the opaque origin in production',
);
assert.ok(!/\bcrossorigin\b/.test(html), 'client/index.html has a crossorigin attribute — same CORS trap');

// Belt and braces: prove the emitted bundle really is a classic script.
assert.ok(!/^\s*(?:import|export)\s/m.test(js), 'the client bundle is not a classic IIFE');

// The plugin child process has no node_modules — the bundle must be fully
// self-contained. (`trek-plugin-sdk` is listed external as a guard, but we do
// not import it: definePlugin is an identity function and our own host-types.ts
// types the definition more precisely than the published SDK does.)
const serverJs = readFileSync('server/index.js', 'utf8');
const externalRequire = serverJs.match(/\brequire\(\s*["'][^"']+["']\s*\)/);
assert.ok(
  externalRequire === null,
  `server/index.js is not self-contained — it still calls ${externalRequire?.[0]}`,
);

// ---------------------------------------------------------------------------
// Staging directory for `trek-plugin dev-link`.
//
// TREK refuses to link a directory containing native binaries, and its scanner
// walks EVERYTHING — unlike `pack`, it has no node_modules skip list
// (server/src/nest/plugins/install/native-scan.ts:13). Our devDependencies pull
// in @rollup/rollup-win32-*.node via vitest, so linking the repo root always
// fails with "directory contains native binaries".
//
// So we mirror exactly the file set `pack` ships into a clean directory and link
// THAT. The plugin id comes from the manifest rather than the folder name
// (plugin-runtime.service.ts:787), so the directory may be called anything, and
// refreshing it on every build keeps the host's re-fork watcher pointed at
// current code.
// ---------------------------------------------------------------------------
const LINK_DIR = '.link';
const ROOT_FILES = ['trek-plugin.json', 'README.md', 'LICENSE', 'package.json'];

// Overwrite in place rather than wiping first: once TREK has dev-linked this
// directory it holds a junction into it, and Windows answers EPERM to a
// recursive remove of a junction target that is in use. The shipped file set is
// fixed, so copying over the top is equivalent.
mkdirSync(LINK_DIR, { recursive: true });
for (const file of ROOT_FILES) {
  if (existsSync(file)) cpSync(file, `${LINK_DIR}/${file}`);
}

for (const dir of ['server', 'client']) {
  cpSync(dir, `${LINK_DIR}/${dir}`, { recursive: true });
}
for (const stale of ['client/app.js', 'client/app.css']) rmSync(`${LINK_DIR}/${stale}`, { force: true });

/**
 * Expand `<!-- trek:ui -->` in the staged copy.
 *
 * `pack` and `trek-plugin dev` both inject the design kit at that marker, but the
 * HOST does not — plugin-frame.controller.ts just sendFile()s whatever is on
 * disk. So a dev-linked plugin serves the raw marker, `window.trek` is never
 * defined, and the tab dies with "could not reach TREK".
 *
 * client/index.html therefore keeps the marker (that is the shipping source, and
 * pack expands it at zip time), while the linked mirror gets it expanded here —
 * using the same SDK the CLI uses, so what we dev-link matches what we ship.
 */
async function loadKitInjector() {
  // The pinned devDependency wins, so what we dev-link is the kit `pack` ships.
  // An unreleased checkout is opt-in through TREK_SDK_DIST / TREK_REPO.
  const overrides = [
    process.env.TREK_SDK_DIST,
    process.env.TREK_REPO && path.join(process.env.TREK_REPO, 'plugin-sdk/dist/index.js'),
  ].filter(Boolean);

  for (const candidate of overrides) {
    if (existsSync(candidate)) return (await import(pathToFileURL(candidate).href)).injectTrekUi;
  }
  return (await import('trek-plugin-sdk')).injectTrekUi;
}

const injectTrekUi = await loadKitInjector();
const linkedHtml = injectTrekUi(readFileSync('client/index.html', 'utf8'));
writeFileSync(`${LINK_DIR}/client/index.html`, linkedHtml);

assert.ok(!linkedHtml.includes('<!-- trek:ui -->'), `${LINK_DIR}/client/index.html still has an unexpanded marker`);
assert.ok(linkedHtml.includes('<script data-trek-ui>'), `${LINK_DIR}/client/index.html is missing the design kit`);

console.log('build ok — server/index.js, client/index.html (CSS and JS inlined)');
console.log(`dev-link dir refreshed — ${process.cwd()}\\${LINK_DIR}`);
