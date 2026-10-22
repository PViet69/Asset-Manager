import { useEffect, useRef } from "react";
// Every asynchronous controller captures this generation before issuing work.
export function useRequestScope(enabled: boolean) {
  const scope = useRef({ enabled, generation: 0 });
  scope.current.enabled = enabled;
  useEffect(() => {
    scope.current.generation++;
    return () => {
      scope.current.generation++;
    };
  }, [enabled]);
  return {
    capture: () => scope.current.generation,
    current: (generation: number) =>
      scope.current.enabled && scope.current.generation === generation,
  };
}
