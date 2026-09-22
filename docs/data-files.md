# Data files

A group's data can be exported as a spreadsheet and imported back, into a new group. The file
has four tables:

- **Transactions**, what the group records;
- **Accounts**;
- **Categories**;
- **Series**: transactions that repeat.

A group exports whole, as either:

- an `.xlsx` workbook, with a sheet for each table;
- a `.zip` of four CSV files, one per table.

Both import back whole. Import takes the workbook, the `.zip`, or one or more CSV files chosen
together.

In the app, both are under **Data** in the account menu. The API routes are
`GET /api/groups/{groupId}/export` and `POST /api/import/finance-pal` (see the comments on
`ExportController` and `ImportController`). The export route can also give one table as a CSV
file on its own, for a script that wants one: `?format=csv&table=transactions`.

The same tables can be filled in by hand, to bring in data from somewhere else. Only the
Transactions table is needed for that: accounts and categories are opened as the transactions name
them.

## How a table is read

- The first row with anything in it holds the headers. Case, spaces and underscores don't
  matter: `To account`, `to_account` and `toAccount` are the same column.
- Columns can come in any order, and columns the app doesn't know are left alone. A column that
  isn't there counts as empty.
- Empty rows are skipped.
- A workbook's sheets are recognized by name. A sheet with another name, or a CSV file, is
  recognized by its headers. Sheets that are none of the four are ignored, and so is anything in
  a `.zip` that isn't a CSV file.
- Anything wrong with the file is reported all at once, a line per problem, with the table and
  row number as a spreadsheet shows them. Nothing is imported until the file is right.

## Values

| Kind       | Written as                        | Also read                                                                                  |
| ---------- | --------------------------------- | ------------------------------------------------------------------------------------------ |
| Amount     | `1250.50`                         | `1 250,50` and `1250,5`. Not `1.250` or `1,250.50`: which separator is the decimal one would be a guess. |
| Date       | `2026-09-21 14:30:05`, local time | `2026-09-21`, `2026-09-21 14:30`, `21.09.2026 14:30`, ISO 8601 with a zone (`…T14:30:05+03:00`), a spreadsheet's own date |
| Percentage | `12.5` for 12.5%                  | `12,5` and `12.5%`                                                                         |
| Yes or no  | `true`, `false`                   | `yes`/`no`, `1`/`0`, `да`/`нет`, a spreadsheet's own `TRUE`/`FALSE`                        |
| Type       | lowercase English words           | any case                                                                                   |

Dates are local times, without a zone. The app exports them in the device's time zone and reads
them in it, so a file imported in the zone it was exported in comes back to the same moments. A
date without a time is the start of that day.

Amounts are never negative, except an account's balance: a transaction's type says which way the
money went.

CSV files are UTF-8, comma-separated, with a byte order mark so that Excel reads them as UTF-8.
Import also reads semicolon- and tab-separated files, UTF-16, and Windows-1251, which is what Excel
saves a CSV file in on a Russian or Ukrainian system. A text cell that starts with `=`, `+`, `-` or
`@` is written behind an apostrophe, so that a spreadsheet doesn't run it as a formula; import takes
the apostrophe off.

## Transactions

| Column            | Holds                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Date              | When it happened, or will. Required.                                                           |
| Type              | `expense`, `income` or `transfer`. Required.                                                   |
| Amount            | In the account's currency. Required.                                                           |
| Currency          | The account's currency, as an ISO code (`UAH`).                                                |
| Account           | The account's name. Required.                                                                  |
| Category          | A top-level category of the transaction's type. Empty for a transfer.                          |
| Subcategory       | One of the category's subcategories.                                                           |
| To account        | Where a transfer went. Required for a transfer, empty otherwise.                               |
| Amount received   | What arrived, for a transfer between two currencies.                                           |
| Currency received | The To account's currency.                                                                     |
| Note              |                                                                                                |
| Tags              | Separated by commas.                                                                           |
| Percentage        | The amount was worked out as this percentage: of Base amount, or of the account's balance.     |
| Base amount       | What Percentage is of.                                                                         |
| Round balance to  | `1`, `10`, `100` or `1000`: the amount is what leaves the balance on a multiple of it.         |
| Series            | The number of the series this transaction is the planned one of (see Series).                  |

