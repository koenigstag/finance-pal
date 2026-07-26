export interface TransactionCursor {
  date: Date;
  id: string;
}

export function encodeCursor(date: Date, id: string): string {
  return Buffer.from(`${date.toISOString()}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): TransactionCursor | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const separatorIndex = decoded.lastIndexOf('|');
    if (separatorIndex === -1) {
      return null;
    }
    const dateString = decoded.slice(0, separatorIndex);
    const id = decoded.slice(separatorIndex + 1);
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime()) || !id) {
      return null;
    }
    return { date, id };
  } catch {
    return null;
  }
}
