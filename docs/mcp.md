# MCP endpoint

AI assistants can work with a group's money through `/api/mcp`, an
[MCP](https://modelcontextprotocol.io) server: ask Claude what went on groceries this month or how
the budget is holding up, or have it record a coffee, fix a category or set next month's budget.
It views by default. Adding, editing and deleting are separate permissions, each off until ticked.

In production the address is `https://finance-api.tfc-russia.xyz/api/mcp`.

## Connecting

### Claude (web, desktop and phone)

1. In Claude, open **Settings → Connectors → Add custom connector**.
2. Name it, say *Finance Pal*, and enter the address above. Leave the authentication settings
   as they are.
3. Choose **Connect**. Claude opens Finance Pal's consent page. Sign in if asked, pick the group
   Claude may work in, tick what it may do besides viewing, and choose **Allow**.

The connector then works wherever you use Claude. A connector added on the web shows up in the
desktop and phone apps too.

### Claude Code and other MCP clients

Add the server and sign in the same way:

```sh
claude mcp add --transport http finance-pal https://finance-api.tfc-russia.xyz/api/mcp
```

Then run `/mcp` in Claude Code to sign in. A client that can't sign in can send an
[API key](external-api.md#api-keys) made in the app instead. Give it the view scopes it should
have:

```sh
claude mcp add --transport http finance-pal https://finance-api.tfc-russia.xyz/api/mcp \
  --header "Authorization: Bearer fpk_…"
```

## What an assistant gets

Signing in gives the assistant an API key of its own. It works in one group, as the person who
allowed it. It gets every view scope, and only the add, edit and delete scopes ticked on the consent
page, within what the person's role allows. The key is listed in the group's settings
under **API keys**, by the name the assistant gave itself, usually *Claude*. Deleting it there
disconnects the assistant at once. The key doesn't expire otherwise. When the same assistant
connects to the group again, its new key replaces the old one. The assistant is known by its name
and the address it signs in through. Keys made in the app are never replaced. To give a connected
assistant more or less to do, edit its key's permissions there. Its next call goes by them, though
an assistant may only list new tools in a new chat.

Each tool needs a scope, and a key only gets the tools it has scopes for:

| Tool                    | Scope               | Answers                                                                   |
| ----------------------- | ------------------- | ------------------------------------------------------------------------- |
| `list_accounts`         | `accounts:read`     | accounts with their balances, and the group's total in the main currency |
| `list_categories`       | `categories:read`   | categories with their subcategories                                       |
| `search_transactions`   | `transactions:read` | transactions by dates, type, account, category or note, a page at a time  |
| `summarize_by_category` | `transactions:read` | a month's or a range's spending and income by category, as the overview   |
| `list_series`           | `transactions:read` | repeating series: each payment, how often, the next one and when it ends  |
| `get_budget`            | `budgets:read`      | a month's budget lines against what was recorded and planned              |

And the tools that change the group, each through the same service as the app, so a role or a
validation rule can't differ:

| Tool                 | Scope                                        | Does                                                           |
| -------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| `add_transaction`    | `transactions:create`                        | plans an expense, an income or a transfer, by names            |
| `update_transaction` | `transactions:update`                        | changes a planned one; null clears a category                  |
| `delete_transaction` | `transactions:delete`                        | deletes a planned one                                          |
| `add_series`         | `transactions:create`                        | sets up a repeating series, starting after now                 |
| `update_series`      | `transactions:update`                        | changes a series from its next payment on, ends or pauses it   |
| `end_series`         | `transactions:delete`                        | ends a series now, its planned payment kept if asked           |
| `add_account`        | `accounts:create`                            | creates an account, in the main currency unless named          |
| `update_account`     | `accounts:update`                            | renames, retypes, archives or brings back an account           |
| `delete_account`     | `accounts:delete` and `transactions:delete`  | deletes an account with no history, and counts its plans       |
| `add_category`       | `categories:create`                          | creates a category or a subcategory                            |
| `update_category`    | `categories:update`                          | renames, moves, archives or brings back a category             |
| `delete_category`    | `categories:delete`                          | deletes a category; its transactions stay, uncategorized       |
| `set_budget`         | `budgets:create`, or `budgets:update`        | adds a month's line, or changes the one it has                 |
| `remove_budget_line` | `budgets:delete`                             | takes a line out of a month's budget                           |

Transactions are written only while planned, dated after now: an assistant schedules, moves and
calls off payments to come. What already happened, the history balances are checked against, is
only changed in the app, and an account with any of it is only deleted there. A date given as a
day is dated at noon, as the app dates a day to come. A change is answered only once it's saved.

A transaction whose amount the app works out says how, under `amountFrom`: a percentage of a
fixed amount or of the account balance, or `roundsBalanceTo`, whatever leaves the balance on a
round multiple. With `followsBalance` it's a planned amount still recalculated each time the
balance changes, until its date, so it moves on its own. One from a repeating series names the
series under `series`, and `editedApartFromSeries` when that occurrence was edited on its own. Such
an amount can't be typed over through `update_transaction`; how it's worked out is changed with
`update_series`, or in the app for a one-off.

A series keeps one planned payment at a time, as in the app. `update_series` changes it from that
payment on and leaves what happened, and a payment edited on its own, as they were; to change only
the next payment, `update_transaction` edits it. A series can end on a day, `endsOn`, or after so
many payments, which is turned into the day of the last one, counted from the next. `end_series`
ends it at once and can't be undone, so to stop one for a while it's paused instead.

Totals are in the key owner's main currency, at the app's rates. A currency with no rate is left
out of a total and named under `currenciesWithoutRate`.

Calendar days are counted in the time zone of the browser that allowed the assistant, or made the
key. A tool call can name another zone with `timeZone`. Keys made before keys had a time zone
count in UTC.

## How sign-in works

The API is its own OAuth 2.1 authorization server, the way MCP's authorization spec describes:

1. A request without a key gets `401` with
   `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/api/mcp"`.
2. That document (RFC 9728) names the API as the authorization server. Its metadata (RFC 8414) is
   at `/.well-known/oauth-authorization-server`.
3. The assistant registers itself at `/api/oauth/register` (RFC 7591). Nothing is stored: the
   client id carries the registration, signed with a key derived from `JWT_ACCESS_SECRET`.
4. It sends the browser to `/api/oauth/authorize`, which checks the request and hands it on to
   the web app's `/oauth/consent` page. Only the code flow with PKCE (S256) is taken.
5. Allowing makes a one-time code, kept by its hash for five minutes in `oauth_codes`. The
   assistant trades it at `/api/oauth/token` for the key. The trade uses the code up, whether or
   not it succeeds.

No refresh tokens are issued: the key stays valid until it's deleted.

## Deploying

Sign-in needs two settings, both or neither. Without them, `/api/mcp` takes API keys only:

```sh
PUBLIC_API_URL=https://finance-api.tfc-russia.xyz      # the API's public origin, no path
WEB_APP_URL=https://koenigstag.github.io/finance-pal  # where the web app is served, no trailing slash
```

`deploy/vps/init-env.sh` adds both to the server's env file on the next deploy.

Clients look for the discovery documents at the root of the origin, which nginx doesn't proxy
by default. `deploy/vps/root-setup.sh` adds the route, `nginx-finance-api-oauth.conf`, and
reloads nginx. Run it once after the deploy:

```sh
ssh -t hetzner-vps "sudo bash ~/services/finance-pal/deploy/vps/root-setup.sh"
```
