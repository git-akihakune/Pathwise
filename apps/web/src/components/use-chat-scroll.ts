"use client";

import { useEffect, useRef, useState } from "react";

/** Follow new replies only while the reader is already near the conversation's end. */
export function useChatScroll(messages: readonly unknown[]) {
  const end = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [away, setAway] = useState(false);
  useEffect(() => {
    const scroll = () => {
      const bottom = end.current?.getBoundingClientRect().bottom ?? 0;
      following.current = bottom <= window.innerHeight + 180;
      setAway(!following.current);
    };
    window.addEventListener("scroll", scroll, { passive: true });
    return () => window.removeEventListener("scroll", scroll);
  }, []);
  useEffect(() => {
    if (messages.length > 0 && following.current)
      end.current?.scrollIntoView({ block: "end", behavior: "instant" });
  }, [messages]);
  const latest = () => {
    following.current = true;
    end.current?.scrollIntoView({ block: "end", behavior: "instant" });
    setAway(false);
  };
  return {
    end,
    away,
    latest,
    pause: () => {
      following.current = false;
    },
  };
}
