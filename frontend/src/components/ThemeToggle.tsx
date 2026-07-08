import type { Theme } from "../theme";

export default function ThemeToggle({
  theme,
  onToggle,
  className,
}: {
  theme: Theme;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      className={`theme-toggle${className ? ` ${className}` : ""}`}
      onClick={onToggle}
      aria-label={
        theme === "light" ? "Switch to dark mode" : "Switch to light mode"
      }
      title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
    >
      {theme === "light" ? "☀️" : "🌙"}
    </button>
  );
}
