export interface FeedbackAttachment { name: string; data: string }
export interface AttachmentMetadata { name: string; size: number; mime: string }
const ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.markdown,.log,.csv,.json,.srt,.vtt';
export function createFeedbackAttachments(pasteTarget: HTMLElement) {
  const root = document.createElement('fieldset');
  root.style.cssText = 'border:0;padding:0;margin:12px 0';
  const picker = document.createElement('input');
  picker.type = 'file'; picker.multiple = true; picker.accept = ACCEPT; picker.hidden = true;
  const add = document.createElement('button'); add.type = 'button'; add.textContent = '添加图片 / 文本 / 工作流';
  add.className = 'aifisher-feedback-button';
  const hint = document.createElement('p');
  hint.style.cssText = 'font-size:12px;line-height:1.6;color:var(--af-text-muted);margin:8px 0';
  hint.textContent = '支持图片、TXT、Markdown、日志、CSV、字幕，以及 ComfyUI 工作流 JSON（含 API 格式）。可选择或拖入文件，也可粘贴图片。最多 5 个，单个 2 MB，总计 6 MB。';
  const workflowHint = document.createElement('p');
  workflowHint.style.cssText = 'font-size:13px;line-height:1.7;color:var(--af-warning);margin:8px 0';
  const workflowTitle = document.createElement('strong');
  workflowTitle.textContent = '本地 ComfyUI 报错，请务必上传报错工作流（JSON / API 格式）。';
  workflowHint.append(workflowTitle, document.createElement('br'), '请同时附上报错截图或日志，方便复现问题、定位原因并修复同类问题。');
  const list = document.createElement('div'); list.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  const error = document.createElement('p'); error.setAttribute('role', 'status');
  root.append(add, picker, hint, workflowHint, list, error);
  const entries: Array<{ file: File; attachment: FeedbackAttachment }> = [];
  let pending = Promise.resolve();
  const draw = () => {
    list.replaceChildren();
    entries.forEach((entry, index) => {
      const card = document.createElement('div');
      card.style.cssText = 'display:flex;align-items:center;gap:8px;max-width:100%;padding:8px;border:1px solid var(--af-border);border-radius:8px;background:var(--af-surface-raised);font-size:12px';
      if (/\.(png|jpe?g|webp|gif)$/i.test(entry.file.name)) {
        const image = document.createElement('img');
        image.src = `data:${entry.file.type || 'image/png'};base64,${entry.attachment.data}`;
        image.alt = entry.file.name; image.style.cssText = 'width:64px;height:64px;object-fit:cover;border-radius:6px';
        card.append(image);
      }
      const label = document.createElement('span'); label.textContent = entry.file.name;
      label.title = entry.file.name; label.style.cssText = 'max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '移除'; remove.className = 'aifisher-feedback-button';
      remove.onclick = () => { entries.splice(index, 1); error.textContent = ''; draw(); };
      card.append(label, remove); list.append(card);
    });
  };
  const append = (files: File[]) => {
    if (root.disabled) return;
    pending = pending.then(async () => {
      error.textContent = '';
      for (const file of files) {
        if (!ACCEPT.split(',').includes('.' + file.name.split('.').pop()?.toLowerCase())) { error.textContent = `不支持此文件：${file.name}`; continue; }
        if (!file.size || file.size > 2 * 1024 * 1024 || entries.length >= 5 || entries.reduce((sum, item) => sum + item.file.size, file.size) > 6 * 1024 * 1024) { error.textContent = '附件超出数量或大小限制。'; continue; }
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(new Error('附件读取失败，请重新添加。')); reader.readAsDataURL(file);
        });
        entries.push({ file, attachment: { name: file.name, data } }); draw();
      }
    }).catch(cause => { error.textContent = cause instanceof Error ? cause.message : '附件读取失败'; });
  };
  add.onclick = () => picker.click();
  picker.onchange = () => { append(Array.from(picker.files || [])); picker.value = ''; };
  pasteTarget.addEventListener('paste', event => { if (event.clipboardData?.files.length) { event.preventDefault(); append(Array.from(event.clipboardData.files)); } });
  pasteTarget.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
  pasteTarget.addEventListener('drop', event => { if (event.dataTransfer?.files.length) { event.preventDefault(); event.stopPropagation(); append(Array.from(event.dataTransfer.files)); } });
  return { root, async read() { await pending; if (error.textContent) throw new Error(error.textContent); return entries.map(entry => entry.attachment); } };
}

export function feedbackAttachmentButtons(items: AttachmentMetadata[], load: (index: number) => Promise<AttachmentMetadata & FeedbackAttachment>) {
  const root = document.createElement('div');
  items.forEach((item, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = `附件：${item.name}`;
    button.onclick = async () => {
      button.disabled = true;
      try {
        const attachment = await load(index);
        const bytes = Uint8Array.from(atob(attachment.data), c => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: attachment.mime }));
        const download = document.createElement('a'); download.href = url; download.download = attachment.name; download.textContent = '下载原文件';
        root.append(download);
        if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(attachment.mime)) {
          const image = document.createElement('img'); image.src = url; image.alt = attachment.name; image.style.cssText = 'max-width:280px;max-height:240px;object-fit:contain'; root.append(image);
        }
        // The download remains usable during review; refresh/reopen to fetch it again.
        setTimeout(() => { URL.revokeObjectURL(url); download.remove(); button.disabled = false; }, 60_000);
      } catch { button.textContent = `读取失败，点击重试：${item.name}`; button.disabled = false; }
    };
    root.append(button);
  });
  return root;
}
