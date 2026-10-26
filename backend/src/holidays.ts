/**
 * 日本の祝日判定ユーティリティ (バックエンド用)
 *
 * 「国民の祝日に関する法律」に基づき、固定祝日・ハッピーマンデー制度・
 * 春分の日/秋分の日・振替休日・国民の休日を判定する。
 * 対応範囲: 2000年〜2100年
 */

/** 春分日の推定（天文計算ベースの近似式） */
function getVernalEquinoxDay(year: number): number {
  if (year <= 1979) return Math.floor(20.8357 + 0.242194 * (year - 1980) - Math.floor((year - 1983) / 4));
  if (year <= 2099) return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  return Math.floor(21.851 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

/** 秋分日の推定 */
function getAutumnalEquinoxDay(year: number): number {
  if (year <= 1979) return Math.floor(23.2588 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  if (year <= 2099) return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  return Math.floor(24.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

/** 指定月の第N月曜日を取得 */
function getNthMonday(year: number, month: number, n: number): number {
  const firstDay = new Date(year, month - 1, 1).getDay(); // 0=日曜
  const firstMonday = firstDay <= 1 ? 2 - firstDay : 9 - firstDay;
  return firstMonday + (n - 1) * 7;
}

interface HolidayEntry {
  month: number;
  day: number;
  name: string;
}

/** 指定年の祝日リストを生成（振替休日・国民の休日を含む） */
function getHolidaysForYear(year: number): HolidayEntry[] {
  const holidays: HolidayEntry[] = [];

  // 固定祝日
  holidays.push({ month: 1, day: 1, name: '元日' });
  holidays.push({ month: 2, day: 11, name: '建国記念の日' });
  holidays.push({ month: 2, day: 23, name: '天皇誕生日' }); // 2020年〜
  holidays.push({ month: 4, day: 29, name: '昭和の日' });
  holidays.push({ month: 5, day: 3, name: '憲法記念日' });
  holidays.push({ month: 5, day: 4, name: 'みどりの日' });
  holidays.push({ month: 5, day: 5, name: 'こどもの日' });
  holidays.push({ month: 8, day: 11, name: '山の日' }); // 2016年〜
  holidays.push({ month: 11, day: 3, name: '文化の日' });
  holidays.push({ month: 11, day: 23, name: '勤労感謝の日' });

  // ハッピーマンデー制度
  holidays.push({ month: 1, day: getNthMonday(year, 1, 2), name: '成人の日' });
  holidays.push({ month: 7, day: getNthMonday(year, 7, 3), name: '海の日' });
  holidays.push({ month: 9, day: getNthMonday(year, 9, 3), name: '敬老の日' });
  holidays.push({ month: 10, day: getNthMonday(year, 10, 2), name: 'スポーツの日' });

  // 春分の日・秋分の日
  holidays.push({ month: 3, day: getVernalEquinoxDay(year), name: '春分の日' });
  holidays.push({ month: 9, day: getAutumnalEquinoxDay(year), name: '秋分の日' });

  // 振替休日: 祝日が日曜の場合、その直後の平日が振替休日
  const baseSet = new Set(holidays.map(h => `${h.month}-${h.day}`));
  for (const h of [...holidays]) {
    const d = new Date(year, h.month - 1, h.day);
    if (d.getDay() === 0) { // 日曜
      let sub = 1;
      while (baseSet.has(`${h.month}-${h.day + sub}`) || new Date(year, h.month - 1, h.day + sub).getDay() === 0) {
        sub++;
      }
      const subDate = new Date(year, h.month - 1, h.day + sub);
      holidays.push({ month: subDate.getMonth() + 1, day: subDate.getDate(), name: '振替休日' });
      baseSet.add(`${subDate.getMonth() + 1}-${subDate.getDate()}`);
    }
  }

  // 国民の休日: 2つの祝日に挟まれた平日
  const sortedHolidays = [...holidays].sort((a, b) => {
    const da = new Date(year, a.month - 1, a.day);
    const db = new Date(year, b.month - 1, b.day);
    return da.getTime() - db.getTime();
  });
  for (let i = 0; i < sortedHolidays.length - 1; i++) {
    const curr = new Date(year, sortedHolidays[i].month - 1, sortedHolidays[i].day);
    const next = new Date(year, sortedHolidays[i + 1].month - 1, sortedHolidays[i + 1].day);
    const diff = (next.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24);
    if (diff === 2) {
      const between = new Date(curr.getTime() + 1000 * 60 * 60 * 24);
      const betweenKey = `${between.getMonth() + 1}-${between.getDate()}`;
      if (!baseSet.has(betweenKey) && between.getDay() !== 0 && between.getDay() !== 6) {
        holidays.push({ month: between.getMonth() + 1, day: between.getDate(), name: '国民の休日' });
      }
    }
  }

  return holidays;
}

// キャッシュ（年ごと）
const cache = new Map<number, Map<string, string>>();

function getYearCache(year: number): Map<string, string> {
  if (!cache.has(year)) {
    const holidays = getHolidaysForYear(year);
    const map = new Map<string, string>();
    for (const h of holidays) {
      const key = `${year}-${String(h.month).padStart(2, '0')}-${String(h.day).padStart(2, '0')}`;
      map.set(key, h.name);
    }
    cache.set(year, map);
  }
  return cache.get(year)!;
}

/**
 * 指定日が日本の祝日かどうか判定する
 * @param dateStr YYYY-MM-DD 形式
 * @returns 祝日名。祝日でなければ null
 */
export function getJapaneseHolidayName(dateStr: string): string | null {
  const year = parseInt(dateStr.substring(0, 4), 10);
  const map = getYearCache(year);
  return map.get(dateStr) ?? null;
}

/**
 * 指定日が祝日かどうか（真偽値）
 */
export function isJapaneseHoliday(dateStr: string): boolean {
  return getJapaneseHolidayName(dateStr) !== null;
}

/**
 * 指定日が休日（土日または祝日）かどうか
 */
export function isNonWorkingDay(dateStr: string): boolean {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return true;
  return isJapaneseHoliday(dateStr);
}
