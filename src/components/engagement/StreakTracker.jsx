import { motion } from 'framer-motion';

export default function StreakTracker({ currentStreak = 0, weekDays = [] }) {
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const defaultWeek = days.map((d, i) => ({ day: d, completed: i < currentStreak % 7 }));
  const week = weekDays.length ? weekDays : defaultWeek;

  return (
    <div className="bg-surface-1 rounded-xl p-4 border border-white/[0.06]">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-text-muted text-[10px] font-semibold uppercase tracking-wider">Daily Streak</p>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-text-primary text-xl font-bold font-dmmono">{currentStreak}</span>
            <span className="text-text-muted text-xs">days</span>
          </div>
        </div>
        {currentStreak >= 7 && (
          <div className="px-2.5 py-1 bg-brand-gold/10 rounded-full border border-brand-gold/15">
            <span className="text-brand-gold text-[10px] font-semibold">Consistent</span>
          </div>
        )}
      </div>
      <div className="flex gap-1.5">
        {week.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-semibold transition-colors ${
              d.completed
                ? 'bg-brand-violet/15 text-brand-violet-light'
                : 'bg-surface-2/50 text-text-muted'
            }`}>
              {d.completed ? '✓' : d.day}
            </div>
            <span className="text-[9px] text-text-muted">{d.day}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
