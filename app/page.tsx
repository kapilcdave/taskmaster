'use client';

import { useEffect, useState } from 'react';

export default function Home() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchEvents = async () => {
      const { supabase } = await import('./lib/supabaseClient');
      if (!supabase) {
        console.warn('Supabase client not configured');
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.from('events').select('event_name');
      if (error) {
        console.error('Error fetching events:', error);
      } else {
        setEvents(data || []);
        console.log('Fetched events:', data);
      }
      setLoading(false);
    };

    fetchEvents();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
        <h1 className="max-w-xs text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
          TaskMaster Events
        </h1>
        {loading ? (
          <p>Loading events...</p>
        ) : (
          <ul>
            {events.map((event) => (
              <li key={event.id}>{event.event_name}</li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
