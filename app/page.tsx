'use client'

import React, { useState, useEffect, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// --- CONSTANTS ---
const START_HOUR = 8
const END_HOUR = 22 
const SLOTS_PER_HOUR = 2 // 30 Minute Increments
const SLOT_HEIGHT = 32 
const MAX_DAYS = 7

// --- TYPES ---
type ResponseData = {
  user_name: string
  availability: number[]
}

function TaskmasterContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  
  // --- STATE ---
  const [eventId, setEventId] = useState<string | null>(null)
  const [eventName, setEventName] = useState('') 
  const [userName, setUserName] = useState('')
  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [hasChanges, setHasChanges] = useState(false) // New state for button style

  // Dates
  const [startDate, setStartDate] = useState<Date | null>(new Date())
  const [endDate, setEndDate] = useState<Date | null>(() => {
    const d = new Date()
    d.setDate(d.getDate() + 2) 
    return d
  })
  
  // UI State
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [pickerMonth, setPickerMonth] = useState(new Date())
  
  // Grid Data
  const [myGrid, setMyGrid] = useState<number[]>([])
  const [groupResponses, setGroupResponses] = useState<ResponseData[]>([])
  
  // Interaction State
  const [isDragging, setIsDragging] = useState(false)
  const [paintMode, setPaintMode] = useState(true)
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null)

  // --- EFFECTS ---

  useEffect(() => {
    const id = searchParams.get('id')
    if (id) {
      setEventId(id)
      loadEvent(id)
    } else {
      initializeGrid(3)
      setHasChanges(true) // New event always has "unsaved" state initially
    }
  }, [searchParams])

  useEffect(() => {
    if (!eventId) return
    fetchResponses(eventId)
    
    const channel = supabase
      .channel('room1')
      .on('postgres_changes', { 
        event: '*', schema: 'public', table: 'responses', filter: `event_id=eq.${eventId}` 
      }, () => fetchResponses(eventId))
      .subscribe()
      
    return () => { supabase.removeChannel(channel) }
  }, [eventId])

  // --- LOGIC: DATA ---

  const loadEvent = async (id: string) => {
    setLoading(true)
    const { data, error } = await supabase.from('events').select('*').eq('id', id).single()
    
    if (data) {
      setEventName(data.name)
      const s = new Date(data.start_date)
      const e = new Date(data.end_date)
      setStartDate(s)
      setEndDate(e)
      setPickerMonth(s)
      const diffTime = Math.abs(e.getTime() - s.getTime())
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1
      initializeGrid(diffDays)
    }
    setLoading(false)
  }

  const fetchResponses = async (id: string) => {
    const { data } = await supabase.from('responses').select('*').eq('event_id', id)
    if (data) setGroupResponses(data)
  }

  const initializeGrid = (days: number) => {
    const totalSlots = days * (END_HOUR - START_HOUR) * SLOTS_PER_HOUR
    setMyGrid(new Array(totalSlots).fill(0))
  }

  const handleSave = async () => {
    if (!userName.trim()) return alert("Enter your name first!")
    const finalEventName = eventName.trim() || 'Untitled Jam'
    setLoading(true)

    if (!eventId) {
      if (!startDate || !endDate) return
      const { data, error } = await supabase
        .from('events')
        .insert({ name: finalEventName, start_date: startDate.toISOString(), end_date: endDate.toISOString() })
        .select().single()

      if (error) {
        alert("Error creating event")
        setLoading(false)
        return
      }
      
      const newId = data.id
      await saveResponse(newId)
      router.push(`?id=${newId}`)
      setEventId(newId)
      setStatusMsg("Event Created!")
    } else {
      await saveResponse(eventId)
      setStatusMsg("Saved!")
    }
    
    setLoading(false)
    setHasChanges(false) // Reset button state
    setTimeout(() => setStatusMsg(''), 2000)
  }

  const saveResponse = async (eid: string) => {
    await supabase.from('responses').upsert({
      event_id: eid, user_name: userName, availability: myGrid
    }, { onConflict: 'event_id, user_name' })
  }

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    setStatusMsg("Copied!")
    setTimeout(() => setStatusMsg(''), 2000)
  }

  // --- LOGIC: HEATMAP ---

  const heatmap = useMemo(() => {
    if (groupResponses.length === 0) return null
    const map = new Array(myGrid.length).fill(0)
    groupResponses.forEach(r => {
      if(r.availability) {
          r.availability.forEach((val: number, i: number) => {
            if (map[i] !== undefined) map[i] += val
          })
      }
    })
    return map
  }, [groupResponses, myGrid.length])

  // --- INTERACTION ---

  const getSlotLabel = (index: number) => {
    if (!startDate) return ""
    const slotsPerDay = (END_HOUR - START_HOUR) * SLOTS_PER_HOUR
    const dayIndex = Math.floor(index / slotsPerDay)
    const timeIndex = index % slotsPerDay
    
    const date = new Date(startDate)
    date.setDate(date.getDate() + dayIndex)
    
    const totalMinutes = timeIndex * (60 / SLOTS_PER_HOUR)
    const hour = START_HOUR + Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    
    const ampm = hour >= 12 ? 'PM' : 'AM'
    const displayHour = hour > 12 ? hour - 12 : hour
    const displayMin = minutes === 0 ? '00' : minutes
    
    return `${date.toLocaleDateString('en-US', { weekday: 'short' })} ${displayHour}:${displayMin} ${ampm}`
  }

  const handleSlotInteraction = (index: number, isDown: boolean) => {
    setSelectedSlot(index)
    if (isDown) {
        setIsDragging(true)
        const newVal = myGrid[index] === 0 ? 1 : 0
        setPaintMode(newVal === 1)
        updateLocalGrid(index, newVal)
    } 
    else if (isDragging) {
        updateLocalGrid(index, paintMode ? 1 : 0)
    }
  }

  const updateLocalGrid = (index: number, val: number) => {
    const newGrid = [...myGrid]
    newGrid[index] = val
    setMyGrid(newGrid)
    setHasChanges(true) // Mark as dirty
  }

  // --- DATE PICKER ---
  const handleDayClick = (date: Date) => {
    if (eventId) return
    const cleanDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    if (!startDate || (startDate && endDate)) {
      setStartDate(cleanDate); setEndDate(null)
    } else {
      if (cleanDate < startDate) {
        setStartDate(cleanDate)
      } else {
        const diffDays = Math.ceil(Math.abs(cleanDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
        if (diffDays >= MAX_DAYS) { setStartDate(cleanDate); setEndDate(null) } 
        else { setEndDate(cleanDate); initializeGrid(diffDays + 1); setShowDatePicker(false) }
      }
    }
  }

  const changeMonth = (delta: number) => {
    const newDate = new Date(pickerMonth)
    newDate.setMonth(newDate.getMonth() + delta)
    setPickerMonth(newDate)
  }

  // --- RENDERERS ---

  const renderInfoPanel = () => {
    if (selectedSlot === null) return <div className="text-gray-500 text-sm">Tap a time slot to see who is free.</div>
    
    const availablePeople = groupResponses
        .filter(r => r.availability && r.availability[selectedSlot] === 1)
        .map(r => r.user_name)
    
    if (myGrid[selectedSlot] === 1 && !availablePeople.includes(userName) && userName) {
        availablePeople.push(`${userName} (You)`)
    }

    return (
        <div className="w-full">
            <div className="text-green-400 font-bold uppercase text-xs mb-2 tracking-widest border-b border-gray-800 pb-1">
                {getSlotLabel(selectedSlot)}
            </div>
            {availablePeople.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                    {availablePeople.map((name, i) => (
                        <span key={i} className="bg-zinc-800 text-white text-xs px-2 py-1 rounded border border-zinc-700">
                            {name}
                        </span>
                    ))}
                </div>
            ) : (
                <div className="text-gray-500 text-xs italic">No one available</div>
            )}
        </div>
    )
  }

  const renderCalendarGrid = () => {
    if (!startDate) return null
    const days = endDate ? Math.ceil(Math.abs(endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1 : 1
    
    const timeLabels = []
    for(let h=START_HOUR; h<END_HOUR; h++) {
      for(let s=0; s<SLOTS_PER_HOUR; s++) {
        const isHour = s === 0
        const label = (h === 12 && isHour) ? '12 PM' : (isHour ? `${h > 12 ? h-12 : h} ${h >= 12 ? 'PM' : 'AM'}` : '')
        timeLabels.push(
          <div key={`t-${h}-${s}`} className="flex justify-end pr-2 items-center text-[0.65rem] font-bold text-gray-400 border-b border-transparent relative box-border bg-black z-20" style={{ height: SLOT_HEIGHT }}>
             {isHour && <span>{label}</span>}
          </div>
        )
      }
    }

    const dayColumns = []
    for (let d=0; d<days; d++) {
      const currentDay = new Date(startDate)
      currentDay.setDate(startDate.getDate() + d)
      const daySlots = []
      const dayOffset = d * (END_HOUR - START_HOUR) * SLOTS_PER_HOUR
      
      for(let i=0; i < (END_HOUR - START_HOUR) * SLOTS_PER_HOUR; i++) {
        const globalIndex = dayOffset + i
        const isSelected = myGrid[globalIndex] === 1
        const isFocused = selectedSlot === globalIndex
        const isHourStart = i % SLOTS_PER_HOUR === 0
        
        let bgStyle = {}
        const count = (heatmap && heatmap[globalIndex]) || 0
        const max = groupResponses.length || 1
        if (eventId && count > 0) {
           const intensity = count / max
           bgStyle = { backgroundColor: `rgba(255, 255, 255, ${intensity})` }
        }
        
        daySlots.push(
          <div 
            key={`s-${globalIndex}`} 
            onMouseDown={() => handleSlotInteraction(globalIndex, true)} 
            onMouseEnter={() => handleSlotInteraction(globalIndex, false)}
            className={`
                border-b border-r border-gray-800 box-border cursor-pointer relative w-full transition-colors
                ${isHourStart ? 'border-b-gray-600' : ''} 
                ${isSelected ? '!bg-green-500' : ''}
                ${isFocused ? 'ring-2 ring-white z-10' : ''}
            `}
            style={{ height: SLOT_HEIGHT, ...bgStyle }} 
          />
        )
      }
      
      dayColumns.push(
        <div key={`d-${d}`} className="flex flex-col min-w-[70px] flex-1">
          <div className="sticky top-0 bg-black border-b border-white py-2 text-center z-30 h-[50px] flex flex-col justify-center">
            <div className="font-bold text-sm text-white">{currentDay.toLocaleDateString('en-US', { weekday: 'short' })}</div>
            <div className="text-[10px] text-gray-400">{currentDay.getMonth()+1}/{currentDay.getDate()}</div>
          </div>
          <div className="w-full">{daySlots}</div>
        </div>
      )
    }

    return (
      <div className="flex border-t border-gray-700 bg-black w-full h-full">
         <div className="flex flex-col min-w-[50px] sticky left-0 z-40 border-r border-gray-700 pt-[50px] bg-black shadow-[2px_0_10px_rgba(0,0,0,0.5)]">
            {timeLabels}
         </div>
         <div className="flex flex-1 overflow-auto no-scrollbar">
            {dayColumns}
         </div>
      </div>
    )
  }

  const getDateRangeString = () => {
      if (!startDate) return 'Select Dates';
      const fmt = (d: Date) => `${d.getMonth()+1}/${d.getDate()}`;
      if (endDate) return `${fmt(startDate)} - ${fmt(endDate)}`;
      return `${fmt(startDate)} - Select End`;
  }

  return (
    <div className="h-screen bg-black text-white font-mono flex flex-col overflow-hidden" onMouseUp={() => setIsDragging(false)}>
      
      {/* TOP BAR */}
      <div className="flex-none p-4 border-b border-gray-800 bg-black z-50 space-y-3">
        {/* TITLE & LINK */}
        <div className="flex justify-between items-center">
            <h1 className="text-lg font-bold tracking-widest text-white lowercase">when2jam</h1>
        </div>
        
        {/* COMPACT INPUT ROW */}
        <div className="flex flex-col sm:flex-row gap-3">
            {/* Event Name */}
            <div className="flex-1">
                <input 
                    value={eventName} 
                    onChange={(e) => !eventId && setEventName(e.target.value)} 
                    readOnly={!!eventId} 
                    className={`w-full bg-zinc-900 border border-zinc-800 p-2 text-sm focus:border-white outline-none transition-colors ${eventId ? 'text-gray-500 cursor-default' : 'text-white'}`} 
                    placeholder="Event Name" 
                />
            </div>

            {/* User Name */}
            <div className="flex-1">
                <input value={userName} onChange={(e) => setUserName(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 p-2 text-sm focus:border-white outline-none transition-colors" placeholder="Your Name" />
            </div>

            {/* Dates */}
            <div className="flex-1 relative">
                <div onClick={() => !eventId && setShowDatePicker(!showDatePicker)} className={`w-full bg-zinc-900 border border-zinc-800 p-2 text-sm truncate ${!eventId ? 'cursor-pointer hover:border-gray-600' : 'text-gray-500'}`}>
                    {getDateRangeString()}
                </div>
                {/* Date Picker Popup */}
                {showDatePicker && !eventId && (
                    <div className="absolute top-full right-0 mt-1 bg-zinc-900 border border-gray-700 p-3 z-[60] w-64 shadow-xl">
                        <div className="flex justify-between items-center mb-2">
                            <button onClick={() => changeMonth(-1)} className="p-1">&lt;</button>
                            <span className="text-sm font-bold">{pickerMonth.toLocaleString('default', { month: 'short' })}</span>
                            <button onClick={() => changeMonth(1)} className="p-1">&gt;</button>
                        </div>
                        <div className="grid grid-cols-7 gap-1 text-center text-xs">
                            {renderMiniCalendarCells(pickerMonth, startDate, endDate, handleDayClick)}
                        </div>
                    </div>
                )}
            </div>
        </div>
      </div>

      {/* SCROLLABLE GRID AREA */}
      <div className="flex-1 overflow-auto relative">
         {renderCalendarGrid()}
      </div>

      {/* BOTTOM INFO PANEL */}
      <div className="flex-none bg-zinc-900 border-t border-zinc-700 p-4 pb-8 z-50 min-h-[140px] flex flex-col justify-between">
         
         {/* Info Section */}
         <div className="mb-4">
            {renderInfoPanel()}
         </div>

         {/* Controls */}
         <div className="flex justify-between items-center">
             <div className="flex gap-3 text-[10px] text-gray-400 uppercase">
                 <div className="flex items-center gap-1"><div className="w-2 h-2 bg-green-500"></div> You</div>
                 <div className="flex items-center gap-1"><div className="w-2 h-2 bg-white"></div> Group</div>
             </div>
             
             <div className="flex gap-2 items-center">
                {statusMsg && <span className="text-green-400 text-xs font-bold animate-pulse">{statusMsg}</span>}
                
                {eventId && (
                    <button onClick={copyLink} className="border border-gray-500 text-white px-4 py-2 text-sm font-bold uppercase hover:border-white transition-colors">
                        Copy Link
                    </button>
                )}
                
                <button 
                    onClick={handleSave} 
                    disabled={loading} 
                    className={`px-6 py-2 text-sm font-bold uppercase transition-colors disabled:opacity-50 border ${hasChanges ? 'bg-white text-black border-white hover:bg-gray-200' : 'bg-black text-white border-white hover:bg-zinc-800'}`}
                >
                    {loading ? '...' : (eventId ? 'Save' : 'Create')}
                </button>
             </div>
         </div>
      </div>

      {/* FOOTER */}
      <div className="flex-none p-4 border-t border-gray-800 bg-black text-center text-xs text-gray-500">
        made with <span className="text-white">♥</span> by kapil
      </div>

    </div>
  )
}

// --- HELPERS ---
function renderMiniCalendarCells(currentMonth: Date, start: Date | null, end: Date | null, onClick: (d: Date) => void) {
  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDay = new Date(year, month, 1).getDay()
  const cells = []
  
  for (let i=0; i<firstDay; i++) cells.push(<div key={`empty-${i}`} />)
  
  for (let d=1; d<=daysInMonth; d++) {
    const date = new Date(year, month, d)
    const sTime = start?.setHours(0,0,0,0) || 0
    const eTime = end?.setHours(0,0,0,0) || 0
    const cTime = date.setHours(0,0,0,0)
    
    let bg = ""
    if (cTime === sTime || cTime === eTime) bg = "bg-white text-black"
    else if (start && end && cTime > sTime && cTime < eTime) bg = "bg-gray-700 text-white"
    
    cells.push(
      <div key={d} onClick={() => onClick(new Date(year, month, d))} className={`p-1 cursor-pointer hover:bg-gray-800 ${bg}`}>
        {d}
      </div>
    )
  }
  return cells
}

export default function Page() {
  return (
    <Suspense fallback={<div className="h-screen bg-black text-white flex items-center justify-center">Loading...</div>}>
      <TaskmasterContent />
    </Suspense>
  )
}