'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';

// ──────────────────────────────────────────────────────────────
// Types & Constants
// ──────────────────────────────────────────────────────────────
type AvailabilityArray = number[];

interface EventData {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
}

interface ResponseData {
  user_name: string;
  availability_array: AvailabilityArray;
}

interface AvailabilityData {
  availability_array: AvailabilityArray;
}

const HOURS = Array.from({ length: 13 }, (_, i) => i + 8); // 8 AM – 8 PM
const TIME_SLOTS_PER_HOUR = 4;
const TOTAL_TIME_SLOTS = HOURS.length * TIME_SLOTS_PER_HOUR;

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
const formatDate = (date: Date) => date.toISOString().split('T')[0];

const getDatesInRange = (start: Date, end: Date): Date[] => {
  const dates: Date[] = [];
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);

  while (cur <= end) {
    dates.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
};

// ──────────────────────────────────────────────────────────────
// Calendar sub-component
// ──────────────────────────────────────────────────────────────
interface CalendarProps {
  startDate: Date | null;
  endDate: Date | null;
  onSelectRange: (start: Date, end: Date | null) => void;
  onClose: () => void;
}

function Calendar({ startDate, endDate, onSelectRange, onClose }: CalendarProps) {
  const [viewDate, setViewDate] = useState(startDate || new Date());

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const handleDateClick = (day: number) => {
    const clicked = new Date(year, month, day);

    if (!startDate || (endDate && clicked < startDate)) {
      // Start a new selection
      onSelectRange(clicked, null);
      return;
    }

    // Selecting end date
    const diffDays = Math.ceil(
      (clicked.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffDays > 7) {
      alert('Maximum range is 7 days');
      return;
    }

    onSelectRange(startDate, clicked);
    onClose();
  };

  const changeMonth = (offset: number) => {
    setViewDate(new Date(year, month + offset, 1));
  };

  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const weeks: JSX.Element[] = [];
  let day = 1;

  for (let w = 0; w < 6; w++) {
    const week: JSX.Element[] = [];

    for (let d = 0; d < 7; d++) {
      if (w === 0 && d < firstDayOfMonth) {
        week.push(<td key={`empty-${d}`} />);
        continue;
      }
      if (day > daysInMonth) {
        week.push(<td key={`end-${d}`} />);
        continue;
      }

      const current = new Date(year, month, day);
      const isStart = startDate && formatDate(current) === formatDate(startDate);
      const isEnd = endDate && formatDate(current) === formatDate(endDate);
      const isInRange =
        startDate &&
        endDate &&
        current > startDate &&
        current < endDate;

      week.push(
        <td key={day} className="p-1">
          <button
            onClick={() => handleDateClick(day)}
            className={`
              w-8 h-8 rounded-full text-sm transition
              ${isStart || isEnd ? 'bg-white text-black font-bold' : ''}
              ${isInRange ? 'bg-zinc-700' : ''}
              ${!isStart && !isEnd && !isInRange ? 'hover:bg-zinc-800' : ''}
            `}
          >
            {day}
          </button>
        </td>
      );
      day++;
    }
    weeks.push(<tr key={w}>{week}</tr>);
    if (day > daysInMonth) break;
  }

  return (
    <div className="absolute top-full left-0 mt-2 bg-zinc-900 border border-zinc-700 p-4 rounded-lg shadow-xl z-50 min-w-[300px]">
      <div className="flex justify-between items-center mb-4">
        <button onClick={() => changeMonth(-1)} className="p-1 hover:bg-zinc-800 rounded">
          ←
        </button>
        <span className="font-bold">
          {viewDate.toLocaleString('default', { month: 'long' })} {year}
        </span>
        <button onClick={() => changeMonth(1)} className="p-1 hover:bg-zinc-800 rounded">
          →
        </button>
      </div>
      <table className="w-full text-center">
        <thead>
          <tr className="text-xs text-zinc-400">
            <th>S</th><th>M</th><th>T</th><th>W</th><th>T</th><th>F</th><th>S</th>
          </tr>
        </thead>
        <tbody>{weeks}</tbody>
      </table>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────
export default function When2Jam() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const eventId = searchParams.get('id');

  // ── State ───────────────────────────────────────────────────
  const [eventName, setEventName] = useState('');
  const [userName, setUserName] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);

  const [availability, setAvailability] = useState<AvailabilityArray>([]);
  const [heatmap, setHeatmap] = useState<AvailabilityArray>([]);
  const [totalResponses, setTotalResponses] = useState(0);

  const [isPainting, setIsPainting] = useState(false);
  const [paintMode, setPaintMode] = useState<0 | 1>(1); // 1 = paint, 0 = erase

  const [showCalendar, setShowCalendar] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isGuestMode = !!eventId;

  // ── Derived data ─────────────────────────────────────────────
  const dates = useMemo(() => {
    if (!startDate || !endDate) return [];
    return getDatesInRange(startDate, endDate);
  }, [startDate, endDate]);

  const totalSlots = dates.length * TOTAL_TIME_SLOTS;

  // ── Initialise (create vs guest) ─────────────────────────────
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setError(null);

      if (isGuestMode && eventId) {
        // ── Guest: load existing event ───────────────────────
        const { data: ev, error: evErr } = await supabase
          .from('events')
          .select('name, start_date, end_date')
          .eq('id', eventId)
          .single();

        if (evErr || !ev) {
          setError('Event not found');
          setLoading(false);
          return;
        }

        setEventName(ev.name);
        setStartDate(new Date(ev.start_date));
        setEndDate(new Date(ev.end_date));

        // Load all responses for heatmap
        const { data: resp } = await supabase
          .from('responses')
          .select('availability_array')
          .eq('event_id', eventId);

        if (resp) {
          const hm = new Array(totalSlots).fill(0);
          resp.forEach((r: AvailabilityData) => {
            if (r.availability_array?.length === totalSlots) {
              r.availability_array.forEach((v: number, i: number) => v === 1 && hm[i]++);
            }
          });
          setHeatmap(hm);
          setTotalResponses(resp.length);
        }
        setAvailability(new Array(totalSlots).fill(0));
      } else {
        // ── Create mode defaults ───────────────────────────────
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        setStartDate(today);
        const defaultEnd = new Date(today);
        defaultEnd.setDate(today.getDate() + 2);
        setEndDate(defaultEnd);
      }
      setLoading(false);
    };

    init();
  }, [eventId, isGuestMode, totalSlots]);

  // Resize arrays when date range changes
  useEffect(() => {
    if (!totalSlots) return;
    setAvailability((prev: AvailabilityArray) => (prev.length === totalSlots ? prev : new Array(totalSlots).fill(0)));
    setHeatmap((prev: AvailabilityArray) => (prev.length === totalSlots ? prev : new Array(totalSlots).fill(0)));
  }, [totalSlots]);

  // ── Handlers ────────────────────────────────────────────────
  const handleCreateEvent = async () => {
    if (!eventName.trim() || !userName.trim() || !startDate || !endDate) {
      alert('Fill in event name, your name and select a date range');
      return;
    }

    setLoading(true);
    const { data: ev, error: evErr } = await supabase
      .from('events')
      .insert({
        name: eventName.trim(),
        start_date: formatDate(startDate),
        end_date: formatDate(endDate),
      })
      .select()
      .single();

    if (evErr || !ev) {
      alert('Failed to create event');
      setLoading(false);
      return;
    }

    await supabase.from('responses').insert({
      event_id: ev.id,
      user_name: userName.trim(),
      availability_array: availability,
    });

    router.push(`?id=${ev.id}`);
    setLoading(false);
  };

  const handleUpdateAvailability = async () => {
    if (!userName.trim()) return alert('Enter your name');
    if (!eventId) return;

    setLoading(true);
    const { error } = await supabase
      .from('responses')
      .upsert(
        {
          event_id: eventId,
          user_name: userName.trim(),
          availability_array: availability,
        },
        { onConflict: 'event_id,user_name' }
      );

    if (error) {
      alert('Failed to save (maybe duplicate name?)');
      console.error(error);
    } else {
      alert('Availability saved!');
      // Refresh heatmap
      const { data } = await supabase
        .from('responses')
        .select('availability_array')
        .eq('event_id', eventId);

      if (data) {
        const hm = new Array(totalSlots).fill(0);
        data.forEach((r: AvailabilityData) => {
          if (r.availability_array?.length === totalSlots) {
            r.availability_array.forEach((v: number, i: number) => v === 1 && hm[i]++);
          }
        });
        setHeatmap(hm);
        setTotalResponses(data.length);
      }
    }
    setLoading(false);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href).then(() => alert('Link copied!'));
  };

  // ── Painting logic ──────────────────────────────────────────
  const startPaint = (dayIdx: number, slotIdx: number) => {
    const idx = dayIdx * TOTAL_TIME_SLOTS + slotIdx;
    const newMode = availability[idx] === 1 ? 0 : 1;
    setPaintMode(newMode);
    setIsPainting(true);

    setAvailability((a: AvailabilityArray) => {
      const copy = [...a];
      copy[idx] = newMode;
      return copy;
    });
  };

  const continuePaint = (dayIdx: number, slotIdx: number) => {
    if (!isPainting) return;
    const idx = dayIdx * TOTAL_TIME_SLOTS + slotIdx;
    if (availability[idx] !== paintMode) {
      setAvailability((a: AvailabilityArray) => {
        const copy = [...a];
        copy[idx] = paintMode;
        return copy;
      });
    }
  };

  const stopPaint = () => setIsPainting(false);

  // ── Render ───────────────────────────────────────────────────
  if (loading && isGuestMode) return <div className="flex min-h-screen items-center justify-center bg-black text-white">Loading event…</div>;
  if (error) return <div className="flex min-h-screen items-center justify-center bg-black text-red-500">{error}</div>;

  return (
    <div
      className="flex min-h-screen flex-col items-center bg-black text-white font-mono p-4 sm:p-8"
      onMouseUp={stopPaint}
      onMouseLeave={stopPaint}
    >
      <div className="w-full max-w-7xl">
        {/* Header */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
          <h1 className="text-4xl font-bold">when2jam</h1>

          <div className="flex gap-3 w-full sm:w-auto">
            {isGuestMode && (
              <button
                onClick={handleCopyLink}
                className="flex-1 sm:flex-none border border-white px-5 py-2 hover:bg-white hover:text-black transition"
              >
                Copy Link
              </button>
            )}
            <button
              onClick={isGuestMode ? handleUpdateAvailability : handleCreateEvent}
              disabled={loading}
              className="flex-1 sm:flex-none bg-white text-black px-5 py-2 font-bold hover:bg-zinc-200 disabled:opacity-50 transition"
            >
              {loading ? 'Working…' : isGuestMode ? 'Update Availability' : 'Create Event'}
            </button>
          </div>
        </header>

        {/* Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Event Name</label>
            <input
              type="text"
              value={eventName}
              onChange={e => !isGuestMode && setEventName(e.target.value)}
              readOnly={isGuestMode}
              placeholder="My Jam Session"
              className="w-full bg-black border border-zinc-700 p-2 focus:border-white outline-none"
            />
          </div>

          <div className="relative">
            <label className="text-xs text-zinc-500 block mb-1">Dates</label>
            <input
              type="text"
              readOnly
              value={startDate && endDate ? `${formatDate(startDate)} – ${formatDate(endDate)}` : ''}
              onClick={() => !isGuestMode && setShowCalendar(true)}
              className="w-full bg-black border border-zinc-700 p-2 cursor-pointer hover:border-zinc-500"
            />
            {showCalendar && !isGuestMode && (
              <Calendar
                startDate={startDate}
                endDate={endDate}
                onSelectRange={(s, e) => {
                  setStartDate(s);
                  setEndDate(e);
                  setShowCalendar(false);
                }}
                onClose={() => setShowCalendar(false)}
              />
            )}
          </div>

          <div>
            <label className="text-xs text-zinc-500 block mb-1">Your Name</label>
            <input
              type="text"
              value={userName}
              onChange={e => setUserName(e.target.value)}
              placeholder="Jamie"
              className="w-full bg-black border border-zinc-700 p-2 focus:border-white outline-none"
            />
          </div>
        </div>

        {/* Grid */}
        <div
          className="overflow-x-auto border border-zinc-800 rounded-lg select-none"
          onMouseLeave={stopPaint}
        >
          <div className="flex" style={{ minWidth: `${Math.max(dates.length * 120, 600)}px` }}>
            {/* Time labels */}
            <div className="w-20 flex-shrink-0 pt-8">
              {HOURS.map(h => (
                <div key={h} className="h-24 border-t border-zinc-800 relative">
                  <span className="absolute -top-3 right-2 text-xs text-zinc-500">
                    {h % 12 || 12} {h < 12 ? 'AM' : 'PM'}
                  </span>
                </div>
              ))}
            </div>

            {/* Days */}
            {dates.map((date, dayIdx) => (
              <div key={date.toISOString()} className="flex-1 min-w-[110px]">
                <div className="text-center mb-2 pt-2">
                  <div className="text-xs text-zinc-500">
                    {date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}
                  </div>
                  <div className="text-lg font-bold">{date.getDate()}</div>
                </div>

                <div className="border-l border-zinc-800">
                  {Array.from({ length: TOTAL_TIME_SLOTS }).map((_, slotIdx) => {
                    const idx = dayIdx * TOTAL_TIME_SLOTS + slotIdx;
                    const isSelected = availability[idx] === 1;
                    const count = heatmap[idx] || 0;
                    const opacity = totalResponses ? count / totalResponses : 0;

                    return (
                      <div
                        key={slotIdx}
                        className={`h-6 border-b border-r border-zinc-800 cursor-pointer relative
                          ${slotIdx % 4 === 3 ? 'border-b-zinc-600' : ''}
                        `}
                        style={{
                          backgroundColor: isSelected
                            ? 'rgb(255,255,255)'
                            : `rgba(34, 197, 94, ${opacity * 0.8})`,
                        }}
                        onMouseDown={e => {
                          e.preventDefault();
                          startPaint(dayIdx, slotIdx);
                        }}
                        onMouseEnter={() => continuePaint(dayIdx, slotIdx)}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 text-sm text-zinc-400">
          Click and drag to mark your available times (white). Green shading shows how many people are free.
        </div>
      </div>
    </div>
  );
}