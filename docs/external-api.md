# External API

Other apps can read and change a group's transactions, accounts and categories through
`/api/external/v1`, authenticated with an API key. It was made for phone automations that turn
bank notifications into transactions, and works for any script or tool that can send an HTTP
request.

It is separate from the routes the web app uses and versioned on its own: a change that would
break a client comes as `/api/external/v2`, never as a change to v1. The contract is
[`libs/shared/contracts/src/lib/external/external.contract.ts`](../libs/shared/contracts/src/lib/external/external.contract.ts).

## API keys

Create one in the app: open a group's settings, then **API keys**, then **New key**. The key is
shown once, with the address to send requests to and an example request. Only a hash of it is
stored, so a lost key can't be recovered: delete it and make another.

A key belongs to the person who made it and works in **one group**, acting as that person:

- It never does more than they may. A viewer's key only reads, and in an archived group every
  key only reads.
- It stops working when they leave the group or are removed from it, and when it expires, if an
  expiry was chosen.
- Deleting it takes effect at once. Changing what it may do keeps the key, so the app holding
  it needn't be touched.
- Nobody else in the group sees it, the owner included.

What a key may do is set per resource:

| Scope                  | Allows                                        |
| ---------------------- | --------------------------------------------- |
| `transactions:read`    | listing and reading transactions              |
| `transactions:create`  | recording transactions                        |
| `transactions:update`  | changing transactions                         |
| `accounts:read`        | listing and reading accounts, with balances   |
| `accounts:create`      | creating accounts                             |
| `accounts:update`      | changing accounts                             |
| `categories:read`      | listing and reading categories                |
| `categories:create`    | creating categories and subcategories         |
| `categories:update`    | renaming and moving categories                |

Nothing is ever deleted through this API: that stays in the app.

Recording transactions from notifications needs `transactions:create` only. Accounts and
categories can be named without reading them.

## Requests

Send the key in a header, either one; `X-Api-Key` wins if a request has both:

```http
Authorization: Bearer fpk_…
X-Api-Key: fpk_…
```

Never put it in the URL: addresses end up in server and proxy logs. Access tokens from the web
app don't work here, and keys don't work anywhere else.

Bodies are JSON (`Content-Type: application/json`). Recording and changing transactions also
accepts `application/x-www-form-urlencoded`, since every field of those is text.

Errors come back as `{ "statusCode": 400, "message": "…" }`. A body that doesn't fit the schema
also lists every problem, each with the field's `path`, under `bodyResult.issues`; `message` is
the first of them, like `amount: Expected an amount like "125.50"…`.

| Status | Means                                                                          |
| ------ | ------------------------------------------------------------------------------ |
| 400    | the request is wrong: the message says what                                    |
| 401    | no key, or one that doesn't exist, was deleted or has expired                  |
| 403    | the key lacks the route's scope, or its owner's role doesn't allow the change  |
| 404    | nothing with that id or name in the key's group                                |

`GET /key` answers any valid key with its scopes and its group, which makes it a good first
request when setting up a client:

```sh
curl https://<api host>/api/external/v1/key -H "Authorization: Bearer fpk_…"
```

### Names instead of ids

Wherever a body refers to an account or a category it may give the id (`accountId`) or the name
(`accountName`), not both. Names are compared without regard to case, surrounding spaces or how
an accented letter is encoded. When an active and an archived one share a name, the active one
is meant. A name several active ones share is refused, asking for the id.

Ids are what the list endpoints return. They don't change when something is renamed; names do.

### Amounts, dates and currencies

- Amounts are text like `"125.50"` or `"1 250,50"`: digits, optionally grouped by spaces, and up
  to two decimals after a point or a comma. A JSON number such as `125.5` works too. Anything
  that would take a guess is refused: `"1.234"` could be a thousand or three decimals, and
  `"1,234.50"` mixes separators. Amounts are never negative; the type says which way money went.