An account is found by its name and, when the row gives one, its currency, so two accounts of one
name in different currencies are told apart. Export numbers the second of two accounts that would
still read as one: `Cash (2)`. Names compare regardless of case.

Without an Accounts table, an account is opened the first time a row names it together with a
currency. With one, a name it doesn't list is a mistake.

A transfer between two currencies with Amount received empty is converted at the current exchange
rate. Export leaves it empty for a planned transfer, whose received amount follows the rate until
its day.

An amount worked out from the balance (a percentage without a base amount, or a rounding) may be
`0` on a planned transaction: it's worked out again as the balance changes.

## Accounts

| Column           | Holds                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------- |
| Name             | Required.                                                                              |
| Currency         | ISO code. Required.                                                                    |
| Type             | `regular` (the default), `debt` or `savings`.                                          |
| Balance          | What the account holds now, planned transactions aside.                                |
| Include in total | Whether it counts toward the total balance. Yes by default.                            |
| Favourite        | The account new transactions start on. The first one marked, if several are.           |
| Archived         |                                                                                        |
| Description      |                                                                                        |
| Icon             | A name from the app's icon set, like `wallet`.                                         |
| Color            | `#RRGGBB`.                                                                             |
| Limit            | A debt account's limit.                                                                |
| Goal             | A savings account's goal.                                                              |

Accounts are listed in the order the app shows them, which is the order import gives them.

A balance is the sum of an account's transactions, so import doesn't set Balance on an account the
Transactions table has transactions for. An account that has none is opened with an
`Opening balance` transaction of that amount instead. That's how to start from balances
alone: list the accounts, and leave Transactions out.

## Categories

| Column   | Holds                                                                     |
| -------- | ------------------------------------------------------------------------- |
| Name     | Required.                                                                 |
| Type     | `expense` or `income`. Required.                                          |
| Parent   | For a subcategory, its top-level category, of the same type.              |
| Icon     |                                                                           |
| Color    |                                                                           |
| Archived |                                                                           |

Subcategories go one level deep. A subcategory can come before its parent in the table. Two rows
of the same type, parent and name are one category.

Without a Categories table, a category (and a subcategory under it) is opened as a transaction
names it, of the transaction's type.

## Series

| Column             | Holds                                                                         |
| ------------------ | ----------------------------------------------------------------------------- |
| Series             | Its number, which transactions refer to. The row's position if empty.         |
| Type … To account  | As in Transactions.                                                           |
| Currency received  | As in Transactions.                                                           |
| Note               |                                                                               |
| Percentage … Round balance to | As in Transactions.                                                |
| Repeat             | `day`, `week`, `month` or `year`. Required.                                   |
| Every              | Every how many of those. 1 by default.                                        |
| Start              | The first date, which every later one is counted from.                        |
| Next date          | When it next produces a transaction.                                          |
| Time zone          | Its dates are local times in this zone, like `Europe/Kyiv`.                   |
| Active             | A paused series isn't. Yes by default.                                        |
| Remind days before |                                                                               |

A series always has one planned transaction ahead, and writes the next one once that date passes.
Export marks the planned transaction with the series' number in the Transactions table, so it comes
back as the series' own. The series then carries on with its date after that one, and past
transactions stay as they were.

A series without a marked transaction starts from Next date, or else from Start. A Start in the
past records every date from then until today, as a series set up in the app does. To bring in a
series whose past payments are already in Transactions, fill in Next date.

A marked transaction that has passed by the time the file is imported is imported as it is, and the
series carries on from the date after it, recording the dates it missed since.
