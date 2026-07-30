interface NumericDateParts {
  readonly day: string;
  readonly hour: string;
  readonly minute: string;
  readonly month: string;
  readonly second: string;
  readonly year: string;
}

function numericDateParts(value: Date, timeZone: string | undefined): NumericDateParts {
  const options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    year: 'numeric',
  };
  if (timeZone !== undefined) options.timeZone = timeZone;

  let day = '';
  let hour = '';
  let minute = '';
  let month = '';
  let second = '';
  let year = '';
  for (const part of new Intl.DateTimeFormat('ru-RU', options).formatToParts(value)) {
    if (part.type === 'day') day = part.value;
    if (part.type === 'hour') hour = part.value;
    if (part.type === 'minute') minute = part.value;
    if (part.type === 'month') month = part.value;
    if (part.type === 'second') second = part.value;
    if (part.type === 'year') year = part.value;
  }

  return { day, hour, minute, month, second, year };
}

/** Formats a user-visible date and time as DD.MM.YYYY HH:mm:ss in the supplied or browser time zone. */
export function formatDateTime(value: Date, timeZone?: string): string {
  const { day, hour, minute, month, second, year } = numericDateParts(value, timeZone);
  return `${day}.${month}.${year} ${hour}:${minute}:${second}`;
}
