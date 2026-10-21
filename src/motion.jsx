import React, { useEffect, useRef, useState } from "react";
export const SPRING_EASING = "cubic-bezier(0.22, 1.18, 0.36, 1)";
export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return reduced;
}
export function usePresence(show, duration = 170) {
  const reduced = useReducedMotion();
  const [present, setPresent] = useState(show);
  useEffect(() => {
    if (show) {
      setPresent(true);
      return;
    }
    if (reduced) {
      setPresent(false);
      return;
    }
    const timer = setTimeout(() => setPresent(false), duration);
    return () => clearTimeout(timer);
  }, [show, duration, reduced]);
  return show || present;
}
export function MotionPresence({ show, children }) {
  const present = usePresence(show);
  const previous = useRef(children);
  if (show) previous.current = children;
  return present ? (
    <div
      className="motion-presence"
      data-exiting={!show || undefined}
      inert={!show || undefined}
    >
      {show ? children : previous.current}
    </div>
  ) : null;
}
