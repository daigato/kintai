import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format, addMonths, subMonths, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';

interface MonthNavigatorProps {
  currentMonth: string; // YYYY-MM 形式
  onChange: (yearMonth: string) => void;
}

export const MonthNavigator: React.FC<MonthNavigatorProps> = ({ currentMonth, onChange }) => {
  const currentDate = parseISO(`${currentMonth}-01`);
  const displayLabel = format(currentDate, 'yyyy年M月', { locale: ja });

  const handlePrev = () => {
    const prev = subMonths(currentDate, 1);
    onChange(format(prev, 'yyyy-MM'));
  };

  const handleNext = () => {
    const next = addMonths(currentDate, 1);
    onChange(format(next, 'yyyy-MM'));
  };

  const handleToday = () => {
    onChange(format(new Date(), 'yyyy-MM'));
  };

  const isCurrentMonth = currentMonth === format(new Date(), 'yyyy-MM');

  return (
    <div className="month-navigator">
      <button onClick={handlePrev} className="month-nav-btn" aria-label="前月">
        <ChevronLeft size={20} />
      </button>
      <button onClick={handleToday} className="month-nav-label" disabled={isCurrentMonth}>
        {displayLabel}
      </button>
      <button onClick={handleNext} className="month-nav-btn" aria-label="次月">
        <ChevronRight size={20} />
      </button>
    </div>
  );
};
