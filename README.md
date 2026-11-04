# SCXML Visualizer

Paste SCXML, see the statechart. A single static page: no build step, no
server, no uploads. Everything runs in the browser.

## Running locally

Any static file server works. The included one also disables caching so
edits show up on refresh:

```bash
python3 serve.py 8765
```

Then open <http://localhost:8765/>. Opening `index.html` directly from disk
also works in most browsers, since the page uses classic scripts rather than
ES modules.

## Hosting

The page is plain static files with nothing to build, and it loads no
third-party resources at runtime, so pasted SCXML never leaves the visitor's
browser.

### Cloudflare Workers

Every push to `main` deploys the site as a Cloudflare Worker named
`scxml-visualizer` via `.github/workflows/deploy.yml`. The Worker has no
script of its own: `wrangler.toml` declares `dist/` as a static assets
directory, and the workflow copies `index.html`, `css/`, `js/` and `vendor/`
into `dist/` before running `wrangler deploy`. The first deploy creates the
Worker; later ones update it.

`wrangler.toml` also declares `scxml.kronor.io` as a custom domain. On the
first deploy Cloudflare creates the DNS record and certificate for it, as long
as the `kronor.io` zone is in the same account and no DNS record already
exists for that name. The Worker is also reachable at
`scxml-visualizer.<account>.workers.dev`.

The workflow runs in the `production` GitHub environment (Settings,
Environments), which only accepts `main` and requires approval from a
reviewer other than the person who pushed. Its two secrets live there, not in
repository or organisation secrets:

- `CF_API_TOKEN_WORKERS`: the Cloudflare account API token
  `scxml-visualizer-deploy` (Manage account, Account API tokens), with the
  single permission Account, Workers Scripts, Edit on the Kronor account. That
  permission also covers attaching the custom domain, so no zone permissions
  are needed. It does not cover Pages projects. It expires on 2027-11-04.
- `CF_ACCOUNT_ID`: the Cloudflare account id, shown on the Workers overview
  page.

Workers Scripts, Edit cannot be narrowed to one Worker or one hostname: whoever
holds the token can replace any Worker in the account and attach any unused
hostname in its zones. That is why the token sits behind the environment's
approval, and why it must not be shared with other repositories.

If either secret is missing the first workflow step fails with a message
saying so.

To deploy by hand instead, assemble `dist/` as the workflow does and run
`npx wrangler deploy` with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
set.

## Layout of the code

| Path | Role |
| --- | --- |
| `index.html` | Page shell: editor on the left, diagram on the right. |
| `css/style.css` | Page and diagram styling. |
| `js/parser.js` | Turns SCXML text into a state tree. XML well-formedness comes from the browser's `DOMParser`; SCXML checks (dangling targets, duplicate ids, unknown elements, bad `initial`) are done here. |
| `js/layout.js` | Maps the state tree onto an ELK graph and runs the layered layout with hierarchy support. |
| `js/render.js` | Draws the laid-out graph as SVG, with pan (drag) and zoom (wheel). Double-click fits the diagram. |
| `js/samples.js` | Example documents for the dropdown. |
| `js/app.js` | Wires everything together, debounces re-rendering while typing. |
| `vendor/elk.bundled.js` | [ELK](https://github.com/kieler/elkjs) 0.9.3, vendored so the page has no CDN dependency. License in `vendor/ELK-LICENSE.md`. |

## Notation

- Filled dot: initial state of a compound state or the document.
- Double-outlined box: `<final>`.
- Circle with `H` or `H*`: shallow or deep `<history>`.
- Solid box: `<state>`; a box containing boxes is a compound state.
- Box split by dashed lines: `<parallel>`, one partition per region with the region's name in its corner.
- Dashed arrow: transition with `type="internal"`.
- Lines under a state's title summarise its `<onentry>` and `<onexit>` actions
  and any `<invoke>`, one line per action (for example `send payment.start`).
- Arrow label: `event [cond]`.

Transitions without a `target` are not drawn.

Malformed XML blocks rendering and shows the parser's line and column. SCXML
problems such as a transition to a missing state or a duplicate id are
reported as well, but the diagram still renders with the offending parts left
out.

The theme follows the browser's light/dark preference. The Theme dropdown
overrides it, and the choice is remembered in the browser's local storage.
