# Space Transfers documentation

Space Transfers is a marketplace for DTF (direct-to-film) gang sheets. A customer arranges artwork on a sheet the width of the print roll and pays for it. The order goes to a print partner near them, who prints and ships it. The business runs everything from an admin console.

This folder covers the whole system. Each app's own README covers that app in detail.

## Start here

| If you are | Read |
| --- | --- |
| Taking over the project | [HANDOVER.md](HANDOVER.md): where things stand, what's left, who owns what |
| Writing code | [DEVELOPMENT.md](DEVELOPMENT.md), then [ARCHITECTURE.md](ARCHITECTURE.md) |
| Deploying or running production | [OPERATIONS.md](OPERATIONS.md) |
| About to change how something behaves | [DECISIONS.md](DECISIONS.md): the product rules, and why each one is the way it is |

## The apps

| Folder | App | Its README covers |
| --- | --- | --- |
| [space-transfer-server](../space-transfer-server/README.md) | The API, used by all three front ends | Configuration, deploying, order flow, shipping, the rights check, money, background jobs, scripts, backups |
| [space-transfers](../space-transfers/README.md) | The store and gang sheet builder | What customers can do, configuration, layout |
| [space-transfers-admin](../space-transfers-admin/README.md) | The admin console | What admins can do, payouts, admin accounts |
| [space-transfer-printer](../space-transfer-printer/README.md) | The print partner portal | What partners can do, how a job moves |

Deeper references in the API:

- [PAYMENTS.md](../space-transfer-server/PAYMENTS.md): card payments, Stripe Connect payouts, endpoints.
- [AI_EDITING.md](../space-transfer-server/AI_EDITING.md): AI image edits and board commands.
- [SUBACCOUNT_TESTING.md](../space-transfer-server/SUBACCOUNT_TESTING.md): calling the sub-account endpoints by hand with curl.
- [.env.example](../space-transfer-server/.env.example): every setting, what it does and what happens without it.

Production is described by [render.yaml](../render.yaml) at the root of this repository.
