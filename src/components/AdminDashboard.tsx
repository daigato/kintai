import React, { useState, useEffect, useCallback } from 'react';
import { 
  LogOut, 
  Users, 
  Clock, 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  Edit2, 
  Trash2, 
  Check, 
  X, 
  Download, 
  TrendingUp, 
  FileText,
  Hourglass,
  CheckCircle2,
  XCircle,
  Send,
  CalendarDays,
  MessageSquare
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { apiStore } from '../apiStore';
import { downloadCsv, downloadUserMonthlyCsv } from '../csvExport';
import { Modal } from './Modal';
import { MonthNavigator } from './MonthNavigator';
import { CalendarView } from './CalendarView';
import { CompanyCalendarView } from './CompanyCalendarView';
import type { User, AttendanceRecord, EmployeeStat, AttendanceRequest, CompensatoryBalance, LineGroup, UserGroup } from '../types';

interface Props {
  user: User;
  onLogout: () => void;
}

type AdminTab = 'attendance' | 'requests' | 'companyCalendar';

export const AdminDashboard: React.FC<Props> = ({ user, onLogout }) => {
  const [adminTab, setAdminTab] = useState<AdminTab>('attendance');
  const [stats, setStats] = useState<EmployeeStat[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [allRecords, setAllRecords] = useState<AttendanceRecord[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<User | null>(null);
  const [employeeRecords, setEmployeeRecords] = useState<AttendanceRecord[]>([]);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ clockIn: '', clockOut: '', memo: '' });
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ date: '', clockIn: '', clockOut: '', memo: '' });
  const [toast, setToast] = useState<string | null>(null);
  const [viewMonth, setViewMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');
  const [searchQuery, setSearchQuery] = useState('');

  // 振替残高 & 申請管理
  const [balances, setBalances] = useState<Record<string, CompensatoryBalance>>({});
  const [allRequests, setAllRequests] = useState<AttendanceRequest[]>([]);
  const [requestFilter, setRequestFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [rejectingRequestId, setRejectingRequestId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isProcessingRequest, setIsProcessingRequest] = useState(false);

  // 所属グループ管理
  const [groups, setGroups] = useState<LineGroup[]>([]);
  const [userGroups, setUserGroups] = useState<UserGroup[]>([]);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupTargetUser, setGroupTargetUser] = useState<User | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [isSavingGroups, setIsSavingGroups] = useState(false);

  // モーダル
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [showEditNameModal, setShowEditNameModal] = useState(false);
  const [editTargetUser, setEditTargetUser] = useState<User | null>(null);
  const [newUserName, setNewUserName] = useState('');

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const refreshEmployeeRecords = useCallback((empId: string, records: AttendanceRecord[]) => {
    const empRecords = records
      .filter(r => r.userId === empId)
      .sort((a, b) => b.date.localeCompare(a.date));
    setEmployeeRecords(empRecords);
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const [users, records, compBalances, reqs, lineGroups, uGroups] = await Promise.all([
        apiStore.getUsers(),
        apiStore.getAllMonthlyRecords(viewMonth),
        apiStore.getAllCompensatoryBalances(),
        apiStore.getRequests(),
        apiStore.getGroups().catch(() => []),
        apiStore.getUserGroups().catch(() => [])
      ]);

      setAllUsers(users);
      setAllRecords(records);
      setBalances(compBalances);
      setAllRequests(reqs);
      setGroups(lineGroups);
      setUserGroups(uGroups);

      const employees = users.filter(u => u.role === 'employee');
      const newStats = employees.map(emp => {
        const empRecords = records.filter(r => r.userId === emp.id);
        const st = apiStore.calculateStats(empRecords, 0);
        const bal = compBalances[emp.id] || { grantedMinutes: 0, usedMinutes: 0, remainingMinutes: 0, displayTime: '0分' };
        return {
          user: emp,
          ...st,
          availableHolidays: 0,
          compensatoryMinutes: bal.remainingMinutes,
          compensatoryDisplay: bal.displayTime
        };
      });
      setStats(newStats);

      if (selectedEmployee) {
        refreshEmployeeRecords(selectedEmployee.id, records);
      }
    } catch (e) {
      console.error(e);
      showToast('データ取得に失敗しました');
    }
  }, [viewMonth, selectedEmployee, refreshEmployeeRecords, showToast]);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  useEffect(() => {
    // 過去データの土日祝フラグを自動同期
    apiStore.migrateHolidayWork().catch(() => {});
  }, []);

  const handleSelectEmployee = (emp: User) => {
    setSelectedEmployee(emp);
    refreshEmployeeRecords(emp.id, allRecords);
  };

  const handleDelete = async () => {
    if (!deleteTargetId) return;
    try {
      await apiStore.deleteRecord(deleteTargetId);
      showToast('記録を削除しました');
      setDeleteTargetId(null);
      refreshStats();
    } catch {
      showToast('削除に失敗しました');
    }
  };

  const handleOpenEditName = (targetUser: User, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditTargetUser(targetUser);
    setNewUserName(targetUser.name);
    setShowEditNameModal(true);
  };

  const handleSaveEditName = async () => {
    if (!editTargetUser || !newUserName.trim()) {
      showToast('氏名を入力してください');
      return;
    }
    try {
      await apiStore.updateUserName(editTargetUser.id, newUserName.trim());
      showToast('従業員名を更新しました');
      setShowEditNameModal(false);
      if (selectedEmployee && selectedEmployee.id === editTargetUser.id) {
        setSelectedEmployee({ ...selectedEmployee, name: newUserName.trim() });
      }
      refreshStats();
    } catch {
      showToast('名前の更新に失敗しました');
    }
  };

  const handleOpenGroupModal = (emp: User, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setGroupTargetUser(emp);
    const userGids = userGroups.filter(ug => ug.user_id === emp.id).map(ug => ug.group_id);
    setSelectedGroupIds(userGids);
    setShowGroupModal(true);
  };

  const handleToggleGroupSelect = (groupId: string) => {
    setSelectedGroupIds(prev => 
      prev.includes(groupId) ? prev.filter(id => id !== groupId) : [...prev, groupId]
    );
  };

  const handleSaveUserGroups = async () => {
    if (!groupTargetUser) return;
    setIsSavingGroups(true);
    try {
      await apiStore.updateUserGroups(groupTargetUser.id, selectedGroupIds);
      showToast(`${groupTargetUser.name}さんの所属グループを更新しました`);
      setShowGroupModal(false);
      const updatedUserGroups = await apiStore.getUserGroups();
      setUserGroups(updatedUserGroups);
    } catch {
      showToast('所属グループの更新に失敗しました');
    } finally {
      setIsSavingGroups(false);
    }
  };

  const handleAddClick = (dateStr?: string) => {
    setAddForm({ date: dateStr || format(new Date(), 'yyyy-MM-dd'), clockIn: '', clockOut: '', memo: '' });
    setShowAddModal(true);
  };

  const handleDateClick = (dateStr: string, record: AttendanceRecord | undefined) => {
    if (record) {
      handleEditClick(record);
    } else {
      handleAddClick(dateStr);
    }
  };

  const handleSaveAdd = async () => {
    if (!addForm.date) {
      showToast('日付を入力してください');
      return;
    }
    const toLocalIso = (dateStr: string, timeStr: string): string | null => {
      if (!timeStr) return null;
      const [h, m] = timeStr.split(':');
      const dt = new Date(`${dateStr}T${h}:${m}:00`);
      return dt.toISOString();
    };

    if (selectedEmployee) {
      try {
        await apiStore.addRecord(selectedEmployee.id, addForm.date, {
          clockIn: toLocalIso(addForm.date, addForm.clockIn) || undefined,
          clockOut: toLocalIso(addForm.date, addForm.clockOut) || undefined,
          memo: addForm.memo,
        });
        showToast('記録を追加しました');
        setShowAddModal(false);
        refreshStats();
      } catch {
        showToast('記録の追加に失敗しました');
      }
    }
  };

  const handleEditClick = (record: AttendanceRecord) => {
    setEditingRecordId(record.id);
    setEditForm({
      clockIn: record.clockIn ? format(parseISO(record.clockIn), 'HH:mm') : '',
      clockOut: record.clockOut ? format(parseISO(record.clockOut), 'HH:mm') : '',
      memo: record.memo || '',
    });
  };

  const handleSaveEdit = async (record: AttendanceRecord) => {
    const toLocalIso = (dateStr: string, timeStr: string): string | null => {
      if (!timeStr) return null;
      const [h, m] = timeStr.split(':');
      const dt = new Date(`${dateStr}T${h}:${m}:00`);
      return dt.toISOString();
    };

    try {
      await apiStore.updateRecord(record.id, {
        clockIn: toLocalIso(record.date, editForm.clockIn) || undefined,
        clockOut: toLocalIso(record.date, editForm.clockOut) || undefined,
        memo: editForm.memo,
      });

      showToast('記録を修正しました');
      setEditingRecordId(null);
      refreshStats();
    } catch {
      showToast('記録の修正に失敗しました');
    }
  };

  const handleExportCsv = () => {
    if (selectedEmployee) {
      downloadUserMonthlyCsv(
        viewMonth, 
        selectedEmployee, 
        employeeRecords, 
        balances[selectedEmployee.id]?.displayTime
      );
      showToast(`${selectedEmployee.name}さんの勤怠サマリーをダウンロードしました`);
    } else {
      downloadCsv(viewMonth, allUsers, allRecords);
      showToast('全員の勤怠データをダウンロードしました');
    }
  };

  // 申請の承認処理
  const handleApproveRequest = async (requestId: string) => {
    setIsProcessingRequest(true);
    try {
      await apiStore.approveRequest(requestId);
      showToast('申請を承認しました');
      await refreshStats();
    } catch {
      showToast('承認処理に失敗しました');
    } finally {
      setIsProcessingRequest(false);
    }
  };

  // 申請の却下モーダルを開く
  const handleOpenRejectModal = (requestId: string) => {
    setRejectingRequestId(requestId);
    setRejectionReason('');
  };

  // 申請の却下実行
  const handleConfirmReject = async () => {
    if (!rejectingRequestId) return;
    setIsProcessingRequest(true);
    try {
      await apiStore.rejectRequest(rejectingRequestId, rejectionReason.trim());
      showToast('申請を却下しました');
      setRejectingRequestId(null);
      await refreshStats();
    } catch {
      showToast('却下処理に失敗しました');
    } finally {
      setIsProcessingRequest(false);
    }
  };

  // 検索フィルタ
  const filteredStats = searchQuery
    ? stats.filter(s => s.user.name.includes(searchQuery))
    : stats;

  // 申請フィルタ
  const filteredRequests = allRequests.filter(r => {
    if (requestFilter === 'all') return true;
    return r.status === requestFilter;
  });

  const pendingRequestsCount = allRequests.filter(r => r.status === 'pending').length;

  // 全体サマリー
  const totalHours = stats.reduce((sum, s) => sum + s.monthlyHours, 0);
  const totalOvertime = stats.reduce((sum, s) => sum + s.overtimeHours, 0);

  const formatIsoToTime = (isoString?: string | null) => {
    if (!isoString) return '--:--';
    try {
      return format(parseISO(isoString), 'HH:mm');
    } catch {
      return '--:--';
    }
  };

  return (
    <div className="dashboard-container animate-fade-in">
      {/* Toast */}
      {toast && (
        <div className="toast animate-fade-in">
          {toast}
        </div>
      )}

      {/* Header */}
      <header className="dashboard-header glass-card">
        <div>
          <h2 className="header-name">{user.name}</h2>
          <p className="header-role">管理者ダッシュボード</p>
        </div>
        <div className="flex items-center gap-2">
          {/* 管理者タブナビゲーション */}
          <div className="flex gap-1" style={{ background: '#f1f5f9', padding: '4px', borderRadius: 'var(--radius-md)' }}>
            <button
              className={`btn btn-sm ${adminTab === 'attendance' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setAdminTab('attendance'); setSelectedEmployee(null); }}
              style={{ padding: '6px 14px' }}
            >
              <Users size={15} />
              <span>勤怠一覧</span>
            </button>
            <button
              className={`btn btn-sm ${adminTab === 'requests' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setAdminTab('requests'); setSelectedEmployee(null); }}
              style={{ padding: '6px 14px', position: 'relative' }}
            >
              <FileText size={15} />
              <span>申請管理</span>
              {pendingRequestsCount > 0 && (
                <span className="badge-count">
                  {pendingRequestsCount}
                </span>
              )}
            </button>
            <button
              className={`btn btn-sm ${adminTab === 'companyCalendar' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setAdminTab('companyCalendar'); setSelectedEmployee(null); }}
              style={{ padding: '6px 14px' }}
            >
              <CalendarDays size={15} />
              <span>社内カレンダー</span>
            </button>
          </div>
          <button onClick={() => setShowLogoutModal(true)} className="btn btn-secondary icon-btn" aria-label="ログアウト">
            <LogOut size={20} />
          </button>
        </div>
      </header>

      {/* ================= タブ 1: 勤怠管理 ================= */}
      {adminTab === 'attendance' && (
        <>
          {/* 月ナビゲーション */}
          <MonthNavigator currentMonth={viewMonth} onChange={setViewMonth} />

          {!selectedEmployee ? (
            <>
              {/* 全体サマリーカード */}
              <div className="admin-summary-grid delay-100">
                <div className="stat-card glass-card">
                  <Users className="stat-icon" size={24} />
                  <p className="stat-label">従業員数</p>
                  <p className="stat-value">{stats.length}<span className="stat-unit">名</span></p>
                </div>
                <div className="stat-card glass-card">
                  <Clock className="stat-icon" size={24} />
                  <p className="stat-label">総労働時間</p>
                  <p className="stat-value">{totalHours.toFixed(0)}<span className="stat-unit">h</span></p>
                </div>
                <div className="stat-card glass-card">
                  <TrendingUp className="stat-icon stat-icon-warning" size={24} />
                  <p className="stat-label">総残業時間</p>
                  <p className="stat-value">{totalOvertime.toFixed(1)}<span className="stat-unit">h</span></p>
                </div>
              </div>

              {/* 従業員一覧 */}
              <section className="glass-card delay-100">
                <div className="section-header">
                  <h3 className="section-title">
                    <Users size={20} />
                    従業員 勤怠・振替休暇状況
                  </h3>
                  <button onClick={handleExportCsv} className="btn btn-secondary btn-export">
                    <Download size={16} />
                    CSV出力
                  </button>
                </div>

                {/* 検索バー */}
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="従業員名で検索..."
                  className="search-input"
                />

                <div className="employee-list">
                  {filteredStats.map(stat => (
                    <div key={stat.user.id} className="employee-card">
                      <div className="employee-card-header">
                        <div className="flex items-center gap-2">
                          <h4 className="employee-name">{stat.user.name}</h4>
                          <button
                            onClick={(e) => handleOpenEditName(stat.user, e)}
                            className="action-btn action-edit"
                            title="氏名を編集"
                            aria-label="氏名を編集"
                          >
                            <Edit2 size={14} />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              const userRecs = allRecords.filter(r => r.userId === stat.user.id);
                              downloadUserMonthlyCsv(viewMonth, stat.user, userRecs, stat.compensatoryDisplay);
                              showToast(`${stat.user.name}さんの勤怠サマリーをダウンロードしました`);
                            }} 
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                            title="出勤サマリー表をCSVダウンロード"
                          >
                            <Download size={12} />
                            <span>CSV</span>
                          </button>
                          <button onClick={() => handleSelectEmployee(stat.user)} className="btn btn-secondary btn-detail">
                            詳細を見る
                          </button>
                        </div>
                      </div>
                      {/* 所属グループ情報 */}
                      {(() => {
                        const userGids = userGroups.filter(ug => ug.user_id === stat.user.id).map(ug => ug.group_id);
                        const userGroupList = groups.filter(g => userGids.includes(g.id));
                        return (
                          <div style={{ margin: '4px 0 8px 0' }}>
                            <button
                              onClick={(e) => handleOpenGroupModal(stat.user, e)}
                              className="btn btn-secondary btn-sm"
                              style={{ padding: '3px 8px', fontSize: '0.75rem', height: 'auto', display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#f8fafc', border: '1px solid #e2e8f0' }}
                              title="所属LINEグループを設定"
                            >
                              <MessageSquare size={12} style={{ color: '#0284c7' }} />
                              <span>LINE通知先: {userGroupList.length > 0 ? userGroupList.map(g => g.name || 'グループ').join(' / ') : '未設定（通知なし）'}</span>
                            </button>
                          </div>
                        );
                      })()}
                      <div className="employee-stats-grid">
                        <div className="employee-stat">
                          <Clock size={16} className="stat-icon-small" />
                          <span className="employee-stat-label">労働</span>
                          <span className="employee-stat-value">{stat.monthlyHours.toFixed(1)}h</span>
                        </div>
                        <div className="employee-stat">
                          <TrendingUp size={16} className="stat-icon-small stat-icon-warning" />
                          <span className="employee-stat-label">残業</span>
                          <span className="employee-stat-value">{stat.overtimeHours.toFixed(1)}h</span>
                        </div>
                        <div className="employee-stat" style={{ background: '#fff7ed', borderRadius: '8px', padding: '4px 8px' }}>
                          <CalendarIcon size={16} className="stat-icon-small text-orange" />
                          <span className="employee-stat-label">振替残</span>
                          <span className="employee-stat-value font-bold text-orange">{stat.compensatoryDisplay || '0分'}</span>
                        </div>
                        <div className="employee-stat">
                          <Users size={16} className="stat-icon-small" />
                          <span className="employee-stat-label">出勤日</span>
                          <span className="employee-stat-value">{stat.workDays}日</span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {filteredStats.length === 0 && (
                    <p className="empty-state">該当する従業員がいません</p>
                  )}
                </div>
              </section>
            </>
          ) : (
            /* 従業員詳細ビュー */
            <section className="glass-card delay-100">
              <div className="detail-header">
                <button onClick={() => setSelectedEmployee(null)} className="back-btn">
                  <ChevronLeft size={24} />
                </button>
                <div className="flex items-center gap-2">
                  <h3 className="detail-title">{selectedEmployee.name} の打刻履歴</h3>
                  <button
                    onClick={(e) => handleOpenEditName(selectedEmployee, e)}
                    className="action-btn action-edit"
                    title="氏名を編集"
                    aria-label="氏名を編集"
                  >
                    <Edit2 size={16} />
                  </button>
                  {(() => {
                    const userGids = userGroups.filter(ug => ug.user_id === selectedEmployee.id).map(ug => ug.group_id);
                    const userGroupList = groups.filter(g => userGids.includes(g.id));
                    return (
                      <button
                        onClick={() => handleOpenGroupModal(selectedEmployee)}
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '3px 8px', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: '6px', height: 'auto' }}
                        title="所属LINEグループを設定"
                      >
                        <MessageSquare size={12} style={{ color: '#0284c7' }} />
                        <span>通知先: {userGroupList.length > 0 ? userGroupList.map(g => g.name || 'グループ').join(' / ') : '未設定'}</span>
                      </button>
                    );
                  })()}
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <div style={{ fontSize: '0.875rem', background: '#fff7ed', border: '1px solid #fed7aa', padding: '4px 10px', borderRadius: '6px', fontWeight: 600, color: 'var(--primary-color-hover)' }}>
                    振替休暇残高: {balances[selectedEmployee.id]?.displayTime || '0分'}
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button 
                      className={`btn btn-secondary ${viewMode === 'calendar' ? 'active' : ''}`}
                      onClick={() => setViewMode('calendar')}
                      style={viewMode === 'calendar' ? { backgroundColor: 'var(--primary-color)', color: 'white', borderColor: 'var(--primary-color)' } : {}}
                    >カレンダー</button>
                    <button 
                      className={`btn btn-secondary ${viewMode === 'list' ? 'active' : ''}`}
                      onClick={() => setViewMode('list')}
                      style={viewMode === 'list' ? { backgroundColor: 'var(--primary-color)', color: 'white', borderColor: 'var(--primary-color)' } : {}}
                    >リスト</button>
                  </div>
                  <button onClick={() => handleAddClick()} className="btn btn-primary">
                    ＋ 打刻追加
                  </button>
                  <button 
                    onClick={async () => {
                      try {
                        await apiStore.sendSummaryToLine(selectedEmployee.id, viewMonth);
                        showToast(`LINEに${selectedEmployee.name}さんの勤怠サマリーを送信しました！`);
                      } catch {
                        showToast('LINE送信に失敗しました');
                      }
                    }} 
                    className="btn btn-sm"
                    style={{ background: '#06c755', color: '#ffffff', border: 'none', display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px' }}
                    title="LINEトークにサマリーを送信"
                  >
                    <Send size={14} />
                    <span>LINEに送信</span>
                  </button>
                  <button onClick={handleExportCsv} className="btn btn-secondary btn-export">
                    <Download size={16} />
                    CSV
                  </button>
                </div>
              </div>

              {viewMode === 'calendar' ? (
                <CalendarView currentMonth={viewMonth} records={employeeRecords} onDateClick={handleDateClick} />
              ) : (
                <div className="records-list">
                  {employeeRecords.length === 0 ? (
                    <p className="empty-state">この月の打刻履歴がありません</p>
                  ) : (
                    employeeRecords.map(record => (
                      <div key={record.id} className="record-card">
                        <div className="record-card-header">
                          <div className="record-date-area">
                            <span className="record-date">{record.date}</span>
                            <span className="record-weekday">
                              {format(parseISO(record.date), '（E）', { locale: ja })}
                            </span>
                            {record.isHolidayWork && <span className="badge badge-holiday">休日出勤</span>}
                            {record.clockIn === null && record.clockOut === null && <span className="badge badge-dayoff">休暇</span>}
                          </div>
                          {editingRecordId !== record.id && (
                            <div className="record-actions">
                              <button onClick={() => handleEditClick(record)} className="action-btn action-edit" aria-label="編集">
                                <Edit2 size={16} />
                              </button>
                              <button onClick={() => setDeleteTargetId(record.id)} className="action-btn action-delete" aria-label="削除">
                                <Trash2 size={16} />
                              </button>
                            </div>
                          )}
                        </div>

                        {editingRecordId === record.id ? (
                          <div className="edit-form">
                            <div className="edit-row">
                              <label>出勤</label>
                              <input
                                type="time"
                                value={editForm.clockIn}
                                onChange={e => setEditForm({ ...editForm, clockIn: e.target.value })}
                                className="edit-time-input"
                              />
                              <span className="time-separator">〜</span>
                              <label>退勤</label>
                              <input
                                type="time"
                                value={editForm.clockOut}
                                onChange={e => setEditForm({ ...editForm, clockOut: e.target.value })}
                                className="edit-time-input"
                              />
                            </div>
                            <div className="edit-row">
                              <label>備考</label>
                              <input
                                type="text"
                                value={editForm.memo}
                                onChange={e => setEditForm({ ...editForm, memo: e.target.value })}
                                className="edit-memo-input"
                                placeholder="修正理由・備考"
                              />
                            </div>
                            <div className="edit-actions">
                              <button onClick={() => handleSaveEdit(record)} className="btn btn-primary btn-sm">
                                <Check size={16} /> 保存
                              </button>
                              <button onClick={() => setEditingRecordId(null)} className="btn btn-secondary btn-sm">
                                <X size={16} /> キャンセル
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="record-details">
                            <div className="record-times">
                              <span>出勤: {formatIsoToTime(record.clockIn)}</span>
                              <span className="time-separator">|</span>
                              <span>退勤: {formatIsoToTime(record.clockOut)}</span>
                              <span className="time-separator">|</span>
                              <span>実働: {record.clockIn && record.clockOut ? `${(apiStore.calculateRecordMinutes(record) / 60).toFixed(1)}h` : '--'}</span>
                            </div>
                            {record.memo && <p className="record-memo">{record.memo}</p>}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {/* ================= タブ 2: 申請承認管理 ================= */}
      {adminTab === 'requests' && (
        <section className="glass-card delay-100">
          <div className="section-header">
            <h3 className="section-title">
              <FileText size={20} />
              申請承認管理
            </h3>
            <div className="flex gap-1" style={{ background: '#f8fafc', padding: '3px', borderRadius: '8px' }}>
              <button
                className={`btn btn-sm ${requestFilter === 'pending' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setRequestFilter('pending')}
              >
                未処理 ({pendingRequestsCount})
              </button>
              <button
                className={`btn btn-sm ${requestFilter === 'approved' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setRequestFilter('approved')}
              >
                承認済
              </button>
              <button
                className={`btn btn-sm ${requestFilter === 'rejected' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setRequestFilter('rejected')}
              >
                却下
              </button>
              <button
                className={`btn btn-sm ${requestFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setRequestFilter('all')}
              >
                すべて ({allRequests.length})
              </button>
            </div>
          </div>

          <div className="requests-container" style={{ marginTop: '16px' }}>
            {filteredRequests.length === 0 ? (
              <p className="empty-state">該当する申請はありません</p>
            ) : (
              <div className="requests-list">
                {filteredRequests.map(req => {
                  const isPending = req.status === 'pending';
                  const isApproved = req.status === 'approved';
                  const isRejected = req.status === 'rejected';

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
                    <div key={req.id} className="request-card" style={{ borderLeft: isPending ? '4px solid #f59e0b' : isApproved ? '4px solid #10b981' : '4px solid #ef4444' }}>
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span style={{ fontWeight: 800, fontSize: '1.0625rem' }}>{req.userName}</span>
                            <span className="badge" style={{ background: '#f1f5f9', color: '#475569' }}>{typeLabel}</span>
                          </div>
                          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            対象日: <strong>{req.date}</strong>（{format(parseISO(`${req.date}T00:00:00`), 'E', { locale: ja })}）
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {isPending && <span className="status-tag pending"><Hourglass size={12} /> 未処理</span>}
                          {isApproved && <span className="status-tag approved"><CheckCircle2 size={12} /> 承認済</span>}
                          {isRejected && <span className="status-tag rejected"><XCircle size={12} /> 却下</span>}
                        </div>
                      </div>

                      {req.type === 'clock_correction' && (
                        <div style={{ fontSize: '0.875rem', background: '#f8fafc', padding: '8px 12px', borderRadius: '6px', marginBottom: '8px' }}>
                          修正希望: 出勤 <strong>{formatIsoToTime(req.clockIn)}</strong> 〜 退勤 <strong>{formatIsoToTime(req.clockOut)}</strong>
                        </div>
                      )}

                      <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: '8px' }}>
                        <strong>申請理由:</strong> {req.reason}
                      </div>

                      {isRejected && req.rejectionReason && (
                        <div style={{ fontSize: '0.875rem', color: 'var(--danger-color)', background: '#fef2f2', padding: '6px 10px', borderRadius: '6px', marginBottom: '8px' }}>
                          <strong>却下理由:</strong> {req.rejectionReason}
                        </div>
                      )}

                      <div className="flex justify-between items-center pt-2" style={{ borderTop: '1px solid #f1f5f9' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          申請日時: {format(parseISO(req.createdAt), 'yyyy/MM/dd HH:mm')}
                        </span>

                        {isPending && (
                          <div className="flex gap-2">
                            <button
                              className="btn btn-primary btn-sm"
                              style={{ backgroundColor: 'var(--success-color)', borderColor: 'var(--success-color)' }}
                              onClick={() => handleApproveRequest(req.id)}
                              disabled={isProcessingRequest}
                            >
                              <Check size={14} /> 承認する
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              style={{ color: 'var(--danger-color)' }}
                              onClick={() => handleOpenRejectModal(req.id)}
                              disabled={isProcessingRequest}
                            >
                              <X size={14} /> 却下
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ================= タブ 3: 社内カレンダー ================= */}
      {adminTab === 'companyCalendar' && (
        <section className="animate-fade-in" style={{ marginTop: 'var(--space-md)' }}>
          <CompanyCalendarView currentUser={user} isAdmin={true} />
        </section>
      )}

      {/* 却下理由モーダル */}
      <Modal
        isOpen={!!rejectingRequestId}
        onClose={() => setRejectingRequestId(null)}
        onConfirm={handleConfirmReject}
        title="申請の却下"
        confirmLabel="却下する"
      >
        <div className="edit-record-form">
          <div className="form-group">
            <label className="form-label">却下理由（申請者にLINEで通知されます）</label>
            <textarea
              className="input-field"
              rows={3}
              placeholder="例: 打刻時間の確認が取れないため、業務都合のためなど"
              value={rejectionReason}
              onChange={e => setRejectionReason(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      {/* 打刻追加モーダル */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onConfirm={handleSaveAdd}
        title={`新規打刻追加 (${selectedEmployee?.name})`}
        confirmLabel="追加する"
      >
        <div className="edit-record-form">
          <div className="form-group">
            <label className="form-label">日付</label>
            <input
              type="date"
              className="input-field"
              value={addForm.date}
              onChange={e => setAddForm({ ...addForm, date: e.target.value })}
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">出勤時刻</label>
              <input
                type="time"
                className="input-field"
                value={addForm.clockIn}
                onChange={e => setAddForm({ ...addForm, clockIn: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">退勤時刻</label>
              <input
                type="time"
                className="input-field"
                value={addForm.clockOut}
                onChange={e => setAddForm({ ...addForm, clockOut: e.target.value })}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">備考</label>
            <input
              type="text"
              className="input-field"
              placeholder="備考を入力"
              value={addForm.memo}
              onChange={e => setAddForm({ ...addForm, memo: e.target.value })}
            />
          </div>
        </div>
      </Modal>

      {/* 氏名変更モーダル */}
      <Modal
        isOpen={showEditNameModal}
        onClose={() => setShowEditNameModal(false)}
        onConfirm={handleSaveEditName}
        title="従業員名の変更"
        confirmLabel="更新する"
      >
        <div className="edit-record-form">
          <div className="form-group">
            <label className="form-label">氏名</label>
            <input
              type="text"
              className="input-field"
              value={newUserName}
              onChange={e => setNewUserName(e.target.value)}
              placeholder="例: 従業員名"
            />
          </div>
        </div>
      </Modal>

      {/* 所属グループ設定モーダル */}
      <Modal
        isOpen={showGroupModal}
        onClose={() => setShowGroupModal(false)}
        onConfirm={handleSaveUserGroups}
        title={`所属LINEグループの設定 (${groupTargetUser?.name})`}
        confirmLabel={isSavingGroups ? '保存中...' : '保存する'}
      >
        <div className="edit-record-form">
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            出勤・退勤の通知を送るLINEグループを選択してください。<br />
            チェックを入れたグループにのみ出勤・退勤通知が送信されます。
          </p>
          {groups.length === 0 ? (
            <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '8px', fontSize: '0.875rem', color: '#64748b', textAlign: 'center' }}>
              現在登録されているLINEグループはありません。<br />
              LINEグループにBotを追加し、グループ内で誰かが発言すると自動的に登録されます。
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {groups.map(group => {
                const isChecked = selectedGroupIds.includes(group.id);
                return (
                  <label
                    key={group.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      background: isChecked ? 'rgba(59, 130, 246, 0.08)' : '#f8fafc',
                      border: isChecked ? '1px solid #3b82f6' : '1px solid #e2e8f0',
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleGroupSelect(group.id)}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        {group.name || '名称未設定グループ'}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        ID: {group.id}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
          <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '14px' }}>
            ※メンバーがグループ内で発言（打刻や日常会話）した場合も自動的に所属が記録されます。
          </p>
        </div>
      </Modal>

      {/* 削除確認モーダル */}
      <Modal
        isOpen={deleteTargetId !== null}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={handleDelete}
        title="記録の削除"
        confirmLabel="削除する"
      >
        <p>この日の打刻記録を完全に削除してもよろしいですか？</p>
      </Modal>

      {/* ログアウトモーダル */}
      <Modal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={onLogout}
        title="ログアウト"
        confirmLabel="ログアウト"
      >
        <p>ログアウトしてもよろしいですか？</p>
      </Modal>
    </div>
  );
};
