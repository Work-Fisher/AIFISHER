import { preventFileDropNavigation } from '../../shared/fileDrop';
import '../main';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { CanvasRoot } from './canvasRuntime';
import './canvas.css';
import '../appearance/appearance.css';

const element = document.getElementById('root');
if (!element) throw new Error('画布根容器不存在。');
preventFileDropNavigation();
if (window.aifisherDesktop?.integratedTitleBar) document.documentElement.dataset.afIntegratedTitlebar = 'true';
createRoot(element).render(
  <React.StrictMode>
    <CanvasRoot />
  </React.StrictMode>,
);
