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

### Cloudflare Pages

Every push to `main` deploys to the Cloudflare Pages project
`scxml-visualizer` via `.github/workflows/deploy.yml`. The workflow copies
`index.html`, `css/`, `js/` and `vendor/` into `dist/` and publishes that with
wrangler. It creates the Pages project on the first run if it does not exist.

It needs two kronor-io organisation secrets, `CF_API_TOKEN_PAGES` and
`CF_ACCOUNT_ID`, shared with this repository. If they are missing the first
step fails with a message saying so; an organisation owner shares them under
Organisation settings, Secrets and variables, Actions, repository access.

The site is served at `https://scxml-visualizer.pages.dev`. To serve it at
`scxml.kronor.io`, open the Pages project in the Cloudflare dashboard, go to
Custom domains, and add `scxml.kronor.io`. The `kronor.io` zone is in the same
account, so Cloudflare creates the CNAME record and certificate itself. If the
team prefers the DNS record in Terraform, add a CNAME from `scxml` to
`scxml-visualizer.pages.dev` in the kronor repo's `kronor-prod/external` stack
and then add the custom domain in the Pages project.

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
