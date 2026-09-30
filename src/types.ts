// ========================================
// 型定義 — 全アプリケーション共通
// ========================================

export type Role = 'admin' | 'employee';

export interface User {
  id: string;
  name: string;
  role: Role;
  /** モック用パスワードハッシュ（本番ではバックエンド管理） */
  passwordHash: string;
}

export type RecordType = 'work' | 'morning_off' | 'afternoon_off' | 'full_off';

export interface AttendanceRecord {
  id: string;
  userId: string;
  /** YYYY-MM-DD 形式 */
  date: string;
  /** ISO 8601 文字列 */
  clockIn: string | null;
  /** ISO 8601 文字列 */
  clockOut: string | null;
  /** 休憩開始（ISO 8601） */
  breakStart: string | null;
  /** 休憩終了（ISO 8601） */
  breakEnd: string | null;
  /** 備考（早退理由、外出先など） */
  memo: string;
  /** 休日出勤フラグ */
  isHolidayWork: boolean;
  /** 予定または実績のタイプ */
  recordType?: RecordType;
}

export interface SubstituteHoliday {
  id: string;
  userId: string;
  /** 取得日（YYYY-MM-DD） */
  earnedDate: string;
  /** 残りの使用可能日数 (初期値 1.0, 0.5 単位で減算) */
  remainingDays: number;
  /** 古いデータ互換用 */
  usedDate?: string | null;
}

/** 申請種別 */
export type RequestType = 'leave' | 'clock_correction';

/** 休暇種別 */
export type LeaveType = 'paid' | 'substitute' | 'absence';

/** 振替休暇消化アクション（短縮方法） */
export type SubstituteAction = 'early_leave' | 'late_arrive' | 'full_off';

/** 申請ステータス */
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

/** 申請レコード */
export interface AttendanceRequest {
  id: string;
  userId: string;
  userName?: string;
  type: RequestType;
  leaveType?: LeaveType;
  date: string;
  substituteMinutes?: number;
  substituteAction?: SubstituteAction;
  clockIn?: string | null;
  clockOut?: string | null;
  breakStart?: string | null;
  breakEnd?: string | null;
  reason: string;
  status: RequestStatus;
  rejectionReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 振替休暇残高 */
export interface CompensatoryBalance {
  grantedMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  /** 表示用 (例: "2時間30分") */
  displayTime: string;
}

/** 従業員サマリー（管理者ダッシュボード用） */
export interface EmployeeStat {
  user: User;
  monthlyHours: number;
  overtimeHours: number;
  availableHolidays: number;
  compensatoryMinutes: number;
  compensatoryDisplay: string;
  workDays: number;
}

/** CSVエクスポート用の行データ */
export interface CsvRow {
  date: string;
  employeeName: string;
  clockIn: string;
  clockOut: string;
  breakStart: string;
  breakEnd: string;
  workHours: string;
  overtimeHours: string;
  memo: string;
  isHolidayWork: string;
}

/** 社内カレンダーイベント・メモ */
export interface CalendarEvent {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  userId?: string;
  userName?: string;
  createdAt?: string;
}

/** 社内全体の休暇・短縮情報 */
export interface CompanyLeaveItem {
  id: string;
  userId: string;
  userName: string;
  date: string;
  leaveType?: LeaveType;
  substituteAction?: SubstituteAction;
  substituteMinutes?: number;
  reason?: string;
  status: RequestStatus;
}

/** 社内全体スケジュールAPIレスポンス */
export interface CompanyScheduleResponse {
  events: CalendarEvent[];
  leaves: CompanyLeaveItem[];
}

/** LINEグループ情報 */
export interface LineGroup {
  id: string;
  name: string;
  updated_at?: string;
}

/** ユーザーとLINEグループの紐付け */
export interface UserGroup {
  user_id: string;
  group_id: string;
}