- Dates are ISO 8601 with a UTC offset: `2026-09-18T14:05:00+03:00` or `2026-09-18T11:05:00Z`.
  Left out when recording a transaction, the date is the moment the request arrives.
- Currencies are ISO 4217 codes (`UAH`). A transaction is always in its account's currency.

## Endpoints

All paths start with `/api/external/v1`.

| Method  | Path                              | Scope                  |
| ------- | --------------------------------- | ---------------------- |
| `GET`   | `/key`                            | any key                |
| `GET`   | `/transactions`                   | `transactions:read`    |
| `GET`   | `/transactions/:transactionId`    | `transactions:read`    |
| `POST`  | `/transactions`                   | `transactions:create`  |
| `PATCH` | `/transactions/:transactionId`    | `transactions:update`  |
| `GET`   | `/accounts`                       | `accounts:read`        |
| `GET`   | `/accounts/:accountId`            | `accounts:read`        |
| `POST`  | `/accounts`                       | `accounts:create`      |
| `PATCH` | `/accounts/:accountId`            | `accounts:update`      |
| `GET`   | `/categories`                     | `categories:read`      |
| `GET`   | `/categories/:categoryId`         | `categories:read`      |
| `POST`  | `/categories`                     | `categories:create`    |
| `PATCH` | `/categories/:categoryId`         | `categories:update`    |

## Recording a transaction

`POST /transactions`:

| Field                                  | For                   | Notes                                                                    |
| -------------------------------------- | --------------------- | ------------------------------------------------------------------------ |
| `type`                                 | all                   | `expense`, `income` or `transfer`                                        |
| `amount`                               | all                   | see above                                                                |
| `accountId` / `accountName`            | all                   | left out: the group's favourite account                                  |
| `date`                                 | all                   | left out: now                                                            |
| `note`                                 | all                   | up to 1000 characters                                                    |
| `categoryId` / `categoryName`          | expenses and income   | optional; a category of the transaction's type                           |
| `subcategoryId` / `subcategoryName`    | expenses and income   | optional; a subcategory of that category                                 |
| `toAccountId` / `toAccountName`        | transfers             | required                                                                 |
| `destAmount`                           | transfers             | what arrived; required exactly when the two accounts' currencies differ  |
| `idempotencyKey`                       | all                   | optional; see [Sending a request more than once](#sending-a-request-more-than-once) |

A subcategory may also be named as the category (`"categoryName": "Taxi"`), and a subcategory
named alone brings its category along, as long as no other category has one called the same.

```sh
# An expense, by names
curl -X POST https://<api host>/api/external/v1/transactions \
  -H "Authorization: Bearer fpk_…" -H "Content-Type: application/json" \
  -d '{"type":"expense","amount":"1 250,50","accountName":"Monobank","categoryName":"Groceries","note":"Silpo"}'

# A transfer that converts
curl -X POST https://<api host>/api/external/v1/transactions \
  -H "Authorization: Bearer fpk_…" -H "Content-Type: application/json" \
  -d '{"type":"transfer","amount":"4150","accountName":"Monobank","toAccountName":"Wise EUR","destAmount":"90.20"}'
```

The response is the transaction, with `201 Created`.

### Sending a request more than once

A bank may post the same notification twice, and a client may send a request again when it never
got the answer. Give such a request an idempotency key and a repeat records nothing: it gets the
transaction the first request recorded, with `201` and a header `Idempotent-Replayed: true`.

```http
Idempotency-Key: 5d1c4f3e-8a9b-4d2e-9f61-0c7e2b3a4d5f
```

- The key is any text up to 1000 characters that stays the same for a repeat and changes for a
  new transaction: a UUID the client keeps with the request, or a notification's own text, which
  usually carries the balance after the payment. Only a digest of it is stored.
- It goes in the `Idempotency-Key` header or in the body as `idempotencyKey`, and a request with
  both must use one key. Use the body for text a header can't carry: HTTP clients on Android
  refuse a header with Cyrillic in it, and no header holds a line break.
- Keys belong to the group and don't expire. A transaction deleted in the app keeps its key, so a
  repeat can't bring it back; it's answered like the first request.
- A repeat may differ in its date, note and category, and still gets the first transaction. The
  same key with a different amount, account or type is refused with `422`: the key isn't telling
  transactions apart, and quietly dropping the second one would lose money from the records.
- A request that failed keeps nothing: correct it and send it again with the same key.
- Copies arriving at the same moment still record one transaction.

`PATCH /transactions/:transactionId` takes the same fields except `type`, which never changes.
What a request leaves out stays as it was. A new category drops a subcategory the request
doesn't name again, `null` clears a category or a subcategory, and an empty `note` clears the
note.

`GET /transactions` lists them newest first, 50 at a time (`limit` up to 200). Pass the
response's `nextCursor` as `cursor` for the next page. It filters by `accountId`, `categoryId` (a
category takes in its subcategories' transactions), `type`, `dateFrom`, `dateTo` and `search`,
which looks in notes.

## Accounts and categories

`POST /accounts` takes `name` and `currency`, and optionally `type` (`regular`, `debt`,
`savings`), `description`, `isIncludedInBalance` and `isFavourite`. `PATCH` changes the same
fields except the currency, which stays: the account's transactions were recorded in it.
Accounts come back with `balance`, which leaves out transactions dated in the future, and
`plannedBalance`, which counts them.

`POST /categories` takes `name` and `type` (`expense` or `income`), and `parentId` or
`parentName` to make it a subcategory of a top-level category of the same type. `PATCH` renames
it or moves it; `"parentId": null` makes a subcategory top-level. `GET /categories` lists
categories and subcategories together, optionally only one `type`; `parentId` links a
subcategory to its category.

## A phone automation: MacroDroid

What follows turns a bank's notification into an expense. Other automation apps (Tasker,
Automate, iOS Shortcuts) work the same way: a trigger, a value taken out of the text, one HTTP
request.

