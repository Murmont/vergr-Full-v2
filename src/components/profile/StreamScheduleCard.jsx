// Read-only stream-schedule card for profile pages. Renders the 7-day ×
// 3h-block grid saved by Edit Profile → Schedule (profile.streamSchedule =
// { tz, days: { '0': [blockIdx…] } }). Self-hides when empty.
// The editor (EditProfileScreen ScheduleTab) imports these constants so the
// two grids can never drift.

import Icon from '../Icon';

export const SCHEDULE_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const SCHEDULE_BLOCKS = ['00', '03', '06', '09', '12', '15', '18', '21'];

export default function StreamScheduleCard({ schedule, accent = '#B44FFF' }) {
  const days = schedule?.days || {};
  if (!Object.keys(days).length) return null;

  return (
    <div className="rounded-xl p-4" style={{ background: '#14141F', border: '1px solid #1E1E2E' }}>
      <div className="flex items-center gap-1.5 mb-3">
        <Icon name="calendar_month" size={14} style={{ color: accent }} />
        <p className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">Stream Schedule</p>
        {schedule.tz && <span className="text-[10px] text-text-muted ml-auto">{schedule.tz}</span>}
      </div>
      <div className="overflow-x-auto">
        <div className="inline-grid gap-[3px]" style={{ gridTemplateColumns: `36px repeat(${SCHEDULE_BLOCKS.length}, minmax(24px, 1fr))` }}>
          <span />
          {SCHEDULE_BLOCKS.map(b => (
            <span key={b} className="text-[8.5px] text-text-muted font-bold text-center pb-0.5">{b}</span>
          ))}
          {SCHEDULE_DAYS.map((day, d) => {
            const on = new Set(days[String(d)] || []);
            return [
              <span key={`${day}-l`} className="text-[9.5px] text-text-secondary font-bold flex items-center">{day}</span>,
              ...SCHEDULE_BLOCKS.map((_, b) => (
                <span key={`${day}-${b}`} className="h-4 rounded-[3px]"
                  style={on.has(b)
                    ? { background: `${accent}66`, border: `1px solid ${accent}` }
                    : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }} />
              )),
            ];
          })}
        </div>
      </div>
    </div>
  );
}
