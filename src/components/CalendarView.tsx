import React from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, parseISO, isSameDay } from 'date-fns';
import { getJapaneseHolidayName } from '../holidays';
import type { AttendanceRecord } from '../types';

interface CalendarProps {
  currentMonth: string; // YYYY-MM
  records: AttendanceRecord[];
  selectedDate?: string;
  onDateClick?: (dateStr: string, record: AttendanceRecord | undefined) => void;
}

export const CalendarView: React.FC<CalendarProps> = ({ currentMonth, records, selectedDate, onDateClick }) => {
  const monthDate = parseISO(`${currentMonth}-01`);
  const start = startOfMonth(monthDate);
  const end = endOfMonth(monthDate);
  const days = eachDayOfInterval({ start, end });

  const weekDays = ['日', '月', '火', '水', '木', '金', '土'];
  const startDayOfWeek = start.getDay();
  const emptyDays = Array.from({ length: startDayOfWeek }, (_, i) => i);

  return (
    <div className="calendar-container glass-card delay-100">
      <div className="calendar-header-grid">
        {weekDays.map((wd, i) => (
          <div key={wd} className={`calendar-header-cell ${i === 0 ? 'sunday' : ''} ${i === 6 ? 'saturday' : ''}`}>{wd}</div>
        ))}
      </div>
      <div className="calendar-grid">
        {emptyDays.map(i => <div key={`empty-${i}`} className="calendar-cell empty"></div>)}
        {days.map(day => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const record = records.find(r => r.date === dateStr);
          const isToday = isSameDay(day, new Date());
          const isSelected = selectedDate === dateStr;
          const dow = day.getDay();
          const holidayName = getJapaneseHolidayName(dateStr);
          const isSunday = dow === 0;
          const isSaturday = dow === 6;

          const cellClasses = [
            'calendar-cell',
            isToday ? 'today' : '',
            isSelected ? 'selected' : '',
            onDateClick ? 'clickable' : '',
            isSunday || holidayName ? 'holiday-day' : '',
            isSaturday ? 'saturday-day' : '',
          ].filter(Boolean).join(' ');

          const formatTime = (iso?: string | null) => {
            if (!iso) return '';
            try {
              return format(parseISO(iso), 'HH:mm');
            } catch {
              return '';
            }
          };

          const hasClockIn = Boolean(record?.clockIn);
          const hasClockOut = Boolean(record?.clockOut);

          return (
            <div
              key={dateStr}
              className={cellClasses}
              onClick={(e) => {
                e.stopPropagation();
                onDateClick?.(dateStr, record);
              }}
            >
              <div className="calendar-cell-top">
                <span className={`calendar-date ${isSunday || holidayName ? 'text-holiday' : ''} ${isSaturday ? 'text-saturday' : ''}`}>
                  {format(day, 'd')}
                </span>
                {record?.isHolidayWork && <span className="calendar-dot holiday" title="休日出勤" />}
                {record?.memo && <span className="calendar-dot memo" title="メモあり" />}
              </div>

              {holidayName && (
                <div className="calendar-holiday-name" title={holidayName}>
                  {holidayName}
                </div>
              )}

              {record && (
                <div className="calendar-record-info">
                  {record.recordType === 'morning_off' && <span className="calendar-mini-badge">前休</span>}
                  {record.recordType === 'afternoon_off' && <span className="calendar-mini-badge">後休</span>}
                  {record.recordType === 'full_off' && <span className="calendar-mini-badge">全休</span>}

                  {(hasClockIn || hasClockOut) && (
                    <div className="calendar-times">
                      <span>{formatTime(record.clockIn) || '--'}</span>
                      <span className="time-sep">~</span>
                      <span>{formatTime(record.clockOut) || '--'}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
