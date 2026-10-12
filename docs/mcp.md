# MCP endpoint

AI assistants can read a group's money through `/api/mcp`, an [MCP](https://modelcontextprotocol.io)
server: ask Claude what went on groceries this month, how the budget is holding up, or what a
transfer last week was for. It only reads: nothing an assistant does through it adds, changes or
deletes anything.

In production the address is `https://finance-api.tfc-russia.xyz/api/mcp`.

## Connecting

### Claude (web, desktop and phone)

1. In Claude, open **Settings → Connectors → Add custom connector**.
2. Name it, say *Finance Pal*, and enter the address above. Leave the authentication settings
   as they are.
3. Choose **Connect**. Claude opens Finance Pal's consent page. Sign in if asked, pick the group
   Claude may see, and choose **Allow**.

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

Signing in gives the assistant an API key of its own. It sees one group, as the person who
allowed it, with every view scope and nothing else. The key is listed in the group's settings
under **API keys**, by the name the assistant gave itself, usually *Claude*. Deleting it there
disconnects the assistant at once. The key doesn't expire otherwise.

Each tool needs a scope, and a key only gets the tools it has scopes for:

| Tool                    | Scope               | Answers                                                                   |
| ----------------------- | ------------------- | ------------------------------------------------------------------------- |
| `list_accounts`         | `accounts:read`     | accounts with their balances, and the group's total in the main currency |
| `list_categories`       | `categories:read`   | categories with their subcategories                                       |
| `search_transactions`   | `transactions:read` | transactions by dates, type, account, category or note, a page at a time  |
| `summarize_by_category` | `transactions:read` | a month's or a range's spending and income by category, as the overview   |
| `get_budget`            | `budgets:read`      | a month's budget lines against what was recorded and planned              |

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
