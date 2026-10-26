-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee',
  line_user_id TEXT UNIQUE,
  password_hash TEXT
);

-- Attendance Records Table
CREATE TABLE IF NOT EXISTS attendance_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  clock_in TEXT,
  clock_out TEXT,
  break_start TEXT,
  break_end TEXT,
  memo TEXT,
  is_holiday_work INTEGER DEFAULT 0,
  FOREIGN KEY(user_id) REFERENCES users(id),
  UNIQUE(user_id, date)
);

-- Substitute Holidays Table
CREATE TABLE IF NOT EXISTS substitute_holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  earned_date TEXT NOT NULL,
  used_date TEXT,
  days REAL NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Line Groups Table (Bot参加グループ)
CREATE TABLE IF NOT EXISTS line_groups (
  id TEXT PRIMARY KEY,
  name TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- User Groups Table (ユーザーとグループの所属関係)
CREATE TABLE IF NOT EXISTS user_groups (
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, group_id)
);

-- Requests Table (休暇申請・打刻修正申請の一元管理)
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'leave' (休暇・短縮) または 'clock_correction' (打刻修正)
  leave_type TEXT,    -- 'paid' (有給), 'substitute' (振替休暇), 'absence' (欠勤)
  date TEXT NOT NULL, -- 対象日 YYYY-MM-DD
  
  -- 振替休暇 / 短縮用
  substitute_minutes INTEGER DEFAULT 0, -- 消化分数 (30, 60, 90, ..., 480)
  substitute_action TEXT, -- 'early_leave' (早退), 'late_arrive' (遅出), 'full_off' (全休)

  -- 打刻修正用
  clock_in TEXT,
  clock_out TEXT,
  break_start TEXT,
  break_end TEXT,

  reason TEXT NOT NULL, -- 申請理由
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' (申請中), 'approved' (承認), 'rejected' (却下), 'cancelled' (取消)
  rejection_reason TEXT, -- 却下理由
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Calendar Events Table (社内全体カレンダーの予定・メモ)
CREATE TABLE IF NOT EXISTS calendar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL, -- YYYY-MM-DD
  title TEXT NOT NULL, -- メモ・イベント名
  user_id TEXT, -- 作成者ID
  user_name TEXT, -- 作成者名
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
