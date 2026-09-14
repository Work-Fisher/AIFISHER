export const UPDATE_DOWNLOAD_URL = 'https://pan.quark.cn/s/4902ac63461c';

/** Shared by the launcher and canvas update surfaces; never starts an installation. */
export function createUpdateDownloadFallback(documentRoot: Document) {
  const section = documentRoot.createElement('section');
  section.setAttribute('data-update-download-fallback', 'true');
  section.style.cssText = 'margin-top:16px;padding-top:16px;border-top:1px solid var(--af-border,#3a3a3a);font:500 13px/1.6 system-ui;color:var(--af-text-secondary,#d4d4d4)';
  const title = documentRoot.createElement('strong');
  title.textContent = '手动下载安装包';
  title.style.cssText = 'display:block;color:var(--af-text,#f2f2f2);font-size:14px';
  const description = documentRoot.createElement('p');
  description.textContent = '自动更新未成功时，可从夸克网盘下载安装包。';
  description.style.cssText = 'margin:6px 0 12px;color:var(--af-text-secondary,#a3a3a3)';
  const link = documentRoot.createElement('a');
  link.href = UPDATE_DOWNLOAD_URL;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = '打开夸克网盘';
  link.style.cssText = 'display:inline-block;color:var(--af-text,#f2f2f2);text-decoration:none;padding:8px 12px;border:1px solid var(--af-border,#525252);border-radius:8px';
  const copy = documentRoot.createElement('button');
  copy.type = 'button';
  copy.textContent = '复制下载链接';
  copy.style.cssText = 'width:auto;margin:0 0 0 8px;padding:8px 12px;border:1px solid var(--af-border,#525252);border-radius:8px;background:var(--af-surface,#262626);color:var(--af-text,#f2f2f2);font:inherit;cursor:pointer';
  const address = documentRoot.createElement('input');
  address.readOnly = true;
  address.value = UPDATE_DOWNLOAD_URL;
  address.setAttribute('aria-label', '安装包下载链接');
  address.style.cssText = 'display:block;box-sizing:border-box;width:100%;margin-top:10px;border:0;background:transparent;color:var(--af-text-secondary,#a3a3a3);font:12px/1.6 system-ui';
  const status = documentRoot.createElement('span');
  status.setAttribute('role', 'status');
  status.style.cssText = 'display:block;color:var(--af-text-secondary,#a3a3a3);font-size:12px';
  copy.onclick = async () => {
    try {
      await documentRoot.defaultView!.navigator.clipboard.writeText(UPDATE_DOWNLOAD_URL);
      copy.textContent = '已复制';
      status.textContent = '下载链接已复制';
    } catch {
      address.focus();
      address.select();
      status.textContent = '链接已选中，请按 Ctrl+C 复制。';
    }
  };
  section.append(title, description, link, copy, address, status);
  return section;
}
