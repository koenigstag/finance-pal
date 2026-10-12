import { makeAutoObservable } from 'mobx';

/**
 * The month the pages that go a month at a time — transactions, budget and overview — are on, as
 * YYYY-MM: moving to another month on one of them takes the others there too. Each page also keeps
 * it in its URL, which is what a reload or a shared link goes by. Never stored: the app opens on the
 * current month.
 */
export class MonthStore {
  // Null until one of those pages has been shown.
  month: string | null = null;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  setMonth(month: string): void {
    this.month = month;
  }
}
