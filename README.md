# Space Transfers

DTF gang sheet ordering, printed and shipped by a network of print partners.

| Folder | App | Deployed as |
| --- | --- | --- |
| `space-transfer-server` | API (Express, MongoDB) | Render web service (Docker) |
| `space-transfers` | Customer store and gang sheet builder | Render static site |
| `space-transfers-admin` | Admin console | Render static site |
| `space-transfer-printer` | Print partner portal | Render static site |

Each app has its own README, `package.json`, lockfile and `.env.example`;
install, run and test it from its own folder. `render.yaml` describes all four
services; each redeploys only when its own folder changes.

Secrets never go in git. Every secret in `render.yaml` is `sync: false` and is
set in the Render dashboard.

## Documentation

Start with [docs/](docs/README.md): the handover, architecture, development,
operations, and the product decisions behind the rules in the code.
