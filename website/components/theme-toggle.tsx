"use client";

import { useTheme } from 'fumadocs-ui/provider/base';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentTheme = mounted && resolvedTheme === 'light' ? 'light' : 'dark';

  function toggleTheme() {
    setTheme(currentTheme === 'dark' ? 'light' : 'dark');
  }

  return (
    <button
      type="button"
      className="icon-btn"
      aria-label="Toggle theme"
      aria-pressed={currentTheme === 'dark'}
      title="Toggle theme"
      onClick={toggleTheme}
    >
      {currentTheme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}
