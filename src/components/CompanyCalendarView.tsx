import React, { useState, useEffect, useCallback } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, parseISO, isSameDay } from 'date-fns';
import { Calendar as CalendarIcon, Plus, Trash2, Clock, AlertCircle } from 'lucide-react';
import { apiStore } from '../apiStore';
import { getJapaneseHolidayName } from '../holidays';
import { MonthNavigator } from './MonthNavigator';
import type { User, CompanyScheduleResponse, CompanyLeaveItem } from '../types';

interface CompanyCalendarViewProps {
  currentUser?: User | null;
  isAdmin?: boolean;
}

export const CompanyCalendarView: React.FC<CompanyCalendarViewProps> = ({ currentUser, isAdmin = false }) => {
  const [currentMonth, setCurrentMonth] = useState<string>(() => format(new Date(), 'yyyy-MM'));
  const [schedule, setSchedule] = useState<CompanyScheduleResponse>({ events: [], leaves: [] });
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedDate, setSelectedDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));
  const [newEventTitle, setNewEventTitle] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchSchedule = useCallback(async (month: string) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await apiStore.getCompanySchedule(month);
      setSchedule(data);
    } catch (e: any) {
      console.error(e);
      setErrorMsg('社内スケジュールの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSchedule(currentMonth);
  }, [currentMonth, fetchSchedule]);

  const handleCellClick = (dateStr: string) => {
    setSelectedDate(dateStr);
    setNewEventTitle('');
  };

  const handleAddEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDate || !newEventTitle.trim()) return;

    setSubmitting(true);
    try {
      await apiStore.addCalendarEvent({
        date: selectedDate,
        title: newEventTitle.trim(),
        userId: currentUser?.id,
        userName: currentUser?.name || (isAdmin ? '管理者' : '社員'),
      });
      setNewEventTitle('');
      await fetchSchedule(currentMonth);
    } catch (err: any) {
      alert(err?.message || 'イベントの追加に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteEvent = async (id: string) => {
    if (!confirm('このイベントメモを削除しますか？')) return;
    try {
      await apiStore.deleteCalendarEvent(id);
      await fetchSchedule(currentMonth);
    } catch (err: any) {
      alert(err?.message || 'イベントの削除に失敗しました');
    }
  };

  // カレンダー日付グリッド計算
  const monthDate = parseISO(`${currentMonth}-01`);
  const start = startOfMonth(monthDate);
  const end = endOfMonth(monthDate);
  const days = eachDayOfInterval({ start, end });
  const weekDays = ['日', '月', '火', '水', '木', '金', '土'];
  const startDayOfWeek = start.getDay();
  const emptyDays = Array.from({ length: startDayOfWeek }, (_, i) => i);

  // 選択日のアイテム
  const selectedEvents = selectedDate ? schedule.events.filter(e => e.date === selectedDate) : [];
  const selectedLeaves = selectedDate ? schedule.leaves.filter(l => l.date === selectedDate) : [];

  const getLeaveBadgeLabel = (item: CompanyLeaveItem): string => {
    if (item.substituteAction === 'early_leave') {
      return `早退 ${item.substituteMinutes || ''}分`;
    }
    if (item.substituteAction === 'late_arrive') {
      return `遅出 ${item.substituteMinutes || ''}分`;
    }
    if (item.substituteAction === 'full_off') {
      return '振休全休';
    }
    if (item.leaveType === 'paid') return '有休';
    if (item.leaveType === 'substitute') return '振休';
    if (item.leaveType === 'absence') return '欠勤';
    return '休暇';
  };

  const getLeaveBadgeColorClass = (item: CompanyLeaveItem): string => {
    if (item.substituteAction === 'early_leave') return 'badge-early-leave';
    if (item.substituteAction === 'late_arrive') return 'badge-late-arrive';
    if (item.substituteAction === 'full_off' || item.leaveType === 'paid') return 'badge-full-off';
    return 'badge-leave-default';
  };

  return (
    <div className="company-calendar-wrapper">
      {/* 自分カレンダーと統一した月移動ナビゲーション */}
      <MonthNavigator
        currentMonth={currentMonth}
        onChange={setCurrentMonth}
      />

      {/* 凡例バー */}
      <div className="company-calendar-legend-bar">
        <span className="legend-item"><span className="legend-dot dot-full-off" />全休</span>
        <span className="legend-item"><span className="legend-dot dot-early-leave" />早上がり</span>
        <span className="legend-item"><span className="legend-dot dot-late-arrive" />遅出</span>
        <span className="legend-item"><span className="legend-dot dot-event" />社内メモ</span>
      </div>

      {errorMsg && (
        <div className="alert-box error" style={{ margin: '12px 0' }}>
          <AlertCircle size={16} />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* 自分カレンダーと統一したカレンダーコンテナ・グリッド */}
      <div className="calendar-container glass-card delay-100" style={{ position: 'relative' }}>
        {loading && (
          <div className="calendar-loading-overlay">
            <div className="spinner" />
            <span>社内スケジュール読み込み中...</span>
          </div>
        )}

        <div className="calendar-header-grid">
          {weekDays.map((wd, i) => (
            <div key={wd} className={`calendar-header-cell ${i === 0 ? 'sunday' : ''} ${i === 6 ? 'saturday' : ''}`}>
              {wd}
            </div>
          ))}
        </div>

        <div className="calendar-grid">
          {emptyDays.map(i => (
            <div key={`empty-${i}`} className="calendar-cell empty" />
          ))}

          {days.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const isToday = isSameDay(day, new Date());
            const dow = day.getDay();
            const holidayName = getJapaneseHolidayName(dateStr);
            const isSunday = dow === 0;
            const isSaturday = dow === 6;

            // 当該日のイベントと休暇
            const dayEvents = schedule.events.filter(e => e.date === dateStr);
            const dayLeaves = schedule.leaves.filter(l => l.date === dateStr);
            const isSelected = selectedDate === dateStr;

            const cellClasses = [
              'calendar-cell',
              'clickable',
              isToday ? 'today' : '',
              isSelected ? 'selected' : '',
              isSunday || holidayName ? 'holiday-day' : '',
              isSaturday ? 'saturday-day' : '',
            ].filter(Boolean).join(' ');

            return (
              <div
                key={dateStr}
                className={cellClasses}
                onClick={() => handleCellClick(dateStr)}
              >
                <div className="calendar-cell-top">
                  <span className={`calendar-date ${isSunday || holidayName ? 'text-holiday' : ''} ${isSaturday ? 'text-saturday' : ''}`}>
                    {format(day, 'd')}
                  </span>
                  {/* 右上端の社内メモ（緑丸） */}
                  {dayEvents.length > 0 && (
                    <span
                      className="calendar-dot memo-green"
                      title={`社内メモ ${dayEvents.length}件: ${dayEvents.map(e => e.title).join(', ')}`}
                    />
                  )}
                </div>

                {holidayName && (
                  <div className="calendar-holiday-name" title={holidayName}>
                    {holidayName}
                  </div>
                )}

                <div className="calendar-record-info">
                  {/* 休暇・短縮の色付き一文字丸バッジ */}
                  {dayLeaves.length > 0 && (
                    <div className="company-avatar-row">
                      {dayLeaves.slice(0, 3).map(leave => {
                        const letter = leave.userName?.trim().charAt(0) || '員';
                        return (
                          <span
                            key={leave.id}
                            className={`company-avatar-badge ${getLeaveBadgeColorClass(leave)}`}
                            title={`${leave.userName}: ${getLeaveBadgeLabel(leave)}`}
                          >
                            {letter}
                          </span>
                        );
                      })}
                      {dayLeaves.length > 3 && (
                        <span className="company-avatar-more" title={`他 ${dayLeaves.length - 3} 名`}>
                          +{dayLeaves.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* カレンダー直下の詳細カード（自分カレンダーと同じインライン表示） */}
      {selectedDate && (
        <div className="liff-selected-date-card glass-card animate-fade-in">
          <div className="selected-date-header">
            <div className="flex items-center gap-2">
              <CalendarIcon size={18} className="text-orange" />
              <h3>
                {selectedDate} の社内予定
                {getJapaneseHolidayName(selectedDate) && (
                  <span className="modal-holiday-tag">({getJapaneseHolidayName(selectedDate)})</span>
                )}
              </h3>
            </div>
          </div>

          <div className="company-selected-body">
            {/* セクション1: 休暇・遅出・早上がり一覧 */}
            <div className="schedule-detail-section">
              <h4 className="section-subtitle">
                <Clock size={15} />
                休暇・遅出・早上がりのメンバー ({selectedLeaves.length}名)
              </h4>

              {selectedLeaves.length === 0 ? (
                <p className="empty-subtext">予定されている休暇・短縮勤務はありません。</p>
              ) : (
                <div className="leave-detail-list">
                  {selectedLeaves.map(leave => (
                    <div key={leave.id} className="leave-detail-card">
                      <div className="leave-card-top">
                        <span className="leave-user-name">{leave.userName}</span>
                        <span className={`leave-status-badge ${getLeaveBadgeColorClass(leave)}`}>
                          {getLeaveBadgeLabel(leave)}
                        </span>
                        {leave.status === 'pending' && (
                          <span className="leave-pending-badge">承認待ち</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* セクション2: 社内メモ・イベント一覧 */}
            <div className="schedule-detail-section" style={{ marginTop: '16px' }}>
              <h4 className="section-subtitle">
                <CalendarIcon size={15} />
                社内メモ ({selectedEvents.length}件)
              </h4>

              {selectedEvents.length === 0 ? (
                <p className="empty-subtext">登録されているメモはありません。</p>
              ) : (
                <div className="event-detail-list">
                  {selectedEvents.map(event => {
                    const canDelete = isAdmin || (currentUser?.id && event.userId === currentUser.id);
                    return (
                      <div key={event.id} className="event-detail-card">
                        <div className="event-card-content">
                          <span className="event-card-title">{event.title}</span>
                          {event.userName && (
                            <span className="event-card-author">（記入者: {event.userName}）</span>
                          )}
                        </div>
                        {canDelete && (
                          <button
                            type="button"
                            className="btn-delete-event"
                            onClick={() => handleDeleteEvent(event.id)}
                            title="削除"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* メモ書き込みフォーム */}
              <form onSubmit={handleAddEvent} className="add-event-form">
                <div className="add-event-input-row">
                  <input
                    type="text"
                    className="form-control event-input"
                    placeholder="社内メモを入力（例: 全体定例 14:00〜）"
                    value={newEventTitle}
                    onChange={e => setNewEventTitle(e.target.value)}
                    maxLength={100}
                  />
                  <button
                    type="submit"
                    className="btn btn-primary btn-add-event"
                    disabled={submitting || !newEventTitle.trim()}
                  >
                    <Plus size={15} />
                    {submitting ? '追加中...' : '追加'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
