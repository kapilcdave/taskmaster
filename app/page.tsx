'use client';

import { Suspense, useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// ──────────────────────────────────────────────────────────────
// Types & Constants
// ──────────────────────────────────────────────────────────────
type AvailabilityArray = number[];

interface ResponseData {
  user_name: string;
  availability_array: AvailabilityArray;
}

const HOURS = Array.from({ length: 13 }, (_, i) => i + 9); // 9 AM – 9 PM (Adjustable)
const TIME_SLOTS_PER_HOUR = 4; // 15 minute increments
const TOTAL_TIME_SLOTS = HOURS.length * TIME_SLOTS_PER_HOUR;

// Helper: Compare dates ignoring time
const isSameDate = (d1: Date, d2: Date) => 
  d1.getFullYear() === d2.getFullYear() &&
  d1.getMonth() === d2.getMonth() &&
  d1.getDate() === d2.getDate();

const formatDateParam = (d: Date) => d.toISOString().split('T')[0];

const getDatesInRange = (start: Date, end: Date): Date[] => {
  const dates: Date[] = [];
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const e = new Date(end);
  e.setHours(0, 0, 0, 0);

  while (cur <= e) {
    dates.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
};

// ──────────────────────────────────────────────────────────────
// Interactive Calendar Component
// ──────────────────────────────────────────────────────────────
function Calendar({
  startDate,
  endDate,
  onSelectRange,
  onClose,
}: {
  startDate: Date | null;
  endDate: Date | null;
  onSelectRange: (s: Date | null, e: Date | null) => void;
  onClose: () => void;
}) {
  // Default view to start date or today
  const [viewDate, setViewDate] = useState(startDate || new Date());
  
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const handleClick = (day: number) => {
    const clicked = new Date(year, month, day);
    clicked.setHours(0,0,0,0);

    // 1. If nothing selected, start here
    if (!startDate) {
      onSelectRange(clicked, null);
      return;
    }

    // 2. If start exists but no end, decide if it's before or after
    if (startDate && !endDate) {
      if (clicked < startDate) {
        // User clicked before start, reset start
        onSelectRange(clicked, null);
      } else {
        // Valid range
        onSelectRange(startDate, clicked);
        onClose();
      }
      return;
    }

    // 3. If full range exists, reset and start new selection
    if (startDate && endDate) {
      onSelectRange(clicked, null);
    }
  };

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const weeks: JSX.Element[] = [];
  let day = 1;

  for (let w = 0; w < 6 && day <= daysInMonth; w++) {
    const week: JSX.Element[] = [];
    for (let d = 0; d < 7; d++) {
      if ((w === 0 && d < firstDay) || day > daysInMonth) {
        week.push(<td key={`empty-${w}-${d}`} />);
        continue;
      }

      const current = new Date(year, month, day);
      current.setHours(0,0,0,0);

      const isStart = startDate && isSameDate(current, startDate);
      const isEnd = endDate && isSameDate(current, endDate);
      const isInRange = startDate && endDate && current > startDate && current < endDate;

      week.push(
        <td key={day} className="p-1">
          <button
            onClick={() => handleClick(current.getDate())}
            className={`
              w-8 h-8 rounded-full text-sm transition-all
              ${isStart || isEnd ? 'bg-white text-black font-bold' : ''}
              ${isInRange ? 'bg-zinc-700' : ''}
              ${!isStart && !isEnd && !isInRange ? 'hover:bg-zinc-800 text-zinc-300' : ''}
            `}
          >
            {day}
          </button>
        </td>
      );
      day++;
    }
    weeks.push(<tr key={w}>{week}</tr>);
  }

  return (
    <div className="absolute top-full left-0 mt-2 bg-zinc-900 border border-zinc-700 p-4 rounded-lg shadow-2xl z-50 min-w-[300px]">
      <div className="flex justify-between items-center mb-4">
        <button onClick={() => setViewDate(new Date(year, month - 1, 1))} className="p-1 hover:bg-zinc-800 rounded text-white">←</button>
        <span className="font-bold text-white">
          {viewDate.toLocaleString('default', { month: 'long' })} {year}
        </span>
        <button onClick={() => setViewDate(new Date(year, month + 1, 1))} className="p-1 hover:bg-zinc-800 rounded text-white">→</button>
      </div>
      <table className="w-full text-center">
        <thead>
          <tr className="text-xs text-zinc-500 mb-2">
            <th>S</th><th>M</th><th>T</th><th>W</th><th>T</th><th>F</th><th>S</th>
          </tr>
        </thead>
        <tbody>{weeks}</tbody>
      </table>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Main Logic
// ──────────────────────────────────────────────────────────────
function When2Jam() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const eventId = searchParams.get('id');

  // Form State
  const [eventName, setEventName] = useState('');
  const [userName, setUserName] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  
  // Data State
  const [myAvailability, setMyAvailability] = useState<AvailabilityArray>([]);
  const [allResponses, setAllResponses] = useState<ResponseData[]>([]);
  
  // UI State
  const [isPainting, setIsPainting] = useState(false);
  const [paintMode, setPaintMode] = useState<0 | 1>(1);
  const [showCalendar, setShowCalendar] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Hover/Tooltip State
  const [hoveredSlot, setHoveredSlot] = useState<{ dayIdx: number, slotIdx: number, x: number, y: number } | null>(null);

  const isGuestMode = !!eventId;

  // Derived Helpers
  const dates = useMemo(() => {
    if (!startDate || !endDate) return [];
    return getDatesInRange(startDate, endDate);
  }, [startDate, endDate]);

  const totalSlotsPerDay = TOTAL_TIME_SLOTS;
  const totalSlots = dates.length * totalSlotsPerDay;

  // ── Initialization ──
  useEffect(() => {
    const init = async () => {
      if (!eventId) {
        // Default Create Mode
        const today = new Date();
        setStartDate(today);
        const defEnd = new Date(today);
        defEnd.setDate(today.getDate() + 3);
        setEndDate(defEnd);
        setLoading(false);
        return;
      }

      // Load Event
      setLoading(true);
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
      // Parse dates ensuring local time consistency
      const s = new Date(ev.start_date + 'T00:00:00');
      const e = new Date(ev.end_date + 'T00:00:00');
      setStartDate(s);
      setEndDate(e);

      // Load Responses
      const { data: responses } = await supabase
        .from('responses')
        .select('user_name, availability_array')
        .eq('event_id', eventId);

      if (responses) {
        setAllResponses(responses);
      }

      setLoading(false);
    };

    init();
  }, [eventId]);

  // Initialize my availability array size
  useEffect(() => {
    if (totalSlots > 0 && myAvailability.length !== totalSlots) {
      setMyAvailability(new Array(totalSlots).fill(0));
    }
  }, [totalSlots]);

  // ── Actions ──
  const createEvent = async () => {
    if (!eventName.trim() || !userName.trim() || !startDate || !endDate) {
      alert('Please fill in all fields');
      return;
    }
    setLoading(true);
    
    const { data: ev, error } = await supabase
      .from('events')
      .insert({
        name: eventName.trim(),
        start_date: formatDateParam(startDate),
        end_date: formatDateParam(endDate),
      })
      .select()
      .single();

    if (error || !ev) {
      console.error(error);
      alert('Failed to create event');
      setLoading(false);
      return;
    }

    // Add creator's response
    await supabase.from('responses').insert({
      event_id: ev.id,
      user_name: userName.trim(),
      availability_array: myAvailability,
    });

    router.push(`?id=${ev.id}`);
  };

  const updateAvailability = async () => {
    if (!userName.trim() || !eventId) return alert('Please enter your name');
    setLoading(true);
    
    const { error } = await supabase
      .from('responses')
      .upsert(
        { event_id: eventId, user_name: userName.trim(), availability_array: myAvailability },
        { onConflict: 'event_id,user_name' }
      );

    if (error) {
      alert('Failed to save. Try a different name?');
    } else {
      // Refresh data to see myself in the heatmap immediately
      const { data } = await supabase
        .from('responses')
        .select('user_name, availability_array')
        .eq('event_id', eventId);
      
      if (data) setAllResponses(data);
      alert('Availability Saved!');
    }
    setLoading(false);
  };

  const copyLink = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => alert('Could not copy link manually'));
    }
  };

  // ── Painting Logic ──
  const handlePaint = (dayIdx: number, slotIdx: number, mode: 'start' | 'move') => {
    const idx = dayIdx * totalSlotsPerDay + slotIdx;
    
    if (mode === 'start') {
      const newMode = myAvailability[idx] === 1 ? 0 : 1;
      setPaintMode(newMode);
      setIsPainting(true);
      updateSlot(idx, newMode);
    } else if (mode === 'move' && isPainting) {
      if (myAvailability[idx] !== paintMode) {
        updateSlot(idx, paintMode);
      }
    }
  };

  const updateSlot = (idx: number, val: 0 | 1) => {
    setMyAvailability(prev => {
      const next = [...prev];
      next[idx] = val;
      return next;
    });
  };

  // ── Heatmap Calculation ──
  const getSlotData = (dayIdx: number, slotIdx: number) => {
    const globalIdx = dayIdx * totalSlotsPerDay + slotIdx;
    
    let count = 0;
    const availableUsers: string[] = [];
    const unavailableUsers: string[] = [];

    allResponses.forEach(r => {
      if (r.availability_array?.[globalIdx] === 1) {
        count++;
        availableUsers.push(r.user_name);
      } else {
        unavailableUsers.push(r.user_name);
      }
    });

    return {
      count,
      availableUsers,
      unavailableUsers,
      opacity: allResponses.length > 0 ? count / allResponses.length : 0
    };
  };

  // ── Render ──
  if (loading && isGuestMode && allResponses.length === 0) 
    return <div className="flex min-h-screen items-center justify-center bg-black text-white">Loading Event...</div>;

  if (error) 
    return <div className="flex min-h-screen items-center justify-center bg-black text-red-500">{error}</div>;

  return (
    <div 
      className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-emerald-500/30"
      onMouseUp={() => setIsPainting(false)}
    >
      {/* Tooltip Overlay */}
      {hoveredSlot && (
        <div 
          className="fixed pointer-events-none z-50 bg-black border border-zinc-700 shadow-2xl rounded p-3 text-xs min-w-[150px]"
          style={{ left: hoveredSlot.x + 15, top: hoveredSlot.y + 15 }}
        >
          <div className="font-bold text-emerald-400 mb-1">
             Available ({getSlotData(hoveredSlot.dayIdx, hoveredSlot.slotIdx).availableUsers.length}/{allResponses.length})
          </div>
          <ul className="mb-2 text-zinc-300">
            {getSlotData(hoveredSlot.dayIdx, hoveredSlot.slotIdx).availableUsers.map(u => <li key={u}>{u}</li>)}
          </ul>
          {getSlotData(hoveredSlot.dayIdx, hoveredSlot.slotIdx).unavailableUsers.length > 0 && (
            <>
              <div className="font-bold text-red-400 mb-1 border-t border-zinc-800 pt-1">Unavailable</div>
              <ul className="text-zinc-500">
                {getSlotData(hoveredSlot.dayIdx, hoveredSlot.slotIdx).unavailableUsers.map(u => <li key={u}>{u}</li>)}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="max-w-6xl mx-auto p-4 sm:p-8">
        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-end md:items-center mb-10 gap-6 border-b border-zinc-800 pb-6">
          <div>
             <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              when2jam
            </h1>
            <p className="text-zinc-500 text-sm mt-1">Find a time that works for everyone.</p>
          </div>
         
          <div className="flex gap-3 w-full md:w-auto">
            {isGuestMode && (
              <button 
                onClick={copyLink} 
                className={`flex-1 md:flex-none px-4 py-2 rounded font-medium transition-all ${copied ? 'bg-green-600 text-white' : 'border border-zinc-600 hover:bg-zinc-800'}`}
              >
                {copied ? 'Link Copied!' : 'Copy Link'}
              </button>
            )}
            <button
              onClick={isGuestMode ? updateAvailability : createEvent}
              disabled={loading}
              className="flex-1 md:flex-none bg-white text-black hover:bg-zinc-200 px-6 py-2 rounded font-bold disabled:opacity-50 transition-colors"
            >
              {loading ? 'Saving...' : isGuestMode ? 'Update Availability' : 'Create Event'}
            </button>
          </div>
        </header>

        {/* Inputs Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Event Name</label>
            <input
              value={eventName}
              onChange={e => !isGuestMode && setEventName(e.target.value)}
              readOnly={isGuestMode}
              placeholder="Weekly Sync"
              className={`w-full bg-zinc-900 border border-zinc-700 rounded p-3 focus:border-emerald-500 outline-none transition-colors ${isGuestMode ? 'text-zinc-400 cursor-not-allowed' : ''}`}
            />
          </div>

          <div className="relative space-y-2">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Dates</label>
            <div 
              onClick={() => !isGuestMode && setShowCalendar(!showCalendar)}
              className={`w-full bg-zinc-900 border border-zinc-700 rounded p-3 flex justify-between items-center ${!isGuestMode ? 'cursor-pointer hover:border-zinc-500' : 'cursor-not-allowed text-zinc-400'}`}
            >
              <span>
                {startDate && endDate 
                  ? `${startDate.toLocaleDateString()} — ${endDate.toLocaleDateString()}` 
                  : 'Select Date Range'}
              </span>
              {!isGuestMode && <span className="text-zinc-500">📅</span>}
            </div>
            
            {showCalendar && !isGuestMode && (
              <Calendar 
                startDate={startDate} 
                endDate={endDate} 
                onSelectRange={(s, e) => { setStartDate(s); setEndDate(e); }} 
                onClose={() => setShowCalendar(false)} 
              />
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Your Name</label>
            <input 
              value={userName} 
              onChange={e => setUserName(e.target.value)} 
              placeholder="John Doe"
              className="w-full bg-zinc-900 border border-zinc-700 rounded p-3 focus:border-emerald-500 outline-none transition-colors" 
            />
          </div>
        </div>

        {/* The Grid Container */}
        <div className="relative border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/50 shadow-inner" onMouseLeave={() => { setIsPainting(false); setHoveredSlot(null); }}>
          <div className="overflow-x-auto">
            <div className="flex select-none" style={{ minWidth: `${Math.max(dates.length * 140, 600)}px` }}>
              
              {/* Time Column */}
              <div className="w-16 flex-shrink-0 bg-zinc-900 border-r border-zinc-800 sticky left-0 z-10">
                <div className="h-12"></div> {/* Header Spacer */}
                {HOURS.map(h => (
                  <div key={h} className="h-16 border-b border-zinc-800 relative">
                    <span className="absolute -top-2.5 right-2 text-[10px] font-mono text-zinc-500 bg-zinc-900 px-1">
                      {h > 12 ? h - 12 : h} {h >= 12 ? 'PM' : 'AM'}
                    </span>
                  </div>
                ))}
              </div>

              {/* Date Columns */}
              {dates.map((date, dayIdx) => (
                <div key={date.toISOString()} className="flex-1 min-w-[100px] border-r border-zinc-800/50 last:border-r-0">
                  
                  {/* Date Header */}
                  <div className="h-12 flex flex-col justify-center items-center bg-zinc-900/80 border-b border-zinc-800">
                    <div className="text-[10px] font-bold text-zinc-500 uppercase">{date.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                    <div className="text-sm font-bold">{date.getDate()}</div>
                  </div>

                  {/* Time Slots */}
                  <div className="relative">
                    {Array.from({ length: TOTAL_TIME_SLOTS }).map((_, slotIdx) => {
                      const globalIdx = dayIdx * totalSlotsPerDay + slotIdx;
                      const isMySelection = myAvailability[globalIdx] === 1;
                      const { opacity } = getSlotData(dayIdx, slotIdx);
                      
                      // Logic for borders: darker line every hour (4 slots)
                      const isHourMark = slotIdx % 4 === 3;

                      return (
                        <div
                          key={slotIdx}
                          onMouseDown={(e) => { e.preventDefault(); handlePaint(dayIdx, slotIdx, 'start'); }}
                          onMouseEnter={(e) => {
                            handlePaint(dayIdx, slotIdx, 'move');
                            setHoveredSlot({ dayIdx, slotIdx, x: e.clientX, y: e.clientY });
                          }}
                          onMouseMove={(e) => setHoveredSlot({ dayIdx, slotIdx, x: e.clientX, y: e.clientY })}
                          className={`
                            h-4 w-full cursor-pointer transition-colors duration-75
                            ${isHourMark ? 'border-b border-zinc-800' : 'border-b border-zinc-800/30'}
                          `}
                          style={{
                            // If I selected it, show White.
                            // If I didn't, show Green based on group availability opacity.
                            backgroundColor: isMySelection 
                              ? '#ffffff' 
                              : `rgba(16, 185, 129, ${opacity})` // Tailwind Emerald-500
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="mt-6 flex items-center gap-6 text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-white border border-zinc-700 rounded-sm"></div>
            <span>Your Availability</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-emerald-500 rounded-sm"></div>
            <span>Group Availability</span>
          </div>
          <div className="ml-auto">
            Click & Drag to paint. Hover to see details.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-black text-white">Loading...</div>}>
      <When2Jam />
    </Suspense>
  );
}