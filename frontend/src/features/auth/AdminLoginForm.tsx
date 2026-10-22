import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/Fields";
import type { useAdminSession } from "./useAdminSession";
import styles from "./AdminLoginForm.module.css";
export function AdminLoginForm({
  session,
}: {
  session: ReturnType<typeof useAdminSession>;
}): JSX.Element {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  return (
    <section className={styles.panel}>
      <p className={styles.eyebrow}>ADMINISTRATION</p>
      <h1>Admin sign in</h1>
      <p>Sign in to manage providers, indexing, and approved tags.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void session.login(username, password);
        }}
      >
        <TextField
          label="Username"
          autoComplete="username"
          value={username}
          isRequired
          onChange={(value) => {
            setUsername(value);
            session.clearError();
          }}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          isRequired
          onChange={(value) => {
            setPassword(value);
            session.clearError();
          }}
        />
        {session.error && <p role="alert">{session.error}</p>}
        <Button
          type="submit"
          variant="primary"
          isDisabled={session.isSubmitting}
        >
          {session.isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </section>
  );
}
