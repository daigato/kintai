import type { User, AttendanceRecord, CsvRow } from './types';
import { apiStore } from './apiStore';
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';

export function generateUserMonthlyCsv(yearMonth: string, user: User, records: AttendanceRecord[], compensatoryDisplay?: string): string {
  const stats = apiStore.calculateStats(records, 0);

  // 対象月の全日付を生成（1日〜末日）
  const monthDate = parseISO(`${yearMonth}-01`);
  const start = startOfMonth(monthDate);
  const end = endOfMonth(monthDate);
  const allDays = eachDayOfInterval({ start, end });
  const weekDayNames = ['日', '月', '火', '水', '木', '金', '土'];

  let csv = '\uFEFF'; // Excel文字化け防止BOM
  csv += `出勤サマリー (${yearMonth})\n`;
  csv += `氏名,${user.name}\n`;
  csv += `総労働時間,${stats.monthlyHours.toFixed(1)}時間\n`;
  csv += `残業時間,${stats.overtimeHours.toFixed(1)}時間\n`;
  csv += `出勤日数,${stats.workDays}日\n`;
  csv += `振替休暇残高,${compensatoryDisplay || '0分'}\n\n`;

  csv += '日付,曜日,区分,出勤時刻,退勤時刻,休憩,労働時間,備考\n';

  allDays.forEach(day => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const dowStr = weekDayNames[day.getDay()];
    const rec = records.find(r => r.date === dateStr);

    let kbn = '';
    let clockInStr = '';
    let clockOutStr = '';
    let breakStr = '';
    let workStr = '';
    let memoStr = rec?.memo || '';

    if (rec) {
      if (rec.isHolidayWork) kbn = '休日出勤';
      else if (rec.recordType === 'morning_off') kbn = '午前休';
      else if (rec.recordType === 'afternoon_off') kbn = '午後休';
      else if (rec.recordType === 'full_off') kbn = '全日休';
      else if (rec.clockIn) kbn = '出勤';

      if (rec.clockIn) {
        try {
          clockInStr = format(parseISO(rec.clockIn), 'HH:mm');
        } catch {}
      }
      if (rec.clockOut) {
        try {
          clockOutStr = format(parseISO(rec.clockOut), 'HH:mm');
        } catch {}
      }

      const workedMin = apiStore.calculateRecordMinutes(rec);
      if (rec.clockIn && rec.clockOut) {
        const stayMin = Math.max(0, Math.floor((new Date(rec.clockOut).getTime() - new Date(rec.clockIn).getTime()) / 60000));
        breakStr = stayMin > 360 ? '60分' : '0分';
        const h = Math.floor(workedMin / 60);
        const m = workedMin % 60;
        workStr = `${h}:${String(m).padStart(2, '0')}`;
      }
    }

    const cleanMemo = `"${memoStr.replace(/"/g, '""')}"`;
    csv += `${dateStr},${dowStr},${kbn},${clockInStr},${clockOutStr},${breakStr},${workStr},${cleanMemo}\n`;
  });

  return csv;
}

export function downloadUserMonthlyCsv(yearMonth: string, user: User, records: AttendanceRecord[], compensatoryDisplay?: string) {
  const csv = generateUserMonthlyCsv(yearMonth, user, records, compensatoryDisplay);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `勤怠サマリー_${user.name}_${yearMonth}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function generateCsvData(users: User[], records: AttendanceRecord[]): CsvRow[] {
  const rows: CsvRow[] = [];
  const STANDARD_WORK_HOURS = 8;

  records.forEach(r => {
    const user = users.find(u => u.id === r.userId);
    if (!user) return;

    const workedMinutes = apiStore.calculateRecordMinutes(r);
    const workHours = workedMinutes / 60;
    const overtime = Math.max(0, workHours - STANDARD_WORK_HOURS);

    let breakDisplay = '0分';
    if (r.clockIn && r.clockOut) {
      const stayMin = Math.max(0, Math.floor((new Date(r.clockOut).getTime() - new Date(r.clockIn).getTime()) / 60000));
      if (stayMin > 360) breakDisplay = '60分';
    }

    rows.push({
      date: r.date,
      employeeName: user.name,
      clockIn: r.clockIn ? new Date(r.clockIn).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '',
      clockOut: r.clockOut ? new Date(r.clockOut).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '',
      breakStart: breakDisplay,
      breakEnd: '',
      workHours: workHours.toFixed(1),
      overtimeHours: overtime.toFixed(1),
      memo: r.memo || '',
      isHolidayWork: r.isHolidayWork ? '○' : '',
    });
  });

  // 日付順（昇順）、同日なら従業員名順に並び替え
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName));

  return rows;
}

export function exportCsv(users: User[], records: AttendanceRecord[]): string {
  const rows = generateCsvData(users, records);
  const headers = ['日付', '従業員名', '出勤', '退勤', '休憩', '労働時間(h)', '残業時間(h)', '備考', '休日出勤'];
  
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
        row.workHours,
        row.overtimeHours,
        row.memo,
        row.isHolidayWork
      ].map(val => escapeCsv(val)).join(',')
    ),
  ];
  return csvLines.join('\n');
}

export function downloadCsv(yearMonth: string, users: User[], records: AttendanceRecord[]) {
  const csv = exportCsv(users, records);
  const bom = '\uFEFF'; // Excelで文字化けを防ぐBOM付きUTF-8
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `勤怠データ_全員_${yearMonth}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
