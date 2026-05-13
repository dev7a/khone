"use client";

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const stored = window.localStorage.getItem('khone-theme') ?? window.localStorage.getItem('theme');
    const initial = stored === 'light' ? 'light' : 'dark';

    root.classList.toggle('dark', initial === 'dark');
    root.setAttribute('data-theme', initial);
    setTheme(initial);
    setMounted(true);
  }, []);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', next === 'dark');
    document.documentElement.setAttribute('data-theme', next);
    window.localStorage.setItem('khone-theme', next);
    window.localStorage.setItem('theme', next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      className="icon-btn"
      aria-label="Toggle theme"
      title="Toggle theme"
      onClick={toggleTheme}
    >
      {mounted && theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}
