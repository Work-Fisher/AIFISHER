export function createTray({ Tray, Menu, icon, onShow, onQuit }) {
  const tray = new Tray(icon);
  tray.setToolTip('AIFISHER 画布');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示 AIFISHER', click: onShow },
      { type: 'separator' },
      { label: '退出 AIFISHER', click: onQuit },
    ]),
  );
  tray.on('click', onShow);
  return tray;
}
