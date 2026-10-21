import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
export const SPRING_EASING = "cubic-bezier(0.22, 1.18, 0.36, 1)";
export function useRestingHeight(ref, resting, reduced) {
  const previous = useRef({ resting, height: 0 });
  const animation = useRef(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      if (animation.current?.playState !== "running")
        previous.current.height = node.getBoundingClientRect().height;
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      animation.current?.cancel();
      node.style.removeProperty("min-height");
    };
  }, [ref]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const from =
      animation.current?.playState === "running"
        ? node.getBoundingClientRect().height
        : previous.current.height;
    const old = animation.current;
    animation.current = null;
    old?.cancel();
    node.style.removeProperty("min-height");
    const to = node.getBoundingClientRect().height;
    if (
      !reduced &&
      previous.current.resting !== resting &&
      from > 1 &&
      to > 1 &&
      Math.abs(from - to) > 1
    ) {
      node.style.setProperty("min-height", "0", "important");
      const running = node.animate(
        [
          { height: from + "px", overflow: "hidden" },
          { height: to + "px", overflow: "hidden" },
        ],
        { duration: 280, easing: SPRING_EASING },
      );
      animation.current = running;
      running.finished
        .catch(() => {})
        .finally(() => {
          if (animation.current === running) {
            animation.current = null;
            node.style.removeProperty("min-height");
          }
        });
    }
    previous.current = { resting, height: to };
  }, [ref, resting, reduced]);
}
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
