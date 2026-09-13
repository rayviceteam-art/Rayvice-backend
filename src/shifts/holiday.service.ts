/**
 * MODULE 4 — Public holiday resolution (Section 5.5)
 * src/shifts/holiday.service.ts
 *
 * Wraps the offline `date-holidays` package and exposes a HolidayChecker
 * (see shift.types.ts) that the pure engine can call without doing any
 * I/O itself. One Holidays() instance per Australian state is cached —
 * construction reads a bundled data file, no network involved.
 */
import Holidays from 'date-holidays';
import { HolidayChecker } from './shift.types';

const instances = new Map<string, Holidays>();

function getInstance(state: string): Holidays {
  const key = state || 'NSW';
  let inst = instances.get(key);
  if (!inst) {
    inst = new Holidays('AU', key);
    instances.set(key, inst);
  }
  return inst;
}

/**
 * Builds a HolidayChecker bound to one business's state (Business.state,
 * default 'NSW' per Section 5.5.1). Pass the result into calculateShift().
 */
export function buildHolidayChecker(businessState: string | null | undefined): HolidayChecker {
  const inst = getInstance(businessState ?? 'NSW');
  return (localDateISO: string) => {
    const result = inst.isHoliday(new Date(`${localDateISO}T00:00:00`));
    if (!result || result.length === 0) {
      return { isHoliday: false, name: null };
    }
    // date-holidays can return multiple entries (e.g. observed + actual);
    // prefer a 'public' type entry, else the first entry.
    const publicEntry = result.find((r) => r.type === 'public') ?? result[0];
    return { isHoliday: true, name: publicEntry.name };
  };
}
