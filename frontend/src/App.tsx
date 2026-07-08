import { useState } from "react";
import { clearToken, getToken } from "./api";
import Dashboard from "./Dashboard";
import Login from "./Login";
import { useTheme } from "./theme";

export default function App() {
  const [authed, setAuthed] = useState<boolean>(() => getToken() !== null);
  const [theme, toggleTheme] = useTheme();

  if (!authed)
    return (
      <Login
        onLogin={() => setAuthed(true)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );

  return (
    <Dashboard
      theme={theme}
      onToggleTheme={toggleTheme}
      onLogout={() => {
        clearToken();
        setAuthed(false);
      }}
    />
  );
}