1. In the app, create a key with **Transactions: Add** and copy it, along with the address shown
   next to it.
2. In MacroDroid, create a macro with the **Notification Received** trigger, set to your bank's
   app. Narrow it with the text that only payment notifications carry (for example "Покупка" or
   "Payment"), so balance reminders and codes don't turn into expenses.
3. Take the amount out of the notification's text, `[notification]`, into a local variable
   `amount`, with a Text Manipulation action and a regular expression. For text like
   "Покупка 1 250,50 UAH" the expression `(\d[\d \u00A0\u202F]*[.,]\d{2})` finds `1 250,50`,
   which the API accepts as it is. The two escapes are the no-break spaces many apps group digits
   with. Not every regular expression engine counts them as `\s`, and a pattern that stops at
   one reads `1 250,50` as `250,50`. Try the expression on a few real notifications. Take the
   shop's name out the same way if you want it as the note.
4. Put the notification's text into a variable `key` too, with its line breaks and double quotes
   replaced by spaces (Text Manipulation again): either one would make the body below invalid
   JSON. The text is the idempotency key, so a notification posted twice records one expense.
5. Add an **HTTP Request** action:
   - method `POST`, address `https://<api host>/api/external/v1/transactions`
   - a header `Authorization` with the value `Bearer fpk_…`
   - a body of type `application/json`:

     ```json
     {"type":"expense","amount":"{lv=amount}","accountName":"Monobank","note":"{lv=shop}","idempotencyKey":"{lv=key}"}
     ```

   Keep the amount in quotes: `1 250,50` isn't a JSON number. The key goes in the body rather
   than a header because the text is in Cyrillic, which Android won't send in a header.
6. Optionally, save the response code into a variable and show a notification when it isn't
   `201`, so a refused request doesn't go unnoticed. A `422` means two notifications with the same
   text asked for different amounts, which the key can't tell apart.
