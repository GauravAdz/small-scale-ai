"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  // `resolvedTheme` is undefined until hydration; rendering the icon before
  // then guarantees a mismatch, so hold a same-sized placeholder instead.
  React.useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="size-11" aria-hidden />;
  }

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      className="min-h-11 min-w-11"
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
      title={`Switch to ${isDark ? "light" : "dark"} theme`}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
