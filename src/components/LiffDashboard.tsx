import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { ja } from 'date-fns/locale';
import { 
  Clock, 
  CheckCircle2, 
  Calendar as CalendarIcon, 
  ListOrdered, 
  PlayCircle, 
  TrendingUp, 
  Timer, 
  Edit3, 
  Plus, 
  FileText, 
  Send, 
  AlertCircle,
  ShieldCheck,
  Users,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  CalendarDays,
  ArrowRight,
  Download
} from 'lucide-react';
import { apiStore } from '../apiStore';
import { isNonWorkingDay } from '../holidays';
import { MonthNavigator } from './MonthNavigator';
import { CalendarView } from './CalendarView';
import { CompanyCalendarView } from './CompanyCalendarView';
import { Modal } from './Modal';
import type { 
  User, 
  AttendanceRecord, 
  AttendanceRequest, 
  CompensatoryBalance, 
  LeaveType, 
  SubstituteAction 
} from '../types';

interface Props {
  user: User;
}

type TabType = 'today' | 'calendar' | 'companyCalendar' | 'history' | 'requests';
type AdminTabType = 'requests' | 'employees' | 'companyCalendar';

export const LiffDashboard: React.FC<Props> = ({ user }) => {
  const isAdmin = user.role === 'admin';
  const [dashboardMode, setDashboardMode] = useState<'personal' | 'admin'>('personal');
  const [activeTab, setActiveTab] = useState<TabType>('today');
  const [adminTab, setAdminTab] = useState<AdminTabType>('requests');

  const [currentTime, setCurrentTime] = useState(new Date());
  const [currentMonth, setCurrentMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [monthlyRecords, setMonthlyRecords] = useState<AttendanceRecord[]>([]);
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | undefined>(undefined);
  const [selectedDateRecord, setSelectedDateRecord] = useState<{ date: string; record?: AttendanceRecord } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 振替休暇残高・申請データ（個人用）
  const [compensatoryBalance, setCompensatoryBalance] = useState<CompensatoryBalance>({
    grantedMinutes: 0,
    usedMinutes: 0,
    remainingMinutes: 0,
    displayTime: '0分'
  });
  const [userRequests, setUserRequests] = useState<AttendanceRequest[]>([]);

  // 休暇申請モーダル状態
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    leaveType: 'substitute' as LeaveType,
    substituteMinutes: 30,
    substituteAction: 'early_leave' as SubstituteAction,
    reason: ''
  });

  // 打刻修正申請モーダル状態
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [correctionForm, setCorrectionForm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    clockIn: '',
    clockOut: '',
    reason: ''
  });

  // 早出理由入力モーダル状態（9:00前出勤用）
  const [showEarlyInModal, setShowEarlyInModal] = useState(false);
  const [earlyInReason, setEarlyInReason] = useState('');

  // 早退申請モーダル状態（18:00前退勤用・承認必要）
  const [showEarlyLeaveModal, setShowEarlyLeaveModal] = useState(false);
  const [earlyLeaveReason, setEarlyLeaveReason] = useState('');

  // --- 管理者モード用状態 ---
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [adminAllRecords, setAdminAllRecords] = useState<AttendanceRecord[]>([]);
  const [adminCompBalances, setAdminCompBalances] = useState<Record<string, CompensatoryBalance>>({});
  const [adminAllRequests, setAdminAllRequests] = useState<AttendanceRequest[]>([]);
  const [adminRequestFilter, setAdminRequestFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [expandedEmpId, setExpandedEmpId] = useState<string | null>(null);

  // 管理者却下モーダル状態
  const [rejectingRequestId, setRejectingRequestId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  // 管理者直接編集モーダル状態
  const [adminEditingRecord, setAdminEditingRecord] = useState<AttendanceRecord | null>(null);
  const [adminEditForm, setAdminEditForm] = useState({ clockIn: '', clockOut: '', memo: '' });

  // 管理者直接追加モーダル状態
  const [adminAddTargetUserId, setAdminAddTargetUserId] = useState<string | null>(null);
  const [adminAddForm, setAdminAddForm] = useState({ date: '', clockIn: '', clockOut: '', memo: '' });

  const todayStr = format(currentTime, 'yyyy-MM-dd');

  // 1秒ごとの時計更新
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // 個人用データ取得（カスケード再実行を防ぐためselectedDateRecordへの直接依存を排除）
  const fetchData = useCallback(async () => {
    try {
      const [records, balance, requests] = await Promise.all([
        apiStore.getMonthlyRecords(user.id, currentMonth),
        apiStore.getCompensatoryBalance(user.id),
        apiStore.getRequests({ userId: user.id })
      ]);

      setMonthlyRecords(records);
      setCompensatoryBalance(balance);
      setUserRequests(requests);
      
      const today = records.find(r => r.date === todayStr);
      setTodayRecord(today);
    } catch (e) {
      console.error('Fetch error:', e);
      showToast('データ取得に失敗しました');
    }
  }, [user.id, currentMonth, todayStr, showToast]);

  // 管理者用データ取得
  const fetchAdminData = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const [users, records, compBalances, reqs] = await Promise.all([
        apiStore.getUsers(),
        apiStore.getAllMonthlyRecords(currentMonth),
        apiStore.getAllCompensatoryBalances(),
        apiStore.getRequests()
      ]);

      setAdminUsers(users);
      setAdminAllRecords(records);
      setAdminCompBalances(compBalances);
      setAdminAllRequests(reqs);
    } catch (e) {
      console.error('Admin fetch error:', e);
      showToast('管理者データの取得に失敗しました');
    }
  }, [isAdmin, currentMonth, showToast]);

  useEffect(() => {
    fetchData();
    if (isAdmin) {
      fetchAdminData();
    }
  }, [fetchData, fetchAdminData, isAdmin]);

  // 個人当月の統計情報計算
  const stats = useMemo(() => {
    return apiStore.calculateStats(monthlyRecords, 0);
  }, [monthlyRecords]);

  // 打刻ステータス判定
  const isClockedIn = !!todayRecord?.clockIn && !todayRecord?.clockOut;
  const isFinished = !!todayRecord?.clockOut;

  // 今日の実働時間（分）計算（拘束時間6時間超で60分自動控除）
  const todayWorkMinutes = useMemo(() => {
    if (!todayRecord) return 0;
    if (todayRecord.clockIn && todayRecord.clockOut) {
      return apiStore.calculateRecordMinutes(todayRecord);
    }
    if (todayRecord.clockIn) {
      const clockInTime = new Date(todayRecord.clockIn).getTime();
      const stayMinutes = Math.max(0, Math.floor((currentTime.getTime() - clockInTime) / 60000));
      const autoBreak = stayMinutes > 360 ? 60 : 0;
      return Math.max(0, stayMinutes - autoBreak);
    }
    return 0;
  }, [todayRecord, currentTime]);

  const formatMinutesToHours = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}時間${m}分`;
  };

  const formatIsoToTime = (isoString?: string | null) => {
    if (!isoString) return '--:--';
    try {
      return format(parseISO(isoString), 'HH:mm');
    } catch {
      return '--:--';
    }
  };

  // --- CSVダウンロード関数 ---
  const handleDownloadUserSummaryCsv = (targetUser: User, targetRecords: AttendanceRecord[], targetBalance?: CompensatoryBalance) => {
    const empStats = apiStore.calculateStats(targetRecords, 0);
    const balanceText = targetBalance ? targetBalance.displayTime : '0分';

    // 対象月の全日付を生成（1日〜末日）
    const monthDate = parseISO(`${currentMonth}-01`);
    const start = startOfMonth(monthDate);
    const end = endOfMonth(monthDate);
    const allDays = eachDayOfInterval({ start, end });
    const weekDayNames = ['日', '月', '火', '水', '木', '金', '土'];

    let csv = '\uFEFF'; // Excel文字化け防止BOM
    csv += `出勤サマリー (${currentMonth})\n`;
    csv += `氏名,${targetUser.name}\n`;
    csv += `総労働時間,${empStats.monthlyHours.toFixed(1)}時間\n`;
    csv += `残業時間,${empStats.overtimeHours.toFixed(1)}時間\n`;
    csv += `出勤日数,${empStats.workDays}日\n`;
    csv += `振替休暇残高,${balanceText}\n\n`;

    csv += '日付,曜日,区分,出勤時刻,退勤時刻,休憩,労働時間,備考\n';

    allDays.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const dowStr = weekDayNames[day.getDay()];
      const rec = targetRecords.find(r => r.date === dateStr);

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

        if (rec.clockIn) clockInStr = formatIsoToTime(rec.clockIn);
        if (rec.clockOut) clockOutStr = formatIsoToTime(rec.clockOut);

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

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `勤怠サマリー_${targetUser.name}_${currentMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`${targetUser.name}さんの勤怠サマリーをダウンロードしました`);
  };

  // --- 個人用ハンドラー ---
  const handleOpenLeaveModal = (targetDate?: string) => {
    setLeaveForm({
      date: targetDate || todayStr,
      leaveType: 'substitute',
      substituteMinutes: 30,
      substituteAction: 'early_leave',
      reason: ''
    });
    setShowLeaveModal(true);
  };

  const handleOpenCorrectionModal = (dateStr: string, record?: AttendanceRecord) => {
    const toTimeInput = (iso?: string | null) => {
      if (!iso) return '';
      try {
        return format(parseISO(iso), 'HH:mm');
      } catch {
        return '';
      }
    };

    setCorrectionForm({
      date: dateStr,
      clockIn: toTimeInput(record?.clockIn),
      clockOut: toTimeInput(record?.clockOut),
      reason: ''
    });
    setShowCorrectionModal(true);
  };

  const handleSubmitLeaveRequest = async () => {
    if (!leaveForm.reason.trim()) {
      showToast('申請理由（コメント）を入力してください');
      return;
    }

    if (leaveForm.leaveType === 'substitute') {
      if (leaveForm.substituteMinutes > compensatoryBalance.remainingMinutes) {
        showToast(`振替休暇の残時間（${compensatoryBalance.displayTime}）を超えています`);
        return;
      }

      // 全休の場合は480分以上の残高が必要
      if (leaveForm.substituteAction === 'full_off' && compensatoryBalance.remainingMinutes < 480) {
        showToast(`全休には振替残高が8時間（480分）以上必要です（現在: ${compensatoryBalance.displayTime}）`);
        return;
      }

      // 当日の早上がり申請は予定退勤時刻（18:00 - 短縮分数）より前でなければ不可
      if (leaveForm.substituteAction === 'early_leave' && leaveForm.date === todayStr) {
        const scheduledOutMinutes = 18 * 60 - leaveForm.substituteMinutes;
        const currentTotalMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
        if (currentTotalMinutes >= scheduledOutMinutes) {
          const h = Math.floor(scheduledOutMinutes / 60);
          const m = String(scheduledOutMinutes % 60).padStart(2, '0');
          showToast(`当日の早上がり申請は、予定退勤時刻（${h}:${m}）より前に申請する必要があります`);
          return;
        }
      }
    }

    setIsSubmitting(true);
    try {
      await apiStore.createRequest({
        userId: user.id,
        type: 'leave',
        leaveType: leaveForm.leaveType,
        date: leaveForm.date,
        substituteMinutes: leaveForm.leaveType === 'substitute' ? leaveForm.substituteMinutes : 0,
        substituteAction: leaveForm.leaveType === 'substitute' ? leaveForm.substituteAction : undefined,
        reason: leaveForm.reason.trim()
      });

      showToast('休暇申請を送信しました');
      setShowLeaveModal(false);
      await fetchData();
      if (isAdmin) await fetchAdminData();
      setActiveTab('requests');
    } catch (e) {
      console.error(e);
      showToast('申請の送信に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitCorrectionRequest = async () => {
    if (!correctionForm.reason.trim()) {
      showToast('修正理由を入力してください');
      return;
    }

    const toLocalIso = (dateStr: string, timeStr: string): string | null => {
      if (!timeStr) return null;
      const [h, m] = timeStr.split(':');
      const dt = new Date(`${dateStr}T${h}:${m}:00`);
      return dt.toISOString();
    };

    setIsSubmitting(true);
    try {
      await apiStore.createRequest({
        userId: user.id,
        type: 'clock_correction',
        date: correctionForm.date,
        clockIn: toLocalIso(correctionForm.date, correctionForm.clockIn),
        clockOut: toLocalIso(correctionForm.date, correctionForm.clockOut),
        reason: correctionForm.reason.trim()
      });

      showToast('打刻修正申請を送信しました');
      setShowCorrectionModal(false);
      await fetchData();
      if (isAdmin) await fetchAdminData();
      setActiveTab('requests');
    } catch (e) {
      console.error(e);
      showToast('修正申請の送信に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelRequest = async (requestId: string) => {
    try {
      await apiStore.cancelRequest(requestId);
      showToast('申請を取り消しました');
      await fetchData();
      if (isAdmin) await fetchAdminData();
    } catch {
      showToast('申請の取り消しに失敗しました');
    }
  };

  const handleClockIn = async () => {
    if (isSubmitting) return;
    const isHoliday = isNonWorkingDay(todayStr);

    // 平日かつ8:30より前の場合は早出理由の入力を必須とする（8:30-9:00の間はコメント不要）
    const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
    if (!isHoliday && currentMinutes < 510) { // 8:30 = 510分
      setShowEarlyInModal(true);
      return;
    }

    setIsSubmitting(true);
    try {
      await apiStore.clockIn(user.id, todayStr, currentTime.toISOString(), isHoliday);
      showToast(isHoliday ? '休日出勤を打刻しました' : '出勤を打刻しました');
      await fetchData();
      if (isAdmin) await fetchAdminData();
    } catch {
      showToast('打刻に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmEarlyIn = async () => {
    if (!earlyInReason.trim()) {
      showToast('早出理由を入力してください');
      return;
    }
    setIsSubmitting(true);
    try {
      await apiStore.clockIn(
        user.id,
        todayStr,
        currentTime.toISOString(),
        false,
        `[早出理由] ${earlyInReason.trim()}`
      );
      showToast('早出理由を登録し、出勤を打刻しました');
      setShowEarlyInModal(false);
      setEarlyInReason('');
      await fetchData();
      if (isAdmin) await fetchAdminData();
    } catch {
      showToast('打刻に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClockOut = async () => {
    if (isSubmitting) return;
    const isHoliday = isNonWorkingDay(todayStr);

    // 平日かつ18:00前の退勤（早退）は理由の記入と管理者の承認を必須とする
    if (!isHoliday && currentTime.getHours() < 18) {
      setShowEarlyLeaveModal(true);
      return;
    }

    setIsSubmitting(true);
    try {
      await apiStore.clockOut(user.id, todayStr, currentTime.toISOString());
      showToast('退勤を打刻しました。お疲れ様でした！');
      await fetchData();
      if (isAdmin) await fetchAdminData();
    } catch {
      showToast('打刻に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmEarlyLeave = async () => {
    if (!earlyLeaveReason.trim()) {
      showToast('早退理由を入力してください');
      return;
    }
    setIsSubmitting(true);
    try {
      const reasonText = earlyLeaveReason.trim();
      // 1. 退勤時刻を記録
      await apiStore.clockOut(
        user.id,
        todayStr,
        currentTime.toISOString(),
        `[早退申請中] ${reasonText}`
      );
      // 2. 早退申請を作成（管理者の承認待ち）
      await apiStore.createRequest({
        userId: user.id,
        type: 'leave',
        leaveType: 'absence',
        substituteAction: 'early_leave',
        date: todayStr,
        clockOut: currentTime.toISOString(),
        reason: reasonText
      });
      showToast('退勤を記録し、早退申請を送信しました（管理者の承認待ち）');
      setShowEarlyLeaveModal(false);
      setEarlyLeaveReason('');
      await fetchData();
      if (isAdmin) await fetchAdminData();
    } catch {
      showToast('早退申請に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- 管理者専用ハンドラー ---
  const handleApproveRequest = async (requestId: string) => {
    try {
      await apiStore.approveRequest(requestId);
      showToast('申請を承認しました');
      await fetchAdminData();
      await fetchData();
    } catch {
      showToast('申請の承認に失敗しました');
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectingRequestId) return;
    try {
      await apiStore.rejectRequest(rejectingRequestId, rejectionReason.trim());
      showToast('申請を却下しました');
      setRejectingRequestId(null);
      setRejectionReason('');
      await fetchAdminData();
      await fetchData();
    } catch {
      showToast('申請の却下に失敗しました');
    }
  };

  const handleOpenAdminEdit = (rec: AttendanceRecord) => {
    const toTimeInput = (iso?: string | null) => {
      if (!iso) return '';
      try {
        return format(parseISO(iso), 'HH:mm');
      } catch {
        return '';
      }
    };

    setAdminEditingRecord(rec);
    setAdminEditForm({
      clockIn: toTimeInput(rec.clockIn),
      clockOut: toTimeInput(rec.clockOut),
      memo: rec.memo || ''
    });
  };

  const handleSaveAdminEdit = async () => {
    if (!adminEditingRecord) return;

    const toLocalIso = (dateStr: string, timeStr: string): string | null => {
      if (!timeStr) return null;
      const [h, m] = timeStr.split(':');
      const dt = new Date(`${dateStr}T${h}:${m}:00`);
      return dt.toISOString();
    };

    try {
      await apiStore.updateRecord(adminEditingRecord.id, {
        clockIn: toLocalIso(adminEditingRecord.date, adminEditForm.clockIn) || undefined,
        clockOut: toLocalIso(adminEditingRecord.date, adminEditForm.clockOut) || undefined,
        memo: adminEditForm.memo
      });
      showToast('勤怠レコードを更新しました');
      setAdminEditingRecord(null);
      await fetchAdminData();
      await fetchData();
    } catch {
      showToast('勤怠レコードの更新に失敗しました');
    }
  };

  const handleOpenAdminAdd = (empId: string) => {
    setAdminAddTargetUserId(empId);
    setAdminAddForm({
      date: format(new Date(), 'yyyy-MM-dd'),
      clockIn: '09:00',
      clockOut: '18:00',
      memo: ''
    });
  };

  const handleSaveAdminAdd = async () => {
    if (!adminAddTargetUserId || !adminAddForm.date) {
      showToast('日付を入力してください');
      return;
    }

    const toLocalIso = (dateStr: string, timeStr: string): string | null => {
      if (!timeStr) return null;
      const [h, m] = timeStr.split(':');
      const dt = new Date(`${dateStr}T${h}:${m}:00`);
      return dt.toISOString();
    };

    try {
      await apiStore.addRecord(adminAddTargetUserId, adminAddForm.date, {
        clockIn: toLocalIso(adminAddForm.date, adminAddForm.clockIn) || undefined,
        clockOut: toLocalIso(adminAddForm.date, adminAddForm.clockOut) || undefined,
        memo: adminAddForm.memo
      });
      showToast('勤怠レコードを追加しました');
      setAdminAddTargetUserId(null);
      await fetchAdminData();
      await fetchData();
    } catch {
      showToast('勤怠レコードの追加に失敗しました');
    }
  };

  // 未処理申請の件数
  const pendingAdminRequestsCount = useMemo(() => {
    return adminAllRequests.filter(r => r.status === 'pending').length;
  }, [adminAllRequests]);

  // フィルタ済み管理者申請一覧
  const filteredAdminRequests = useMemo(() => {
    if (adminRequestFilter === 'all') return adminAllRequests;
    return adminAllRequests.filter(r => r.status === adminRequestFilter);
  }, [adminAllRequests, adminRequestFilter]);

  const getStatusBadge = () => {
    if (isFinished) {
      return <span className="status-badge-pill finished">退勤済</span>;
    }
    if (isClockedIn) {
      return <span className="status-badge-pill working">勤務中</span>;
    }
    return <span className="status-badge-pill not-started">未出勤</span>;
  };

  // 30分単位の選択肢
  const substituteMinuteOptions = [
    { value: 30, label: '30分' },
    { value: 60, label: '1時間 (60分)' },
    { value: 90, label: '1時間30分 (90分)' },
    { value: 120, label: '2時間 (120分)' },
    { value: 150, label: '2時間30分 (150分)' },
    { value: 180, label: '3時間 (180分)' },
    { value: 210, label: '3時間30分 (210分)' },
    { value: 240, label: '4時間 (240分)' },
    { value: 300, label: '5時間 (300分)' },
    { value: 360, label: '6時間 (360分)' },
    { value: 420, label: '7時間 (420分)' },
    { value: 480, label: '全休 (8時間 / 480分)' },
  ];

  return (
    <div className="liff-container animate-fade-in">
      {toast && <div className="toast animate-fade-in">{toast}</div>}

      {/* ヘッダー */}
      <header className="liff-header glass-card">
        <div className="liff-user-info">
          <div>
            <div className="liff-app-title">勤怠管理 (LINE)</div>
            <div className="liff-user-name">
              <span>{user.name} さん</span>
              {isAdmin && (
                <button
                  className={`liff-admin-toggle-btn ${dashboardMode === 'admin' ? 'to-personal' : ''}`}
                  onClick={() => {
                    if (dashboardMode === 'personal') {
                      setDashboardMode('admin');
                      fetchAdminData();
                    } else {
                      setDashboardMode('personal');
                    }
                  }}
                  title={dashboardMode === 'personal' ? '管理者画面へ切替' : '個人打刻画面へ戻る'}
                >
                  {dashboardMode === 'personal' ? (
                    <>
                      <ShieldCheck size={12} />
                      <span>管理画面</span>
                      {pendingAdminRequestsCount > 0 && (
                        <span className="badge-count" style={{ marginLeft: '2px', background: '#ef4444' }}>
                          {pendingAdminRequestsCount}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <Clock size={12} />
                      <span>個人打刻へ戻る</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
          <div className="liff-header-actions">
            {dashboardMode === 'personal' && getStatusBadge()}
          </div>
        </div>

        {/* タブナビゲーション（個人モード時: 5分割グリッド） */}
        {dashboardMode === 'personal' && (
          <nav className="liff-tabs">
            <button 
              className={`liff-tab-btn ${activeTab === 'today' ? 'active' : ''}`}
              onClick={() => setActiveTab('today')}
            >
              <Clock size={16} />
              <span>打刻</span>
            </button>
            <button 
              className={`liff-tab-btn ${activeTab === 'calendar' ? 'active' : ''}`}
              onClick={() => setActiveTab('calendar')}
            >
              <CalendarIcon size={16} />
              <span>自分カレ</span>
            </button>
            <button 
              className={`liff-tab-btn ${activeTab === 'companyCalendar' ? 'active' : ''}`}
              onClick={() => setActiveTab('companyCalendar')}
            >
              <CalendarDays size={16} />
              <span>社内カレ</span>
            </button>
            <button 
              className={`liff-tab-btn ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              <ListOrdered size={16} />
              <span>履歴</span>
            </button>
            <button 
              className={`liff-tab-btn ${activeTab === 'requests' ? 'active' : ''}`}
              onClick={() => setActiveTab('requests')}
            >
              <FileText size={16} />
              <span>申請</span>
              {userRequests.some(r => r.status === 'pending') && (
                <span className="badge-count" style={{ marginLeft: '2px' }}>
                  {userRequests.filter(r => r.status === 'pending').length}
                </span>
              )}
            </button>
          </nav>
        )}

        {/* タブナビゲーション（管理者モード時: 3分割グリッド） */}
        {dashboardMode === 'admin' && (
          <nav className="liff-tabs admin-mode">
            <button 
              className={`liff-tab-btn admin-tab ${adminTab === 'requests' ? 'active' : ''}`}
              onClick={() => {
                setAdminTab('requests');
                fetchAdminData();
              }}
            >
              <CheckCircle2 size={16} />
              <span>申請承認 {pendingAdminRequestsCount > 0 ? `(${pendingAdminRequestsCount})` : ''}</span>
            </button>
            <button 
              className={`liff-tab-btn admin-tab ${adminTab === 'employees' ? 'active' : ''}`}
              onClick={() => {
                setAdminTab('employees');
                fetchAdminData();
              }}
            >
              <Users size={16} />
              <span>従業員勤怠</span>
            </button>
            <button 
              className={`liff-tab-btn admin-tab ${adminTab === 'companyCalendar' ? 'active' : ''}`}
              onClick={() => {
                setAdminTab('companyCalendar');
              }}
            >
              <CalendarDays size={16} />
              <span>社内カレンダー</span>
            </button>
          </nav>
        )}
      </header>

      {/* メインコンテンツ */}
      <main className="liff-main-content">

        {/* 個人モード時、未処理申請があればコンパクトな案内バナーを表示 */}
        {isAdmin && dashboardMode === 'personal' && pendingAdminRequestsCount > 0 && (
          <div 
            className="liff-pending-banner animate-fade-in"
            onClick={() => {
              setDashboardMode('admin');
              setAdminTab('requests');
              fetchAdminData();
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertCircle size={16} color="#d97706" />
              <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#92400e' }}>
                未処理申請: {pendingAdminRequestsCount}件
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.75rem', fontWeight: 700, color: '#b45309' }}>
              <span>確認する</span>
              <ArrowRight size={13} />
            </div>
          </div>
        )}
        
        {/* ====================================================
            管理者モードのビュー
           ==================================================== */}
        {dashboardMode === 'admin' && (
          <div className="animate-fade-in">
            {/* --- 管理者タブ 1: 申請承認 --- */}
            {adminTab === 'requests' && (
              <div className="animate-fade-in">
                {/* フィルターバー */}
                <div className="liff-filter-bar">
                  <button
                    className={`liff-filter-pill ${adminRequestFilter === 'pending' ? 'active' : ''}`}
                    onClick={() => setAdminRequestFilter('pending')}
                  >
                    未処理 ({pendingAdminRequestsCount})
                  </button>
                  <button
                    className={`liff-filter-pill ${adminRequestFilter === 'approved' ? 'active' : ''}`}
                    onClick={() => setAdminRequestFilter('approved')}
                  >
                    承認済
                  </button>
                  <button
                    className={`liff-filter-pill ${adminRequestFilter === 'rejected' ? 'active' : ''}`}
                    onClick={() => setAdminRequestFilter('rejected')}
                  >
                    却下
                  </button>
                  <button
                    className={`liff-filter-pill ${adminRequestFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setAdminRequestFilter('all')}
                  >
                    すべて ({adminAllRequests.length})
                  </button>
                </div>

                {/* 申請リスト */}
                {filteredAdminRequests.length === 0 ? (
                  <div className="empty-state glass-card" style={{ padding: '32px 16px', textAlign: 'center' }}>
                    <p style={{ color: 'var(--text-secondary)' }}>該当する申請はありません</p>
                  </div>
                ) : (
                  <div>
                    {filteredAdminRequests.map(req => {
                      const isPending = req.status === 'pending';
                      let typeLabel = '休暇申請';
                      if (req.type === 'clock_correction') {
                        typeLabel = '打刻修正';
                      } else if (req.leaveType === 'paid') {
                        typeLabel = '有給休暇';
                      } else if (req.leaveType === 'substitute') {
                        const actionName = req.substituteAction === 'early_leave' ? '早退' : (req.substituteAction === 'late_arrive' ? '遅出' : '全休');
                        typeLabel = `振替休暇 (${actionName} ${req.substituteMinutes}分消化)`;
                      } else if (req.leaveType === 'absence') {
                        typeLabel = '欠勤';
                      }

                      return (
                        <div key={req.id} className="liff-admin-req-card animate-fade-in">
                          <div className="liff-admin-req-header">
                            <div>
                              <div className="liff-admin-req-user">{req.userName}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {req.createdAt ? format(parseISO(req.createdAt), 'M/d HH:mm 申請') : ''}
                              </div>
                            </div>
                            <span className={`status-tag ${req.status}`}>
                              {req.status === 'pending' ? '承認待ち' : (req.status === 'approved' ? '承認済' : (req.status === 'rejected' ? '却下' : '取消'))}
                            </span>
                          </div>

                          <div className="liff-admin-req-body">
                            <div className="liff-admin-req-row">
                              <div className="liff-admin-req-label">申請種別:</div>
                              <div className="liff-admin-req-value" style={{ fontWeight: 700, color: 'var(--primary-color)' }}>
                                {typeLabel}
                              </div>
                            </div>
                            <div className="liff-admin-req-row">
                              <div className="liff-admin-req-label">対象日:</div>
                              <div className="liff-admin-req-value">{req.date}</div>
                            </div>
                            {req.type === 'clock_correction' && (
                              <div className="liff-admin-req-row">
                                <div className="liff-admin-req-label">修正時刻:</div>
                                <div className="liff-admin-req-value">
                                  出勤 {formatIsoToTime(req.clockIn)} 〜 退勤 {formatIsoToTime(req.clockOut)}
                                </div>
                              </div>
                            )}
                            <div className="liff-admin-req-row">
                              <div className="liff-admin-req-label">理由:</div>
                              <div className="liff-admin-req-value">{req.reason}</div>
                            </div>
                            {req.rejectionReason && (
                              <div className="liff-admin-req-row" style={{ color: 'var(--danger-color)' }}>
                                <div className="liff-admin-req-label">却下理由:</div>
                                <div className="liff-admin-req-value">{req.rejectionReason}</div>
                              </div>
                            )}
                          </div>

                          {isPending && (
                            <div className="liff-admin-req-actions">
                              <button
                                className="liff-btn-approve"
                                onClick={() => handleApproveRequest(req.id)}
                              >
                                <Check size={16} />
                                <span>承認する</span>
                              </button>
                              <button
                                className="liff-btn-reject"
                                onClick={() => {
                                  setRejectingRequestId(req.id);
                                  setRejectionReason('');
                                }}
                              >
                                <X size={16} />
                                <span>却下</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* --- 管理者タブ 2: 従業員勤怠 --- */}
            {adminTab === 'employees' && (
              <div className="animate-fade-in">
                <MonthNavigator
                  currentMonth={currentMonth}
                  onChange={setCurrentMonth}
                />

                <div style={{ marginTop: '14px' }}>
                  {adminUsers.map(emp => {
                    const empRecords = adminAllRecords.filter(r => r.userId === emp.id);
                    const empStats = apiStore.calculateStats(empRecords, 0);
                    const balance = adminCompBalances[emp.id] || { displayTime: '0分' };
                    const isExpanded = expandedEmpId === emp.id;

                    return (
                      <div key={emp.id} className="liff-admin-emp-card animate-fade-in">
                        <div 
                          className="liff-admin-emp-header"
                          onClick={() => setExpandedEmpId(isExpanded ? null : emp.id)}
                        >
                          <div className="liff-admin-emp-info">
                            <div className="liff-admin-emp-avatar">
                              {emp.name.charAt(0)}
                            </div>
                            <div>
                              <div className="liff-admin-emp-name">
                                {emp.name}
                                {emp.role === 'admin' && (
                                  <span className="badge-primary" style={{ marginLeft: '6px', fontSize: '0.6875rem', background: '#4f46e5', color: '#fff', padding: '2px 6px', borderRadius: '4px' }}>
                                    管理者
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                振替残高: <strong style={{ color: 'var(--primary-color)' }}>{balance.displayTime}</strong>
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)' }}>
                            <span style={{ fontSize: '0.75rem' }}>{isExpanded ? '閉じる' : '詳細'}</span>
                            {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                          </div>
                        </div>

                        {/* サマリーメトリクス */}
                        <div className="liff-admin-emp-metrics">
                          <div className="liff-admin-emp-metric-box">
                            <div className="liff-admin-emp-metric-label">総労働時間</div>
                            <div className="liff-admin-emp-metric-val">{empStats.monthlyHours.toFixed(1)}h</div>
                          </div>
                          <div className="liff-admin-emp-metric-box">
                            <div className="liff-admin-emp-metric-label">残業時間</div>
                            <div className="liff-admin-emp-metric-val" style={{ color: empStats.overtimeHours > 0 ? 'var(--primary-color)' : 'inherit' }}>
                              {empStats.overtimeHours.toFixed(1)}h
                            </div>
                          </div>
                          <div className="liff-admin-emp-metric-box">
                            <div className="liff-admin-emp-metric-label">出勤日数</div>
                            <div className="liff-admin-emp-metric-val">{empStats.workDays}日</div>
                          </div>
                        </div>

                        {/* 展開時の日別勤怠リスト */}
                        {isExpanded && (
                          <div className="liff-admin-records-table animate-fade-in">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', gap: '6px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.8125rem', fontWeight: 700 }}>当月の日別打刻一覧</span>
                              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                <button
                                  className="btn btn-sm"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    try {
                                      await apiStore.sendSummaryToLine(emp.id, currentMonth);
                                      showToast(`LINEに${emp.name}さんの勤怠サマリーを送信しました！`);
                                    } catch {
                                      showToast('LINE送信に失敗しました');
                                    }
                                  }}
                                  style={{ padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', background: '#06c755', color: '#ffffff', border: 'none' }}
                                  title="LINEトークにサマリーを送信"
                                >
                                  <Send size={12} />
                                  <span>LINEに送信</span>
                                </button>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDownloadUserSummaryCsv(emp, empRecords, balance);
                                  }}
                                  style={{ padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                                  title="出勤サマリー表をCSVダウンロード"
                                >
                                  <Download size={12} />
                                  <span>CSV</span>
                                </button>
                                <button
                                  className="btn btn-primary btn-sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenAdminAdd(emp.id);
                                  }}
                                  style={{ padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                                >
                                  <Plus size={12} />
                                  <span>追加</span>
                                </button>
                              </div>
                            </div>

                            {empRecords.length === 0 ? (
                              <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '12px 0' }}>
                                当月の打刻データはありません
                              </p>
                            ) : (
                              empRecords.sort((a, b) => b.date.localeCompare(a.date)).map(rec => (
                                <div key={rec.id} className="liff-admin-record-item">
                                  <div>
                                    <div className="liff-admin-record-date">
                                      {rec.date}
                                      {rec.isHolidayWork && (
                                        <span className="badge-holiday" style={{ marginLeft: '6px', fontSize: '0.625rem' }}>
                                          休日出勤
                                        </span>
                                      )}
                                    </div>
                                    <div className="liff-admin-record-time">
                                      {rec.clockIn ? formatIsoToTime(rec.clockIn) : '--:--'} 〜 {rec.clockOut ? formatIsoToTime(rec.clockOut) : '--:--'}
                                      {rec.memo && (
                                        <span style={{ marginLeft: '6px', color: 'var(--text-muted)' }}>
                                          ({rec.memo})
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <button
                                    className="liff-admin-record-edit-btn"
                                    onClick={() => handleOpenAdminEdit(rec)}
                                  >
                                    <Edit3 size={12} />
                                    <span>修正</span>
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* --- 管理者タブ 3: 社内カレンダー --- */}
            {adminTab === 'companyCalendar' && (
              <div className="animate-fade-in">
                <CompanyCalendarView currentUser={user} isAdmin={true} />
              </div>
            )}
          </div>
        )}

        {/* ====================================================
            個人打刻モードのビュー（従来のLIFF画面）
           ==================================================== */}
        {dashboardMode === 'personal' && (
          <>
            {/* ================= タブ 1: 今日の打刻 ================= */}
            {activeTab === 'today' && (
              <div className="liff-tab-pane animate-fade-in">
                
                {/* 振替休暇残高カード */}
                <div className="compensatory-card mb-3">
                  <div>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                      振替休暇 残時間
                    </div>
                    <div className="compensatory-value">
                      {compensatoryBalance.displayTime}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      （30分単位で出退勤短縮に利用可能）
                    </div>
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => handleOpenLeaveModal(todayStr)}
                    style={{ padding: '8px 12px' }}
                  >
                    <Send size={14} />
                    <span>休暇・短縮申請</span>
                  </button>
                </div>

                {/* リアルタイム時計カード */}
                <section className="liff-clock-card glass-card">
                  <p className="liff-clock-date">
                    {format(currentTime, 'yyyy年M月d日（E）', { locale: ja })}
                  </p>
                  <div className="liff-clock-time">{format(currentTime, 'HH:mm:ss')}</div>

                  {/* 打刻アクションボタン（出勤・退勤の2ボタンのみ。休憩は拘束時間から自動控除） */}
                  {isFinished ? (
                    <div className="liff-finished-banner">
                      <CheckCircle2 size={36} className="text-success" />
                      <div>
                        <div className="finished-title">本日の業務は終了しました</div>
                        <div className="finished-subtitle">お疲れ様でした！</div>
                      </div>
                    </div>
                  ) : (
                    <div className="liff-action-grid">
                      <button
                        className={`liff-btn-clockin ${isClockedIn ? 'disabled' : ''}`}
                        onClick={handleClockIn}
                        disabled={isClockedIn || isSubmitting}
                      >
                        <PlayCircle size={24} />
                        <span>出勤</span>
                      </button>

                      <button
                        className={`liff-btn-clockout ${!isClockedIn ? 'disabled' : ''}`}
                        onClick={handleClockOut}
                        disabled={!isClockedIn || isSubmitting}
                      >
                        <CheckCircle2 size={24} />
                        <span>退勤</span>
                      </button>
                    </div>
                  )}
                </section>

                {/* 本日の打刻サマリーカード */}
                <section className="liff-today-summary glass-card">
                  <div className="summary-card-header-with-action">
                    <div className="summary-card-header">
                      <Timer size={18} className="text-primary" />
                      <h2>本日の打刻・勤務状況</h2>
                    </div>
                    <button
                      className="liff-mini-edit-btn"
                      onClick={() => handleOpenCorrectionModal(todayStr, todayRecord)}
                      title="本日の打刻修正申請"
                    >
                      <Edit3 size={14} />
                      <span>修正申請</span>
                    </button>
                  </div>

                  <div className="summary-metrics-grid">
                    <div className="summary-metric-box">
                      <div className="metric-label">出勤時刻</div>
                      <div className="metric-value">
                        {formatIsoToTime(todayRecord?.clockIn)}
                      </div>
                    </div>
                    <div className="summary-metric-box">
                      <div className="metric-label">退勤時刻</div>
                      <div className="metric-value">
                        {formatIsoToTime(todayRecord?.clockOut)}
                      </div>
                    </div>
                    <div className="summary-metric-box">
                      <div className="metric-label">休憩</div>
                      <div className="metric-value">
                        {todayRecord?.clockIn ? (todayWorkMinutes > 360 ? '60分' : '0分') : '--'}
                      </div>
                    </div>
                    <div className="summary-metric-box">
                      <div className="metric-label">実労働時間</div>
                      <div className="metric-value highlight">
                        {todayRecord?.clockIn ? formatMinutesToHours(todayWorkMinutes) : '--'}
                      </div>
                    </div>
                  </div>

                  {todayRecord?.memo && (
                    <div className="summary-memo-box">
                      <AlertCircle size={14} />
                      <span>{todayRecord.memo}</span>
                    </div>
                  )}
                </section>

                {/* 当月サマリーカード */}
                <section className="liff-monthly-summary glass-card">
                  <div className="summary-card-header">
                    <TrendingUp size={18} className="text-primary" />
                    <h2>当月サマリー ({format(new Date(), 'yyyy年M月')})</h2>
                  </div>
                  <div className="summary-metrics-grid">
                    <div className="summary-metric-box">
                      <div className="metric-label">総勤務時間</div>
                      <div className="metric-value">{stats.monthlyHours.toFixed(1)}h</div>
                    </div>
                    <div className="summary-metric-box">
                      <div className="metric-label">残業時間</div>
                      <div className="metric-value">{stats.overtimeHours.toFixed(1)}h</div>
                    </div>
                    <div className="summary-metric-box">
                      <div className="metric-label">出勤日数</div>
                      <div className="metric-value">{stats.workDays}日</div>
                    </div>
                    <div className="summary-metric-box">
                      <div className="metric-label">振替残時間</div>
                      <div className="metric-value highlight">{compensatoryBalance.displayTime}</div>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* ================= タブ 2: カレンダー ================= */}
            {activeTab === 'calendar' && (
              <div className="liff-tab-pane animate-fade-in">
                <MonthNavigator
                  currentMonth={currentMonth}
                  onChange={setCurrentMonth}
                />
                <CalendarView
                  currentMonth={currentMonth}
                  records={monthlyRecords}
                  selectedDate={selectedDateRecord?.date}
                  onDateClick={(dateStr: string, rec: AttendanceRecord | undefined) => {
                    const record = rec || monthlyRecords.find(r => r.date === dateStr);
                    setSelectedDateRecord({ date: dateStr, record });
                  }}
                />

                {selectedDateRecord && (
                  <div className="liff-selected-date-card glass-card animate-fade-in">
                    <div className="selected-date-header">
                      <h3>{selectedDateRecord.date} の勤怠詳細</h3>
                      <button
                        className="liff-mini-edit-btn"
                        onClick={() => handleOpenCorrectionModal(selectedDateRecord.date, selectedDateRecord.record)}
                      >
                        <Edit3 size={14} />
                        <span>修正申請</span>
                      </button>
                    </div>
                    <div className="selected-date-metrics">
                      <div>出勤: <strong>{formatIsoToTime(selectedDateRecord.record?.clockIn)}</strong></div>
                      <div>退勤: <strong>{formatIsoToTime(selectedDateRecord.record?.clockOut)}</strong></div>
                      <div>
                        労働時間: <strong>
                          {selectedDateRecord.record ? formatMinutesToHours(apiStore.calculateRecordMinutes(selectedDateRecord.record)) : '0時間0分'}
                        </strong>
                      </div>
                    </div>
                    {selectedDateRecord.record?.memo && (
                      <div className="selected-date-memo">
                        メモ: {selectedDateRecord.record.memo}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ================= タブ: 社内カレンダー ================= */}
            {activeTab === 'companyCalendar' && (
              <div className="liff-tab-pane animate-fade-in">
                <CompanyCalendarView currentUser={user} isAdmin={false} />
              </div>
            )}

            {/* ================= タブ 3: 履歴 ================= */}
            {activeTab === 'history' && (
              <div className="liff-tab-pane animate-fade-in">
                <MonthNavigator
                  currentMonth={currentMonth}
                  onChange={setCurrentMonth}
                />

                <div className="liff-history-list">
                  {monthlyRecords.length === 0 ? (
                    <div className="empty-state glass-card">
                      <p>当月の勤怠記録はありません</p>
                    </div>
                  ) : (
                    monthlyRecords
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map(rec => {
                        const workedMin = apiStore.calculateRecordMinutes(rec);
                        return (
                          <div key={rec.id} className="liff-history-item glass-card">
                            <div className="history-item-top">
                              <div className="history-date">
                                <CalendarDays size={16} />
                                <span>{rec.date}</span>
                                {rec.isHolidayWork && <span className="badge-holiday">休日出勤</span>}
                              </div>
                              <button
                                className="liff-mini-edit-btn"
                                onClick={() => handleOpenCorrectionModal(rec.date, rec)}
                                title="修正申請"
                              >
                                <Edit3 size={12} />
                                <span>修正申請</span>
                              </button>
                            </div>
                            <div className="history-item-times">
                              <div className="history-time-box">
                                <span className="time-label">出勤</span>
                                <span className="time-val">{formatIsoToTime(rec.clockIn)}</span>
                              </div>
                              <div className="history-time-box">
                                <span className="time-label">退勤</span>
                                <span className="time-val">{formatIsoToTime(rec.clockOut)}</span>
                              </div>
                              <div className="history-time-box">
                                <span className="time-label">労働時間</span>
                                <span className="time-val highlight">{formatMinutesToHours(workedMin)}</span>
                              </div>
                            </div>
                            {rec.memo && (
                              <div className="history-item-memo">
                                {rec.memo}
                              </div>
                            )}
                          </div>
                        );
                      })
                  )}
                </div>
              </div>
            )}

            {/* ================= タブ 4: 申請・残高 ================= */}
            {activeTab === 'requests' && (
              <div className="liff-tab-pane animate-fade-in">
                {/* 振替休暇サマリー */}
                <div className="compensatory-card mb-3">
                  <div>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                      振替休暇 残時間
                    </div>
                    <div className="compensatory-value">
                      {compensatoryBalance.displayTime}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      付与: {compensatoryBalance.grantedMinutes}分 / 消化: {compensatoryBalance.usedMinutes}分
                    </div>
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => handleOpenLeaveModal()}
                    style={{ padding: '8px 12px' }}
                  >
                    <Send size={14} />
                    <span>新規申請</span>
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ flex: 1, padding: '10px' }}
                    onClick={() => handleOpenCorrectionModal(todayStr)}
                  >
                    <Edit3 size={14} />
                    <span>打刻修正を申請</span>
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ flex: 1, padding: '10px' }}
                    onClick={() => handleOpenLeaveModal()}
                  >
                    <FileText size={14} />
                    <span>休暇・短縮を申請</span>
                  </button>
                </div>

                {/* 申請履歴 */}
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, marginBottom: '10px', color: 'var(--text-secondary)' }}>
                  あなたの申請履歴
                </h3>

                {userRequests.length === 0 ? (
                  <div className="empty-state glass-card" style={{ padding: '24px 16px' }}>
                    <p>これまでに送信した申請はありません</p>
                  </div>
                ) : (
                  <div className="requests-list">
                    {userRequests.map(req => {
                      const isPending = req.status === 'pending';
                      let typeLabel = '休暇申請';
                      if (req.type === 'clock_correction') {
                        typeLabel = '打刻修正';
                      } else if (req.leaveType === 'paid') {
                        typeLabel = '有給休暇';
                      } else if (req.leaveType === 'substitute') {
                        const actionName = req.substituteAction === 'early_leave' ? '早退' : (req.substituteAction === 'late_arrive' ? '遅出' : '全休');
                        typeLabel = `振替休暇 (${actionName} ${req.substituteMinutes}分)`;
                      } else if (req.leaveType === 'absence') {
                        typeLabel = '欠勤';
                      }

                      return (
                        <div key={req.id} className="request-card glass-card animate-fade-in">
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                            <div>
                              <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                {typeLabel}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                対象日: {req.date}
                              </div>
                            </div>
                            <span className={`status-tag ${req.status}`}>
                              {req.status === 'pending' ? '承認待ち' : (req.status === 'approved' ? '承認済' : (req.status === 'rejected' ? '却下' : '取消'))}
                            </span>
                          </div>

                          {req.type === 'clock_correction' && (
                            <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                              希望打刻: {formatIsoToTime(req.clockIn)} 〜 {formatIsoToTime(req.clockOut)}
                            </div>
                          )}

                          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                            理由: {req.reason}
                          </div>

                          {req.rejectionReason && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--danger-color)', marginBottom: '8px', background: '#fee2e2', padding: '6px 8px', borderRadius: '4px' }}>
                              却下理由: {req.rejectionReason}
                            </div>
                          )}

                          {isPending && (
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => handleCancelRequest(req.id)}
                                style={{ color: 'var(--danger-color)', borderColor: '#fecaca', padding: '4px 10px', fontSize: '0.75rem' }}
                              >
                                申請を取り消す
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* ====================================================
          モーダル群（休憩入力項目は排除し、出退勤から自動計算）
         ==================================================== */}

      {/* 休暇申請モーダル */}
      <Modal
        isOpen={showLeaveModal}
        onClose={() => setShowLeaveModal(false)}
        onConfirm={handleSubmitLeaveRequest}
        title="休暇・短縮の申請"
        confirmLabel={isSubmitting ? '送信中...' : '申請を送信'}
      >
        <div className="edit-record-form">
          <div className="form-group">
            <label className="form-label">対象日</label>
            <input
              type="date"
              className="input-field"
              value={leaveForm.date}
              onChange={e => setLeaveForm({ ...leaveForm, date: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">休暇・申請種別</label>
            <div className="radio-group-horizontal">
              <label className={`radio-pill-label ${leaveForm.leaveType === 'substitute' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="leaveType"
                  value="substitute"
                  checked={leaveForm.leaveType === 'substitute'}
                  onChange={() => setLeaveForm({ ...leaveForm, leaveType: 'substitute' })}
                  style={{ display: 'none' }}
                />
                <span>振替休暇（30分単位）</span>
              </label>

              <label className={`radio-pill-label ${leaveForm.leaveType === 'paid' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="leaveType"
                  value="paid"
                  checked={leaveForm.leaveType === 'paid'}
                  onChange={() => setLeaveForm({ ...leaveForm, leaveType: 'paid' })}
                  style={{ display: 'none' }}
                />
                <span>有給休暇</span>
              </label>

              <label className={`radio-pill-label ${leaveForm.leaveType === 'absence' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="leaveType"
                  value="absence"
                  checked={leaveForm.leaveType === 'absence'}
                  onChange={() => setLeaveForm({ ...leaveForm, leaveType: 'absence' })}
                  style={{ display: 'none' }}
                />
                <span>欠勤</span>
              </label>
            </div>
          </div>

          {leaveForm.leaveType === 'substitute' && (
            <>
              <div className="form-group">
                <label className="form-label">消化アクション（利用方法）</label>
                <div className="radio-group-horizontal">
                  <label className={`radio-pill-label ${leaveForm.substituteAction === 'early_leave' ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="subAction"
                      value="early_leave"
                      checked={leaveForm.substituteAction === 'early_leave'}
                      onChange={() => setLeaveForm({ ...leaveForm, substituteAction: 'early_leave' })}
                      style={{ display: 'none' }}
                    />
                    <span>早退</span>
                  </label>
                  <label className={`radio-pill-label ${leaveForm.substituteAction === 'late_arrive' ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="subAction"
                      value="late_arrive"
                      checked={leaveForm.substituteAction === 'late_arrive'}
                      onChange={() => setLeaveForm({ ...leaveForm, substituteAction: 'late_arrive' })}
                      style={{ display: 'none' }}
                    />
                    <span>遅出</span>
                  </label>
                  <label className={`radio-pill-label ${leaveForm.substituteAction === 'full_off' ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="subAction"
                      value="full_off"
                      checked={leaveForm.substituteAction === 'full_off'}
                      onChange={() => setLeaveForm({ ...leaveForm, substituteAction: 'full_off', substituteMinutes: 480 })}
                      style={{ display: 'none' }}
                    />
                    <span>全休 (8h)</span>
                  </label>
                </div>
              </div>

              {leaveForm.substituteAction !== 'full_off' && (
                <div className="form-group">
                  <label className="form-label">消化時間（30分単位）</label>
                  <select
                    className="input-field"
                    value={leaveForm.substituteMinutes}
                    onChange={e => setLeaveForm({ ...leaveForm, substituteMinutes: Number(e.target.value) })}
                  >
                    {substituteMinuteOptions.filter(opt => opt.value <= 480).map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {leaveForm.substituteMinutes > compensatoryBalance.remainingMinutes && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--danger-color)', fontSize: '0.75rem', marginTop: '-4px' }}>
                  <AlertCircle size={14} />
                  <span>指定した時間が現在の振替残時間（{compensatoryBalance.displayTime}）を超えています</span>
                </div>
              )}

              {leaveForm.substituteAction === 'full_off' && compensatoryBalance.remainingMinutes < 480 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--danger-color)', fontSize: '0.75rem', marginTop: '4px' }}>
                  <AlertCircle size={14} />
                  <span>全休には8時間（480分）以上の振替残高が必要です（現在: {compensatoryBalance.displayTime}）</span>
                </div>
              )}

              {leaveForm.substituteAction === 'early_leave' && leaveForm.date === todayStr && (() => {
                const scheduledMin = 18 * 60 - leaveForm.substituteMinutes;
                const isPast = (currentTime.getHours() * 60 + currentTime.getMinutes()) >= scheduledMin;
                const h = Math.floor(scheduledMin / 60);
                const m = String(scheduledMin % 60).padStart(2, '0');
                return (
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '6px', 
                    color: isPast ? 'var(--danger-color)' : 'var(--primary-color)', 
                    fontSize: '0.75rem', 
                    marginTop: '4px' 
                  }}>
                    <AlertCircle size={14} />
                    <span>
                      {isPast 
                        ? `早上がり予定時刻（${h}:${m}）を過ぎているため申請できません` 
                        : `本日の早上がり予定時刻は ${h}:${m} です（予定時刻前まで申請可能）`}
                    </span>
                  </div>
                );
              })()}
            </>
          )}

          <div className="form-group">
            <label className="form-label">申請理由 <span style={{ color: 'var(--danger-color)' }}>*</span></label>
            <textarea
              className="input-field"
              rows={3}
              placeholder="例: 私用のため17:00退勤（早退60分）、通院のためなど"
              value={leaveForm.reason}
              onChange={e => setLeaveForm({ ...leaveForm, reason: e.target.value })}
            />
          </div>
        </div>
      </Modal>

      {/* 打刻修正申請モーダル（個人用） */}
      <Modal
        isOpen={showCorrectionModal}
        onClose={() => setShowCorrectionModal(false)}
        onConfirm={handleSubmitCorrectionRequest}
        title="打刻修正の申請"
        confirmLabel={isSubmitting ? '送信中...' : '修正申請を送信'}
      >
        <div className="edit-record-form">
          <div className="form-group">
            <label className="form-label">対象日</label>
            <input
              type="date"
              className="input-field"
              value={correctionForm.date}
              onChange={e => setCorrectionForm({ ...correctionForm, date: e.target.value })}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">出勤時刻</label>
              <input
                type="time"
                className="input-field"
                value={correctionForm.clockIn}
                onChange={e => setCorrectionForm({ ...correctionForm, clockIn: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">退勤時刻</label>
              <input
                type="time"
                className="input-field"
                value={correctionForm.clockOut}
                onChange={e => setCorrectionForm({ ...correctionForm, clockOut: e.target.value })}
              />
            </div>
          </div>

          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '-6px', marginBottom: '10px' }}>
            ※ 拘束時間が6時間を超える場合は、自動で60分の休憩が控除されます。
          </p>

          <div className="form-group">
            <label className="form-label">修正理由 <span style={{ color: 'var(--danger-color)' }}>*</span></label>
            <textarea
              className="input-field"
              rows={3}
              placeholder="例: 退勤打刻忘れのため"
              value={correctionForm.reason}
              onChange={e => setCorrectionForm({ ...correctionForm, reason: e.target.value })}
            />
          </div>
        </div>
      </Modal>

      {/* 管理者却下モーダル */}
      <Modal
        isOpen={rejectingRequestId !== null}
        onClose={() => {
          setRejectingRequestId(null);
          setRejectionReason('');
        }}
        onConfirm={handleConfirmReject}
        title="申請の却下"
        confirmLabel="却下する"
      >
        <div className="edit-record-form">
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            この申請を却下します。却下の理由を入力してください（従業員に通知されます）。
          </p>
          <div className="form-group">
            <label className="form-label">却下理由</label>
            <textarea
              className="input-field"
              rows={3}
              placeholder="例: 打刻修正の時間が実働と異なるため再申請してください"
              value={rejectionReason}
              onChange={e => setRejectionReason(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      {/* 管理者直接編集モーダル */}
      <Modal
        isOpen={adminEditingRecord !== null}
        onClose={() => setAdminEditingRecord(null)}
        onConfirm={handleSaveAdminEdit}
        title={`勤怠記録の修正 (${adminEditingRecord?.date})`}
        confirmLabel="保存する"
      >
        <div className="edit-record-form">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">出勤時刻</label>
              <input
                type="time"
                className="input-field"
                value={adminEditForm.clockIn}
                onChange={e => setAdminEditForm({ ...adminEditForm, clockIn: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">退勤時刻</label>
              <input
                type="time"
                className="input-field"
                value={adminEditForm.clockOut}
                onChange={e => setAdminEditForm({ ...adminEditForm, clockOut: e.target.value })}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">備考・メモ</label>
            <input
              type="text"
              className="input-field"
              value={adminEditForm.memo}
              onChange={e => setAdminEditForm({ ...adminEditForm, memo: e.target.value })}
              placeholder="例: 管理者による代理修正"
            />
          </div>
        </div>
      </Modal>

      {/* 管理者直接追加モーダル */}
      <Modal
        isOpen={adminAddTargetUserId !== null}
        onClose={() => setAdminAddTargetUserId(null)}
        onConfirm={handleSaveAdminAdd}
        title="勤怠記録の追加登録"
        confirmLabel="追加する"
      >
        <div className="edit-record-form">
          <div className="form-group">
            <label className="form-label">日付</label>
            <input
              type="date"
              className="input-field"
              value={adminAddForm.date}
              onChange={e => setAdminAddForm({ ...adminAddForm, date: e.target.value })}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">出勤時刻</label>
              <input
                type="time"
                className="input-field"
                value={adminAddForm.clockIn}
                onChange={e => setAdminAddForm({ ...adminAddForm, clockIn: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">退勤時刻</label>
              <input
                type="time"
                className="input-field"
                value={adminAddForm.clockOut}
                onChange={e => setAdminAddForm({ ...adminAddForm, clockOut: e.target.value })}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">備考・メモ</label>
            <input
              type="text"
              className="input-field"
              value={adminAddForm.memo}
              onChange={e => setAdminAddForm({ ...adminAddForm, memo: e.target.value })}
              placeholder="例: 打刻漏れ代理登録"
            />
          </div>
        </div>
      </Modal>
      {/* 8:30前 早出理由入力モーダル */}
      <Modal
        isOpen={showEarlyInModal}
        onClose={() => {
          setShowEarlyInModal(false);
          setEarlyInReason('');
        }}
        onConfirm={handleConfirmEarlyIn}
        title="早出理由の入力"
        confirmLabel={isSubmitting ? '打刻中...' : '理由を登録して出勤'}
      >
        <div className="edit-record-form">
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            8:30前の出勤には理由の入力が必須です。早出の理由を入力してください（8:30〜9:00の出勤はコメント不要です）。
          </p>
          <div className="form-group">
            <label className="form-label">早出理由 <span style={{ color: 'var(--danger-color)' }}>*</span></label>
            <textarea
              className="input-field"
              rows={3}
              placeholder="例: 早朝準備のため、朝礼準備のため など"
              value={earlyInReason}
              onChange={e => setEarlyInReason(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      {/* 18:00前 早退申請モーダル（理由必須・管理者承認が必要） */}
      <Modal
        isOpen={showEarlyLeaveModal}
        onClose={() => {
          setShowEarlyLeaveModal(false);
          setEarlyLeaveReason('');
        }}
        onConfirm={handleConfirmEarlyLeave}
        title="早退申請の入力"
        confirmLabel={isSubmitting ? '申請中...' : '早退申請して退勤'}
      >
        <div className="edit-record-form">
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            18:00前の退勤（早退）には理由の入力と管理者の承認が必要です。早退理由を入力してください。
          </p>
          <div className="form-group">
            <label className="form-label">早退理由 <span style={{ color: 'var(--danger-color)' }}>*</span></label>
            <textarea
              className="input-field"
              rows={3}
              placeholder="例: 通院のため、体調不良のため、私用のため など"
              value={earlyLeaveReason}
              onChange={e => setEarlyLeaveReason(e.target.value)}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};
