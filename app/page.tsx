'use client'

import React, { useState, useEffect, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// --- CONSTANTS ---
const START_HOUR = 8
const END_HOUR = 20
const SLOTS_PER_HOUR = 4
const SLOT_HEIGHT = 16
const MAX_DAYS = 7

// --- TYPES ---
type ResponseData = {
  user_name: string
  availability: number[]
}

function TaskmasterContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  
  // STATE: Core
  const [eventId, setEventId] = useState<string | null>(null)
  const [eventName, setEventName] = useState('Team Sync')
  const [userName, setUserName] = useState('')
  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')

  // STATE: Dates
  const [startDate, setStartDate] = useState<Date | null>(new Date())
  const [endDate, setEndDate] = useState<Date | null>(() => {
    const d = new Date()
    d.setDate(d.getDate() + 2) 
    return d
  })
  
  // STATE: UI & Grid
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [pickerMonth, setPickerMonth] = useState(new Date())
  const [myGrid, setMyGrid] = useState<number[]>([])
  const [groupResponses, setGroupResponses] = useState<ResponseData[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [paintMode, setPaintMode] = useState(true)
  
  // STATE: Hover Info
  const [hoveredNames, setHoveredNames] = useState<string>('')

  // --- EFFECTS ---

  useEffect(() => {
    const id = searchParams.get('id')
    if (id) {
      setEventId(id)
      loadEvent(id)
    } else {
      initializeGrid(3)
    }
  }, [searchParams])

  useEffect(() => {
    if (!eventId) return
    fetchResponses(eventId)
    
    // Realtime Listener
    const channel = supabase
      .channel('room1')
      .on('postgres_changes', { 
        event: '*', schema: 'public', table: 'responses', filter: `event_id=eq.${eventId}` 
      }, () => {
        console.log("Change detected, refreshing...")
        fetchResponses(eventId)
      })
      .subscribe()
      
    return () => { supabase.removeChannel(channel) }
  }, [eventId])

  // --- LOGIC: DATA ---

  const loadEvent = async (id: string) => {
    setLoading(true)
    const { data, error } = await supabase.from('events').select('*').eq('id', id).single()
    
    if (error) {
        console.error("Error loading event:", error)
        alert("Could not load event. Check console.")
        setLoading(false)
        return
    }

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
    if (!userName.trim()) return alert("Please enter your name first.")
    setLoading(true)

    if (!eventId) {
      if (!startDate || !endDate) return
      
      // 1. Create Event
      const { data: eventData, error } = await supabase
        .from('events')
        .insert({ name: eventName, start_date: startDate.toISOString(), end_date: endDate.toISOString() })
        .select().single()

      if (error) {
        console.error(error)
        alert(`Failed to create event: ${error.message}`)
        setLoading(false)
        return
      }
      
      const newId = eventData.id
      
      // 2. Save Creator's Response
      await saveResponse(newId)
      
      router.push(`?id=${newId}`)
      setEventId(newId)
      setStatusMsg("Event Created!")
    } else {
      // Update Existing Response
      await saveResponse(eventId)
      setStatusMsg("Availability Saved!")
    }
    setLoading(false)
    setTimeout(() => setStatusMsg(''), 3000)
  }

  const saveResponse = async (eid: string) => {
    const { error } = await supabase.from('responses').upsert({
      event_id: eid, user_name: userName, availability: myGrid
    }, { onConflict: 'event_id, user_name' })

    if (error) {
        console.error("Save error:", error)
        alert("Error saving availability. Check console.")
    }
  }

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    setStatusMsg("Link Copied!")
    setTimeout(() => setStatusMsg(''), 2000)
  }

  // --- LOGIC: HEATMAP & INTERACTION ---

  const heatmap = useMemo(() => {
    if (groupResponses.length === 0) return null
    const map = new Array(myGrid.length).fill(0)
    groupResponses.forEach(r => {
      // Ensure array exists before mapping
      if(r.availability) {
          r.availability.forEach((val: number, i: number) => {
            if (map[i] !== undefined) map[i] += val
          })
      }
    })
    return map
  }, [groupResponses, myGrid.length])

  // Calculate who is free at a specific index
  const getNamesForSlot = (index: number) => {
      const names = groupResponses
        .filter(r => r.availability && r.availability[index] === 1)
        .map(r => r.user_name)
      
      // Also check if "I" am free (local state might be newer than DB state)
      if (myGrid[index] === 1 && !names.includes(userName) && userName) {
          names.push(userName + " (You)")
      }

      if (names.length === 0) return "No one is available"
      return names.join(", ") + " available"
  }

  const handleSlotHover = (index: number) => {
      // Update Tooltip
      setHoveredNames(getNamesForSlot(index))

      // Drag Paint Logic
      if (isDragging) {
          updateLocalGrid(index, paintMode ? 1 : 0)
      }
  }

  const handleSlotMouseDown = (index: number) => {
    setIsDragging(true)
    const newVal = myGrid[index] === 0 ? 1 : 0
    setPaintMode(newVal === 1)
    updateLocalGrid(index, newVal)
  }

  const updateLocalGrid = (index: number, val: number) => {
    const newGrid = [...myGrid]
    newGrid[index] = val
    setMyGrid(newGrid)
  }

  // Date Picker Logic
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

  const renderCalendarGrid = () => {
    if (!startDate) return null
    const days = endDate ? Math.ceil(Math.abs(endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1 : 1
    
    const timeLabels = []
    for(let h=START_HOUR; h<END_HOUR; h++) {
      for(let s=0; s<SLOTS_PER_HOUR; s++) {
        const isHour = s === 0
        const label = (h === 12 && isHour) ? '12 PM' : (isHour ? `${h > 12 ? h-12 : h} ${h >= 12 ? 'PM' : 'AM'}` : '')
        timeLabels.push(
          <div key={`t-${h}-${s}`} className="flex justify-end pr-2 text-[0.7rem] text-white font-bold relative box-border" style={{ height: SLOT_HEIGHT }}>
             {isHour && <span className="bg-black -mt-2 pb-1 z-10">{label}</span>}
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
        const isHourStart = i % 4 === 0
        
        // Heatmap Visuals
        let bgStyle = {}
        const count = (heatmap && heatmap[globalIndex]) || 0
        const max = groupResponses.length || 1
        
        if (eventId && count > 0) {
           const intensity = count / max
           // White with opacity based on popularity
           bgStyle = { backgroundColor: `rgba(255, 255, 255, ${intensity})` }
        }
        
        daySlots.push(
          <div key={`s-${globalIndex}`} 
            onMouseDown={() => handleSlotMouseDown(globalIndex)} 
            onMouseEnter={() => handleSlotHover(globalIndex)}
            className={`border-b border-gray-800 box-border cursor-crosshair relative w-full ${isHourStart ? 'border-b-white/40' : ''} ${isSelected ? '!bg-green-400 !border-green-400' : ''}`}
            style={{ height: SLOT_HEIGHT, ...bgStyle }} 
          />
        )
      }
      dayColumns.push(
        <div key={`d-${d}`} className="flex flex-col min-w-[80px] flex-1">
          <div className="sticky top-0 bg-black border-b border-white py-4 text-center z-20">
            <div className="font-bold text-sm text-white">{currentDay.toLocaleDateString('en-US', { weekday: 'short' })}</div>
            <div className="text-xs text-gray-400">{currentDay.getMonth()+1}/{currentDay.getDate()}</div>
          </div>
          <div className="w-full">{daySlots}</div>
        </div>
      )
    }
    return (
      <div className="flex border border-gray-700 bg-gray-900 gap-px overflow-x-auto max-w-full w-full no-scrollbar">
         <div className="flex flex-col min-w-[50px] bg-black sticky left-0 z-30 border-r border-gray-700 pt-[66px]">{timeLabels}</div>
         <div className="flex flex-1 min-w-0">{dayColumns}</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white font-mono flex flex-col items-center py-10 px-4 select-none w-full relative" onMouseUp={() => setIsDragging(false)}>
      
      {/* HEADER */}
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 pb-6 border-b border-gray-800">
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 font-bold mb-2 uppercase tracking-widest">Event Name</label>
          <input value={eventName} onChange={(e) => !eventId && setEventName(e.target.value)} readOnly={!!eventId} className={`bg-transparent border-b border-gray-800 py-2 outline-none text-lg focus:border-white transition-colors w-full ${eventId ? 'text-gray-400 cursor-default' : ''}`} placeholder="Event Name" />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 font-bold mb-2 uppercase tracking-widest">Your Name</label>
          <input value={userName} onChange={(e) => setUserName(e.target.value)} className="bg-transparent border-b border-gray-800 py-2 outline-none text-lg focus:border-white transition-colors placeholder-gray-700 w-full" placeholder="Required" />
        </div>
        <div className="flex flex-col relative">
          <label className="text-xs text-gray-500 font-bold mb-2 uppercase tracking-widest">Time Period</label>
          <div onClick={() => !eventId && setShowDatePicker(!showDatePicker)} className={`border-b border-gray-800 py-2 text-lg cursor-pointer flex justify-between items-center w-full ${eventId ? 'cursor-default text-gray-400' : ''}`}>
            <span>{startDate ? `${startDate.getMonth()+1}/${startDate.getDate()}` : 'Select'} {' - '} {endDate ? `${endDate.getMonth()+1}/${endDate.getDate()}` : (startDate ? 'Select End' : '')}</span>
            {!eventId && <span className="text-xs text-gray-600">▼</span>}
          </div>
          
          {/* DATE PICKER */}
          {showDatePicker && !eventId && (
            <div className="absolute top-20 right-0 bg-black border border-gray-600 p-4 z-50 w-72 shadow-2xl">
               <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-800">
                  <button onClick={() => changeMonth(-1)} className="text-gray-400 hover:text-white px-2">&lt;</button>
                  <span className="font-bold uppercase">{pickerMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}</span>
                  <button onClick={() => changeMonth(1)} className="text-gray-400 hover:text-white px-2">&gt;</button>
               </div>
               <div className="grid grid-cols-7 gap-1 text-center mb-2">{['S','M','T','W','T','F','S'].map(d => <div key={d} className="text-xs text-gray-600">{d}</div>)}</div>
               <div className="grid grid-cols-7 gap-1">{renderMiniCalendarCells(pickerMonth, startDate, endDate, handleDayClick)}</div>
               <div className="text-center text-xs text-gray-500 mt-4">Max Duration: 7 Days</div>
            </div>
          )}
        </div>
      </div>

      {/* GRID */}
      <div className="w-full max-w-4xl overflow-hidden relative" onMouseLeave={() => setHoveredNames('')}>
         {renderCalendarGrid()}
         
         {/* HOVER TOOLTIP (Floating Status Bar) */}
         <div className="fixed bottom-0 left-0 w-full bg-zinc-900 border-t border-zinc-700 p-4 text-center z-50">
            <span className="text-sm font-bold text-white uppercase tracking-widest">
               {hoveredNames || "Hover over the grid to see availability"}
            </span>
         </div>
      </div>

      {/* FOOTER ACTIONS */}
      <div className="w-full max-w-4xl mt-8 pt-6 border-t border-gray-800 flex flex-col md:flex-row justify-between items-center gap-4 mb-20">
         <div className="flex gap-4">
             <div className="flex items-center gap-2 text-xs text-gray-500"><div className="w-3 h-3 bg-green-400"></div> You</div>
             <div className="flex items-center gap-2 text-xs text-gray-500"><div className="w-3 h-3 bg-white"></div> Group Heatmap</div>
         </div>
         <div className="flex gap-4 items-center w-full md:w-auto justify-center">
            {statusMsg && <span className="text-green-400 text-xs font-bold tracking-widest uppercase animate-pulse">{statusMsg}</span>}
            {eventId && <button onClick={copyLink} className="border border-gray-600 hover:border-white text-white px-4 py-3 text-sm font-bold uppercase transition-colors whitespace-nowrap">Copy Link</button>}
            <button onClick={handleSave} disabled={loading} className="bg-white text-black px-4 py-3 text-sm font-bold uppercase hover:bg-gray-300 transition-colors disabled:opacity-50 whitespace-nowrap">{loading ? 'Saving...' : (eventId ? 'Update Availability' : 'Create Event')}</button>
         </div>
      </div>
    </div>
  )
}

// --- HELPERS ---
function renderMiniCalendarCells(currentMonth: Date, start: Date | null, end: Date | null, onClick: (d: Date) => void) {
  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const prevMonthDays = new Date(year, month, 0).getDate()
  const cells = []
  
  for (let i=firstDay-1; i>=0; i--) cells.push(<div key={`prev-${i}`} className="aspect-square flex items-center justify-center text-gray-800 text-sm cursor-default">{prevMonthDays - i}</div>)
  for (let d=1; d<=daysInMonth; d++) {
    const date = new Date(year, month, d)
    date.setHours(0,0,0,0)
    const sTime = start ? new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime() : 0
    const eTime = end ? new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime() : 0
    const cTime = date.getTime()
    let classes = "text-gray-300 hover:border hover:border-gray-500"
    if (cTime === sTime || cTime === eTime) classes = "bg-white text-black font-bold"
    else if (start && end && cTime > sTime && cTime < eTime) classes = "bg-gray-800 text-white"
    cells.push(<div key={`curr-${d}`} onClick={() => onClick(date)} className={`aspect-square flex items-center justify-center text-sm cursor-pointer border border-transparent transition-all ${classes}`}>{d}</div>)
  }
  const remaining = 42 - cells.length
  for (let i=1; i<=remaining; i++) cells.push(<div key={`next-${i}`} className="aspect-square flex items-center justify-center text-gray-800 text-sm cursor-default">{i}</div>)
  return cells
}

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black text-white flex items-center justify-center">Loading...</div>}>
      <TaskmasterContent />
    </Suspense>
  )
}