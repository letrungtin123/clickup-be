/** Time helpers in business time (Asia/Ho_Chi_Minh, fixed UTC+7) and a deterministic RNG. */

export const HOUR = 3_600_000;
export const MINUTE = 60_000;
export const DAY = 24 * HOUR;
const offset = 7 * HOUR;

/** Epoch ms for a local date ("2026-09-03") and local time. */
export const at = (date: string, hour = 0, minute = 0, second = 0) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d, hour, minute, second) - offset;
};

/** Local calendar fields of an instant. */
export const local = (ms: number) => {
  const shifted = new Date(ms + offset);
  return {
    date: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay() // 0 = Sunday
  };
};

export const startOfLocalDay = (ms: number) => at(local(ms).date);
export const endOfLocalDay = (ms: number) => at(local(ms).date) + DAY - 1;
export const addDays = (date: string, days: number) => local(at(date, 12) + days * DAY).date;

/** Deterministic xorshift RNG. */
export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }
  next() {
    this.state ^= this.state << 13;
    this.state >>>= 0;
    this.state ^= this.state >>> 17;
    this.state ^= this.state << 5;
    this.state >>>= 0;
    return this.state / 4_294_967_296;
  }
  int(min: number, max: number) {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  float(min: number, max: number) {
    return min + this.next() * (max - min);
  }
  chance(probability: number) {
    return this.next() < probability;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const other = Math.floor(this.next() * (index + 1));
      [copy[index], copy[other]] = [copy[other]!, copy[index]!];
    }
    return copy;
  }
  sample<T>(items: readonly T[], count: number): T[] {
    return this.shuffle(items).slice(0, Math.max(0, count));
  }
  /** Weighted pick from [value, weight] pairs. */
  weighted<T>(pairs: readonly (readonly [T, number])[]): T {
    const total = pairs.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = this.next() * total;
    for (const [value, weight] of pairs) {
      roll -= weight;
      if (roll <= 0) {
        return value;
      }
    }
    return pairs[pairs.length - 1]![0];
  }
}

/** Stable 32-bit hash for per-item RNG seeds. */
export const hash = (value: string) => {
  let h = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    h ^= value.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/**
 * Moves an instant into working hours (Mon–Fri 08:00–18:00, Saturday mostly 08:00–12:00) on the SAME day,
 * keeping its relative position in the day so nothing piles up at opening time. Sundays move to the
 * neighbouring Saturday morning or Monday. `evening` keeps 18:00–22:00 instants (overtime / night shift).
 */
export const intoWorkingHours = (ms: number, rng: Rng, evening = false) => {
  const { hour, weekday } = local(ms);
  let dayStart = startOfLocalDay(ms);
  const fraction = (ms - dayStart) / DAY;
  let day = weekday;
  if (day === 0) {
    const toSaturday = rng.chance(0.5);
    dayStart += toSaturday ? -DAY : DAY;
    day = toSaturday ? 6 : 1;
  } else if (evening && hour >= 18 && hour < 22) {
    return ms;
  }
  const span = day === 6 && rng.chance(0.8) ? 4 : 10;
  if (day === weekday && hour >= 8 && hour < 8 + span) {
    return ms;
  }
  return dayStart + 8 * HOUR + Math.floor(fraction * span * HOUR);
};
