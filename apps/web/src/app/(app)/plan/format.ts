import { format, parseISO } from "date-fns";

/** `2027-03-31` → `31 Mar 2027`, without any timezone shift. */
export const formatDay = (ymd: string) => format(parseISO(ymd), "d MMM yyyy");
