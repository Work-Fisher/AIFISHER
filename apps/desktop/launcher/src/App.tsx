import { useEffect, useRef, useState } from 'react';
import { StartupStatus } from './StartupStatus';
import { UpdateDownloadFallback } from './UpdateDownloadFallback';
import { desktopShell } from './desktopShell';
import { createCanvasEntry } from './canvasEntry';

export default function App() {
  const started = useRef(false);
  const working = useRef(false);
  const [problem, setProblem] = useState('');
  const [entry] = useState(() => createCanvasEntry({
    prepare: () => desktopShell().canvas.prepare(),
    open: userInitiated => desktopShell().canvas.open(userInitiated),
  }));
  async function enter(userInitiated = false) {
    if (working.current) return;
    working.current = true;
    setProblem('');
    try {
      // This only reads/creates the encrypted local device identity; it never waits for the network.
      await desktopShell().identity.restore();
      entry.reset();
      const result = await entry.open(userInitiated);
      if (!result?.opened) setProblem(result?.message || '本机工作区未能打开，请重试。');
    } catch (error) {
      setProblem(error instanceof Error ? error.message : '无法读取本机工作区，请保留原数据并重试。');
    } finally {
      working.current = false;
    }
  }
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void enter();
    // The entry coordinator prevents duplicate opens; StrictMode must not initialize twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!problem) return <StartupStatus message="正在打开你的工作台…" />;
  return <main className="auth-shell">
    <section className="auth-stage" aria-label="打开工作区">
      <section className="auth-card">
        <h1>AIFISHER</h1>
        <p role="alert">{problem}</p>
        <p>项目与 API Key 保留在本机，无需注册或登录。</p>
        <button className="primary-button" onClick={() => void enter(true)}>重试打开画布</button>
        <UpdateDownloadFallback />
      </section>
    </section>
  </main>;
}
