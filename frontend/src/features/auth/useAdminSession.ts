import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  getAdminSession,
  loginAdmin,
  logoutAdmin,
} from "../../api/client";
export function useAdminSession() {
  const [status, setStatus] = useState<
    "checking" | "authenticated" | "anonymous"
  >("checking");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);
  const epoch = useRef(0);
  const expire = useCallback(() => {
    epoch.current++;
    setStatus("anonymous");
    setSubmitting(false);
    if (window.location.pathname.startsWith("/admin"))
      window.history.replaceState({}, "", "/admin/login");
  }, []);
  useEffect(() => {
    const id = ++epoch.current;
    getAdminSession().then(
      () => {
        if (epoch.current === id) {
          setStatus("authenticated");
          if (["/admin", "/admin/login"].includes(window.location.pathname))
            window.history.replaceState({}, "", "/admin/dashboard");
        }
      },
      () => {
        if (epoch.current === id) expire();
      },
    );
    return () => {
      epoch.current++;
    };
  }, [expire]);
  async function login(username: string, password: string) {
    if (isSubmitting) return;
    const id = ++epoch.current;
    setError(null);
    setSubmitting(true);
    try {
      await loginAdmin(username, password);
      if (id === epoch.current) {
        setStatus("authenticated");
        window.history.pushState({}, "", "/admin/dashboard");
      }
    } catch (caught) {
      if (id === epoch.current)
        setError(
          caught instanceof ApiError && caught.status === 429
            ? "Too many login attempts. Please wait 5 seconds and try again."
            : caught instanceof ApiError && caught.status !== 401
              ? caught.message
              : "The login information you entered is incorrect.",
        );
    } finally {
      if (id === epoch.current) setSubmitting(false);
    }
  }
  async function logout() {
    expire();
    try {
      await logoutAdmin();
    } catch {
      /* Local session has already been cleared. */
    }
  }
  return {
    status,
    error,
    isSubmitting,
    login,
    logout,
    expire,
    clearError: () => setError(null),
  };
}
