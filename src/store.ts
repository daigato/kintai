import { differenceInMinutes, parseISO } from 'date-fns';
import { isNonWorkingDay } from './holidays';
import type { User, AttendanceRecord, SubstituteHoliday, EmployeeStat, CsvRow, RecordType } from './types';

// ========================================
// 定数
// ========================================

/** 所定労働時間（時間） */
const STANDARD_WORK_HOURS = 8;

const initialUsers: User[] = [
  { id: 'u1', name: '管理者', role: 'admin', passwordHash: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8' },
];

// ========================================
// ユーティリティ
// ========================================

function generateId(): string {
  return crypto.randomUUID();
}

/** SHA-256 ハッシュ（Web Crypto API） */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ========================================
// Store — localStorage 抽象化レイヤー
// 将来的にバックエンドAPIへ差し替え可能な構造
// ========================================

class Store {
  constructor() {
    // 旧データの自動マイグレーション
    this.migrateUsers();
    this.migrateRecords();
    this.migrateHolidays();
  }

  /** 旧フォーマットの代休データ（usedDateのみ）を remainingDays 形式に移行 */
  private migrateHolidays() {
    const data = localStorage.getItem('substitute_holidays');
    if (!data) return;

    try {
      const holidays = JSON.parse(data);
      if (Array.isArray(holidays) && holidays.length > 0) {
        let needsSave = false;
        for (const h of holidays) {
          if (h.remainingDays === undefined) {
            h.remainingDays = h.usedDate ? 0 : 1.0;
            needsSave = true;
          }
        }
        if (needsSave) {
          localStorage.setItem('substitute_holidays', JSON.stringify(holidays));
        }
      }
    } catch {
      // パース失敗時は放置
    }
  }

  /** 旧フォーマット（passwordHash なし）のユーザーデータを新フォーマットに移行 */
  private migrateUsers() {
    const data = localStorage.getItem('users');
    if (!data) return;

    try {
      const users = JSON.parse(data);
      if (Array.isArray(users) && users.length > 0 && !users[0].passwordHash) {
        localStorage.setItem('users', JSON.stringify(initialUsers));
      }
    } catch {
      localStorage.setItem('users', JSON.stringify(initialUsers));
    }
  }

  /** 旧フォーマット（breakStart/breakEnd/memo なし）の勤怠レコードにフィールドを補完 */
  private migrateRecords() {
    const data = localStorage.getItem('attendance_records');
    if (!data) return;

    try {
      const records = JSON.parse(data);
      if (Array.isArray(records) && records.length > 0) {
        let needsSave = false;
        for (const r of records) {
          if (r.breakStart === undefined) { r.breakStart = null; needsSave = true; }
          if (r.breakEnd === undefined) { r.breakEnd = null; needsSave = true; }
          if (r.memo === undefined) { r.memo = ''; needsSave = true; }
        }
        if (needsSave) {
          localStorage.setItem('attendance_records', JSON.stringify(records));
        }
      }
    } catch {
      // レコードのパースに失敗した場合は放置（再作成される）
    }
  }

  // --- 汎用アクセサ ---

  private get<T>(key: string, initialValue: T): T {
    const data = localStorage.getItem(key);
    if (data) {
      return JSON.parse(data);
    }
    this.set(key, initialValue);
    return initialValue;
  }

  private set(key: string, value: unknown) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // --- ユーザー管理 ---

  getUsers(): User[] {
    return this.get<User[]>('users', initialUsers);
  }

  getUser(id: string): User | undefined {
    return this.getUsers().find(u => u.id === id);
  }

  getUserByName(name: string): User | undefined {
    return this.getUsers().find(u => u.name === name);
  }

  /** パスワード検証（モック — 本番ではバックエンドAPI） */
  async authenticate(userId: string, password: string): Promise<User | null> {
    const user = this.getUser(userId);
    if (!user) return null;
    const hash = await hashPassword(password);
    if (hash === user.passwordHash) return user;
    return null;
  }

  // --- 勤怠記録 ---

  getAttendanceRecords(userId?: string): AttendanceRecord[] {
    const records = this.get<AttendanceRecord[]>('attendance_records', []);
    if (userId) {
      return records.filter(r => r.userId === userId);
    }
    return records;
  }

  getMonthlyRecords(userId: string, yearMonth: string): AttendanceRecord[] {
    return this.getAttendanceRecords(userId).filter(r => r.date.startsWith(yearMonth));
  }

  getTodayRecord(userId: string, dateStr: string): AttendanceRecord | undefined {
    return this.getAttendanceRecords(userId).find(r => r.date === dateStr);
  }

  clockIn(userId: string, dateStr: string, timestamp: string): AttendanceRecord {
    const records = this.getAttendanceRecords();
    let record = records.find(r => r.userId === userId && r.date === dateStr);
    const isHoliday = this.checkIsHoliday(dateStr);

    if (record) {
      record.clockIn = timestamp;
    } else {
      record = {
        id: generateId(),
        userId,
        date: dateStr,
        clockIn: timestamp,
        clockOut: null,
        breakStart: null,
        breakEnd: null,
        memo: '',
        isHolidayWork: isHoliday,
        recordType: 'work',
      };
      records.push(record);
    }

    this.set('attendance_records', records);
    return record;
  }

  clockOut(userId: string, dateStr: string, timestamp: string): AttendanceRecord | null {
    const records = this.getAttendanceRecords();
    const record = records.find(r => r.userId === userId && r.date === dateStr);

    if (!record || !record.clockIn) return null;

    // バリデーション: 退勤時刻が出勤時刻より前でないこと
    if (differenceInMinutes(parseISO(timestamp), parseISO(record.clockIn)) < 0) {
      return null;
    }

    record.clockOut = timestamp;
    this.set('attendance_records', records);

    if (record.isHolidayWork) {
      this.earnSubstituteHoliday(userId, dateStr);
    }

    return record;
  }

  breakStart(userId: string, dateStr: string, timestamp: string): AttendanceRecord | null {
    const records = this.getAttendanceRecords();
    const record = records.find(r => r.userId === userId && r.date === dateStr);

    if (!record || !record.clockIn || record.clockOut) return null;

    record.breakStart = timestamp;
    this.set('attendance_records', records);
    return record;
  }

  breakEnd(userId: string, dateStr: string, timestamp: string): AttendanceRecord | null {
    const records = this.getAttendanceRecords();
    const record = records.find(r => r.userId === userId && r.date === dateStr);

    if (!record || !record.breakStart) return null;

    record.breakEnd = timestamp;
    this.set('attendance_records', records);
    return record;
  }

  updateMemo(userId: string, dateStr: string, memo: string): AttendanceRecord | null {
    const records = this.getAttendanceRecords();
    const record = records.find(r => r.userId === userId && r.date === dateStr);

    if (!record) return null;

    record.memo = memo;
    this.set('attendance_records', records);
    return record;
  }

  deleteRecord(id: string) {
    const records = this.getAttendanceRecords();
    const newRecords = records.filter(r => r.id !== id);
    this.set('attendance_records', newRecords);
  }

  updateRecord(id: string, updates: Partial<Pick<AttendanceRecord, 'clockIn' | 'clockOut' | 'breakStart' | 'breakEnd' | 'memo' | 'recordType'>>) {
    const records = this.getAttendanceRecords();
    const record = records.find(r => r.id === id);
    if (record) {
      if (updates.clockIn !== undefined) record.clockIn = updates.clockIn;
      if (updates.clockOut !== undefined) record.clockOut = updates.clockOut;
      if (updates.breakStart !== undefined) record.breakStart = updates.breakStart;
      if (updates.breakEnd !== undefined) record.breakEnd = updates.breakEnd;
      if (updates.memo !== undefined) record.memo = updates.memo;
      if (updates.recordType !== undefined) record.recordType = updates.recordType;
      this.set('attendance_records', records);
    }
  }

  addRecord(userId: string, dateStr: string, details: Partial<Pick<AttendanceRecord, 'clockIn' | 'clockOut' | 'breakStart' | 'breakEnd' | 'memo' | 'recordType'>>) {
    const records = this.getAttendanceRecords();
    const isHoliday = this.checkIsHoliday(dateStr);

    let record = records.find(r => r.userId === userId && r.date === dateStr);
    if (record) {
      this.updateRecord(record.id, details);
    } else {
      record = {
        id: generateId(),
        userId,
        date: dateStr,
        clockIn: details.clockIn || null,
        clockOut: details.clockOut || null,
        breakStart: details.breakStart || null,
        breakEnd: details.breakEnd || null,
        memo: details.memo || '',
        isHolidayWork: isHoliday,
        recordType: details.recordType || 'work',
      };
      records.push(record);
      this.set('attendance_records', records);
    }
    return record;
  }

  // --- 休日判定（日本の祝日 + 土日） ---

  private checkIsHoliday(dateStr: string): boolean {
    return isNonWorkingDay(dateStr);
  }

  // --- 代休管理 ---

  getSubstituteHolidays(userId?: string): SubstituteHoliday[] {
    const holidays = this.get<SubstituteHoliday[]>('substitute_holidays', []);
    if (userId) {
      return holidays.filter(h => h.userId === userId);
    }
    return holidays;
  }

  earnSubstituteHoliday(userId: string, earnedDate: string) {
    const holidays = this.getSubstituteHolidays();
    if (!holidays.find(h => h.userId === userId && h.earnedDate === earnedDate)) {
      holidays.push({
        id: generateId(),
        userId,
        earnedDate,
        remainingDays: 1.0,
      });
      this.set('substitute_holidays', holidays);
    }
  }

  useSubstituteHoliday(userId: string, usedDate: string, amount: 0.5 | 1.0 = 1.0): boolean {
    const holidays = this.getSubstituteHolidays();
    // 残日数がある代休枠を探す（古い順）
    const unused = holidays.sort((a, b) => a.earnedDate.localeCompare(b.earnedDate))
                           .find(h => h.userId === userId && h.remainingDays >= amount);
    if (!unused) return false;

    unused.remainingDays -= amount;
    // 互換用: 完全に使い切ったらusedDateを入れる
    if (unused.remainingDays === 0) {
      unused.usedDate = usedDate;
    }
    this.set('substitute_holidays', holidays);

    // 代休レコードを作成/更新
    const records = this.getAttendanceRecords();
    let record = records.find(r => r.userId === userId && r.date === usedDate);
    const recordType: RecordType = amount === 1.0 ? 'full_off' : 'morning_off'; // デフォルトは午前休として扱う（UIで選べるようにするが、ここでは仮）
    const memoText = amount === 1.0 ? '代休取得' : '半休取得(代休)';

    if (record) {
      record.memo = record.memo ? `${record.memo} / ${memoText}` : memoText;
      if (amount === 1.0) record.recordType = recordType;
    } else {
      records.push({
        id: generateId(),
        userId,
        date: usedDate,
        clockIn: null,
        clockOut: null,
        breakStart: null,
        breakEnd: null,
        memo: memoText,
        isHolidayWork: false,
        recordType,
      });
    }
    this.set('attendance_records', records);
    return true;
  }

  getAvailableSubstituteHolidays(userId: string): number {
    return this.getSubstituteHolidays(userId).reduce((sum, h) => sum + (h.remainingDays || 0), 0);
  }

  // --- 集計 ---

  /** レコード単体の実労働分数を計算（拘束時間6時間超で60分自動控除） */
  calculateRecordMinutes(record: AttendanceRecord): number {
    if (!record.clockIn || !record.clockOut) return 0;

    const stayMinutes = Math.max(0, differenceInMinutes(parseISO(record.clockOut), parseISO(record.clockIn)));
    const breakMinutes = stayMinutes > 360 ? 60 : 0;

    return Math.max(0, stayMinutes - breakMinutes);
  }

  calculateMonthlyHours(userId: string, yearMonth: string): number {
    const records = this.getMonthlyRecords(userId, yearMonth);
    let totalMinutes = 0;

    records.forEach(r => {
      totalMinutes += this.calculateRecordMinutes(r);
    });

    return totalMinutes / 60;
  }

  /** 月間残業時間（実労働時間 - 所定労働時間 × 出勤日数） */
  calculateMonthlyOvertime(userId: string, yearMonth: string): number {
    const records = this.getMonthlyRecords(userId, yearMonth);
    let overtimeMinutes = 0;

    records.forEach(r => {
      const workedMinutes = this.calculateRecordMinutes(r);
      const standardMinutes = STANDARD_WORK_HOURS * 60;
      if (workedMinutes > standardMinutes) {
        overtimeMinutes += workedMinutes - standardMinutes;
      }
    });

    return overtimeMinutes / 60;
  }

  /** 月間出勤日数 */
  calculateWorkDays(userId: string, yearMonth: string): number {
    const records = this.getMonthlyRecords(userId, yearMonth);
    return records.filter(r => r.clockIn && r.clockOut).length;
  }

  /** 従業員サマリーを取得 */
  getEmployeeStats(yearMonth: string): EmployeeStat[] {
    const employees = this.getUsers().filter(u => u.role === 'employee');
    return employees.map(user => {
      const records = this.getMonthlyRecords(user.id, yearMonth);
      let grantedMinutes = 0;
      records.forEach(r => {
        if (!r.clockIn || !r.clockOut) return;
        const isHoliday = Boolean(r.isHolidayWork) || isNonWorkingDay(r.date);
        if (isHoliday) {
          const worked = this.calculateRecordMinutes(r);
          grantedMinutes += Math.floor(worked / 30) * 30;
        } else {
          const inD = new Date(r.clockIn);
          const inJst = new Date(inD.getTime() + (9 * 60 * 60 * 1000));
          const totalInMinutes = inJst.getUTCHours() * 60 + inJst.getUTCMinutes();

          const outD = new Date(r.clockOut);
          const outJst = new Date(outD.getTime() + (9 * 60 * 60 * 1000));
          const totalOutMinutes = outJst.getUTCHours() * 60 + outJst.getUTCMinutes();

          // 1. 早出分（9:00前）: 9:00 = 540分。30分単位で切り捨てて付与（8:20出勤で30分付与、8:40出勤で0分付与）
          const earlyMinutes = Math.max(0, 540 - totalInMinutes);
          const earlyGranted = Math.floor(earlyMinutes / 30) * 30;

          // 2. 残業分（18:00後）: 18:00 = 1080分。30分単位で切り捨てて付与（18:30退勤で30分付与、18:20退勤で0分付与）
          const overtimeMinutes = Math.max(0, totalOutMinutes - 1080);
          const overtimeGranted = Math.floor(overtimeMinutes / 30) * 30;

          grantedMinutes += (earlyGranted + overtimeGranted);
        }
      });
      const h = Math.floor(grantedMinutes / 60);
      const m = grantedMinutes % 60;
      const display = h > 0 ? (m > 0 ? `${h}時間${m}分` : `${h}時間`) : `${m}分`;

      return {
        user,
        monthlyHours: this.calculateMonthlyHours(user.id, yearMonth),
        overtimeHours: this.calculateMonthlyOvertime(user.id, yearMonth),
        availableHolidays: this.getAvailableSubstituteHolidays(user.id),
        compensatoryMinutes: grantedMinutes,
        compensatoryDisplay: display,
        workDays: this.calculateWorkDays(user.id, yearMonth),
      };
    });
  }

  // --- CSVエクスポート ---

  generateCsvData(yearMonth: string, userId?: string): CsvRow[] {
    const employees = userId
      ? this.getUsers().filter(u => u.id === userId)
      : this.getUsers().filter(u => u.role === 'employee');

    const rows: CsvRow[] = [];

    employees.forEach(emp => {
      const records = this.getMonthlyRecords(emp.id, yearMonth)
        .sort((a, b) => a.date.localeCompare(b.date));

      records.forEach(r => {
        const workedMinutes = this.calculateRecordMinutes(r);
        const workHours = workedMinutes / 60;
        const overtime = Math.max(0, workHours - STANDARD_WORK_HOURS);

        rows.push({
          date: r.date,
          employeeName: emp.name,
          clockIn: r.clockIn ? new Date(r.clockIn).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '',
          clockOut: r.clockOut ? new Date(r.clockOut).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '',
          breakStart: r.breakStart ? new Date(r.breakStart).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '',
          breakEnd: r.breakEnd ? new Date(r.breakEnd).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '',
          workHours: workHours.toFixed(1),
          overtimeHours: overtime.toFixed(1),
          memo: r.memo || '',
          isHolidayWork: r.isHolidayWork ? '○' : '',
        });
      });
    });

    // 日付順（昇順）、同日なら従業員名順に並び替え
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName));

    return rows;
  }

  exportCsv(yearMonth: string, userId?: string): string {
    const rows = this.generateCsvData(yearMonth, userId);
    const headers = ['日付', '従業員名', '出勤', '退勤', '休憩開始', '休憩終了', '労働時間(h)', '残業時間(h)', '備考', '休日出勤'];
    
    const escapeCsv = (val: string | number | null | undefined): string => {
      if (val === null || val === undefined) return '""';
      const str = String(val);
      return `"${str.replace(/"/g, '""')}"`;
    };

    const csvLines = [
      headers.map(h => escapeCsv(h)).join(','),
      ...rows.map(row =>
        [
          row.date,
          row.employeeName,
          row.clockIn,
          row.clockOut,
          row.breakStart,
          row.breakEnd,
          row.workHours,
          row.overtimeHours,
          row.memo,
          row.isHolidayWork
        ].map(val => escapeCsv(val)).join(',')
      ),
    ];
    return csvLines.join('\n');
  }

  downloadCsv(yearMonth: string, userId?: string) {
    const csv = this.exportCsv(yearMonth, userId);
    const bom = '\uFEFF';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `勤怠データ_${yearMonth}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
}

export const store = new Store();
