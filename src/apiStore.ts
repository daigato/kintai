import type { User, AttendanceRecord, RecordType, AttendanceRequest, CompensatoryBalance, CalendarEvent, CompanyScheduleResponse, LineGroup, UserGroup } from './types';
import { isNonWorkingDay } from './holidays';

const API_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) || 'http://127.0.0.1:8787';

/**
 * Cloudflare Workers (バックエンドAPI) と通信するための非同期Storeクラス
 */
export class ApiStore {
  
  // --- ユーザー関連 ---

  async getUsers(): Promise<User[]> {
    const res = await fetch(`${API_URL}/api/users`);
    if (!res.ok) throw new Error('Failed to fetch users');
    return res.json();
  }

  async loginWithLine(lineUserId: string, displayName?: string): Promise<User | null> {
    try {
      const res = await fetch(`${API_URL}/api/login-line`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineUserId, displayName: displayName || 'LINE ユーザー' })
      });
      if (!res.ok) return null;
      return res.json();
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  async loginAdmin(userId: string, password: string): Promise<User | null> {
    try {
      const res = await fetch(`${API_URL}/api/login-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, password })
      });
      if (!res.ok) return null;
      return res.json();
    } catch (e) {
      console.error('Admin login error:', e);
      return null;
    }
  }

  async updateUserName(userId: string, name: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/users/${userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!res.ok) throw new Error('Failed to update user name');
  }

  // --- 勤怠記録関連 ---

  async getMonthlyRecords(userId: string, yearMonth: string): Promise<AttendanceRecord[]> {
    const res = await fetch(`${API_URL}/api/records/${userId}?month=${yearMonth}`);
    if (!res.ok) throw new Error('Failed to fetch records');
    return res.json();
  }

  async getTodayRecord(userId: string, dateStr: string): Promise<AttendanceRecord | undefined> {
    const yearMonth = dateStr.substring(0, 7);
    const records = await this.getMonthlyRecords(userId, yearMonth);
    return records.find(r => r.date === dateStr);
  }

  async clockIn(userId: string, dateStr: string, timeStr: string, isHolidayWork: boolean = false, memo?: string): Promise<void> {
    await fetch(`${API_URL}/api/clock-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, date: dateStr, time: timeStr, isHolidayWork, memo })
    });
  }

  async clockOut(userId: string, dateStr: string, timeStr: string, memo?: string): Promise<void> {
    await fetch(`${API_URL}/api/clock-out`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, date: dateStr, time: timeStr, memo })
    });
  }

  async migrateHolidayWork(): Promise<{ updatedCount: number; totalChecked: number }> {
    const res = await fetch(`${API_URL}/api/migrate-holiday-work`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error('Failed to migrate holiday work');
    return res.json();
  }

  async breakStart(userId: string, dateStr: string, timeStr: string): Promise<void> {
    await fetch(`${API_URL}/api/break-start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, date: dateStr, time: timeStr })
    });
  }

  async breakEnd(userId: string, dateStr: string, timeStr: string): Promise<void> {
    await fetch(`${API_URL}/api/break-end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, date: dateStr, time: timeStr })
    });
  }

  async updateMemo(_userId: string, _dateStr: string, _memo: string): Promise<void> {
    // TODO: backend api for memo update
  }

  async updateRecordType(_userId: string, _dateStr: string, _recordType: RecordType, _memo: string): Promise<void> {
    // TODO: backend api for schedule update
  }

  // --- 振替休暇・申請関連 ---

  async getCompensatoryBalance(userId: string): Promise<CompensatoryBalance> {
    try {
      const res = await fetch(`${API_URL}/api/users/${userId}/compensatory-balance`);
      if (!res.ok) throw new Error('Failed to fetch balance');
      return res.json();
    } catch {
      return { grantedMinutes: 0, usedMinutes: 0, remainingMinutes: 0, displayTime: '0分' };
    }
  }

  async getAllCompensatoryBalances(): Promise<Record<string, CompensatoryBalance>> {
    try {
      const res = await fetch(`${API_URL}/api/compensatory-balances`);
      if (!res.ok) throw new Error('Failed to fetch balances');
      return res.json();
    } catch {
      return {};
    }
  }

  async getRequests(params?: { userId?: string; status?: string }): Promise<AttendanceRequest[]> {
    let url = `${API_URL}/api/requests`;
    const searchParams = new URLSearchParams();
    if (params?.userId) searchParams.append('userId', params.userId);
    if (params?.status) searchParams.append('status', params.status);
    if (searchParams.toString()) url += `?${searchParams.toString()}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch requests');
    return res.json();
  }

  async createRequest(request: Partial<AttendanceRequest>): Promise<{ success: boolean; id: number }> {
    const res = await fetch(`${API_URL}/api/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    if (!res.ok) throw new Error('Failed to create request');
    return res.json();
  }

  async approveRequest(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/requests/${id}/approve`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error('Failed to approve request');
  }

  async rejectRequest(id: string, reason?: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/requests/${id}/reject`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    if (!res.ok) throw new Error('Failed to reject request');
  }

  async cancelRequest(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/requests/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Failed to cancel request');
  }

  async addRecord(userId: string, dateStr: string, details: Partial<AttendanceRecord>): Promise<void> {
    await fetch(`${API_URL}/api/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, date: dateStr, ...details })
    });
  }

  async updateRecord(id: string, details: Partial<AttendanceRecord>): Promise<void> {
    await fetch(`${API_URL}/api/records/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(details)
    });
  }

  async deleteRecord(id: string): Promise<void> {
    await fetch(`${API_URL}/api/records/${id}`, {
      method: 'DELETE',
    });
  }

  async getAllMonthlyRecords(yearMonth: string): Promise<AttendanceRecord[]> {
    const res = await fetch(`${API_URL}/api/records-all?month=${yearMonth}`);
    if (!res.ok) throw new Error('Failed to fetch all records');
    return res.json();
  }

  async sendSummaryToLine(targetUserId: string, month: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/send-summary-line`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUserId, month })
    });
    if (!res.ok) throw new Error('Failed to send summary to LINE');
  }

  // --- 社内カレンダー・スケジュール関連 ---

  async getCompanySchedule(month: string): Promise<CompanyScheduleResponse> {
    const res = await fetch(`${API_URL}/api/company-schedule?month=${month}`);
    if (!res.ok) throw new Error('Failed to fetch company schedule');
    return res.json();
  }

  async getCalendarEvents(month?: string): Promise<CalendarEvent[]> {
    let url = `${API_URL}/api/calendar-events`;
    if (month) url += `?month=${month}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch calendar events');
    return res.json();
  }

  async addCalendarEvent(event: { date: string; title: string; userId?: string; userName?: string }): Promise<CalendarEvent> {
    const res = await fetch(`${API_URL}/api/calendar-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    });
    if (!res.ok) throw new Error('Failed to add calendar event');
    return res.json();
  }

  async deleteCalendarEvent(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/calendar-events/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Failed to delete calendar event');
  }

  // --- 集計用ユーティリティ ---

  /** 拘束時間（分）から自動休憩時間（分）を算出（6時間超で60分休憩） */
  calculateAutoBreakMinutes(stayMinutes: number): number {
    if (stayMinutes > 360) {
      return 60;
    }
    return 0;
  }

  calculateRecordMinutes(record: AttendanceRecord): number {
    if (!record.clockIn || !record.clockOut) return 0;

    const clockIn = new Date(record.clockIn).getTime();
    const clockOut = new Date(record.clockOut).getTime();
    const stayMinutes = Math.max(0, Math.floor((clockOut - clockIn) / 60000));

    const breakMinutes = this.calculateAutoBreakMinutes(stayMinutes);
    return Math.max(0, stayMinutes - breakMinutes);
  }

  /** 1レコードから付与される振替休暇分数（平日: 18:00以降超過分を30分単位切り捨て、休日: 実働30分単位切り捨て） */
  calculateGrantedCompensatoryMinutes(record: AttendanceRecord): number {
    if (!record.clockIn || !record.clockOut) return 0;
    const isHoliday = Boolean(record.isHolidayWork) || isNonWorkingDay(record.date);
    if (isHoliday) {
      const workedMinutes = this.calculateRecordMinutes(record);
      return Math.floor(workedMinutes / 30) * 30;
    } else {
      const inD = new Date(record.clockIn);
      const inJst = new Date(inD.getTime() + (9 * 60 * 60 * 1000));
      const totalInMinutes = inJst.getUTCHours() * 60 + inJst.getUTCMinutes();

      const outD = new Date(record.clockOut);
      const outJst = new Date(outD.getTime() + (9 * 60 * 60 * 1000));
      const totalOutMinutes = outJst.getUTCHours() * 60 + outJst.getUTCMinutes();

      // 1. 早出分（9:00前）: 9:00 = 540分。30分単位で切り捨てて付与（8:20出勤で30分付与、8:40出勤で0分付与）
      const earlyMinutes = Math.max(0, 540 - totalInMinutes);
      const earlyGranted = Math.floor(earlyMinutes / 30) * 30;

      // 2. 残業分（18:00後）: 18:00 = 1080分。30分単位で切り捨てて付与（18:30退勤で30分付与、18:20退勤で0分付与）
      const overtimeMinutes = Math.max(0, totalOutMinutes - 1080);
      const overtimeGranted = Math.floor(overtimeMinutes / 30) * 30;

      return earlyGranted + overtimeGranted;
    }
  }

  calculateStats(records: AttendanceRecord[], _availableHolidays: number): { monthlyHours: number, overtimeHours: number, workDays: number } {
    let totalMinutes = 0;
    let workDays = 0;
    let overtimeMinutes = 0;
    const STANDARD_WORK_HOURS = 8;

    records.forEach(r => {
      if (r.clockIn && r.clockOut) workDays++;
      const workedMinutes = this.calculateRecordMinutes(r);
      totalMinutes += workedMinutes;
      
      const standardMinutes = STANDARD_WORK_HOURS * 60;
      if (workedMinutes > standardMinutes) {
        overtimeMinutes += (workedMinutes - standardMinutes);
      }
    });

      return {
      monthlyHours: totalMinutes / 60,
      overtimeHours: overtimeMinutes / 60,
      workDays,
    };
  }

  // --- LINEグループ関連 ---

  async getGroups(): Promise<LineGroup[]> {
    const res = await fetch(`${API_URL}/api/groups`);
    if (!res.ok) throw new Error('Failed to fetch groups');
    return res.json();
  }

  async getUserGroups(): Promise<UserGroup[]> {
    const res = await fetch(`${API_URL}/api/user-groups`);
    if (!res.ok) throw new Error('Failed to fetch user groups');
    return res.json();
  }

  async updateUserGroups(userId: string, groupIds: string[]): Promise<void> {
    const res = await fetch(`${API_URL}/api/users/${userId}/groups`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupIds })
    });
    if (!res.ok) throw new Error('Failed to update user groups');
  }
}

export const apiStore = new ApiStore();
