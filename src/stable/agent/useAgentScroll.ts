import { useLayoutEffect, useRef, useState } from 'react';

/** Follow the tail only while the reader is there, including late media/tool layout. */
export function useAgentScroll(threadKey: string, revision: unknown, open: boolean) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const followLatest = () => {
    following.current = true;
    setShowLatest(false);
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  };
  useLayoutEffect(() => {
    following.current = true;
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
    // Session changes start at their latest message.
    const reset = () => setShowLatest(false);
    reset();
  }, [threadKey, open]);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content || !open) return;
    const onScroll = () => {
      following.current = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 64;
      setShowLatest(!following.current);
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) following.current = false;
    };
    const resize = () => {
      if (following.current) viewport.scrollTop = viewport.scrollHeight;
    };
    viewport.addEventListener('scroll', onScroll);
    viewport.addEventListener('wheel', onWheel, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(content);
    observer?.observe(viewport);
    return () => {
      viewport.removeEventListener('scroll', onScroll);
      viewport.removeEventListener('wheel', onWheel);
      observer?.disconnect();
    };
  }, [open]);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport && following.current) viewport.scrollTop = viewport.scrollHeight;
  }, [revision]);
  return { viewportRef, contentRef, showLatest, followLatest };
}
