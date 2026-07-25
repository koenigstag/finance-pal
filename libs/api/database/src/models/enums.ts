export enum MemberRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
  VIEWER = 'viewer',
}

export enum AccountType {
  REGULAR = 'regular',
  DEBT = 'debt',
  SAVINGS = 'savings',
}

export enum CategoryType {
  INCOME = 'income',
  EXPENSE = 'expense',
}

export enum TransactionType {
  EXPENSE = 'expense',
  INCOME = 'income',
  TRANSFER = 'transfer',
}

export enum RecurrenceUnit {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  YEAR = 'year',
}
