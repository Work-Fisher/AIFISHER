import type { OfficialWorkflow } from './workflowManagerClient';
import { createStableElement as element } from '../design/dom';
import { officialSkillCover } from '../skills/officialSkillCovers';
// Original cover from https://www.runninghub.cn/ai-detail/2052744677727715329.
import characterCover from './assets/official-character.svg';

export function createOfficialWorkflowGallery(
  items: OfficialWorkflow[],
  onUse: (item: OfficialWorkflow) => Promise<void>,
) {
  const gallery = element('div', 'fow-gallery');
  const intro = element('div', 'fow-intro');
  intro.append(
    element('h3', '', '从角色到镜头'),
    element('p', '', '官方 SKILL 同款工作流。选一个加入画布，连接素材后运行。'),
  );
  const note = element(
    'p',
    'fow-note',
    '使用你的 RunningHub 国内站账号；加入画布不会生成，运行前确认费用。',
  );
  gallery.append(intro, note);
  const grid = element('div', 'fow-grid');
  for (const item of items) {
    const card = element('article', 'fow-card');
    card.dataset.officialWorkflow = item.id;
    const artwork = element(
      'div',
      `fow-artwork${item.categoryId === 'image' ? ' is-character' : ''}`,
    );
    const cover =
      item.id === 'official-character'
        ? characterCover
        : officialSkillCover({ slug: item.skillSlug, source: 'official' });
    if (cover) {
      const image = element('img', '');
      image.src = cover;
      image.alt = '';
      image.loading = 'lazy';
      artwork.append(image);
    } else {
      artwork.append(
        element('span', 'fow-character-mark', '角色'),
        element('span', 'fow-character-caption', '同一个人，不同镜头'),
      );
    }
    const tag = element(
      'span',
      'fow-medium',
      item.categoryId === 'image' ? '图片工作流' : '视频工作流',
    );
    artwork.append(tag);
    const body = element('div', 'fow-body');
    body.append(element('h4', '', item.name), element('p', 'fow-description', item.description));
    const flow = element('div', 'fow-flow');
    flow.append(
      element('span', '', item.inputs.join(' / ')),
      element('span', 'fow-output', item.output),
    );
    const footer = element('div', 'fow-footer');
    const status = element(
      'span',
      'fow-status',
      item.configured ? 'RunningHub 国内站已连接' : '需连接 RunningHub 国内站',
    );
    const add = element(
      'button',
      'fwm-button is-primary',
      item.configured ? '添加到画布' : '连接并使用',
    );
    add.type = 'button';
    add.setAttribute('aria-label', `${add.textContent}：${item.name}`);
    add.onclick = () => {
      if (add.disabled) return;
      add.disabled = true;
      add.textContent = '正在准备…';
      void onUse(item)
        .catch((error: unknown) => {
          status.textContent = error instanceof Error ? error.message : '准备失败，请重试。';
          status.setAttribute('role', 'alert');
        })
        .finally(() => {
          add.disabled = false;
          add.textContent = item.configured ? '添加到画布' : '连接并使用';
        });
    };
    const actions = element('div', 'fow-actions');
    if (item.sourceUrl) {
      const source = element('a', 'fow-source', '查看工作流 ↗');
      source.href = item.sourceUrl;
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      source.setAttribute('aria-label', `查看工作流：${item.name}`);
      actions.append(source);
    }
    actions.append(add);
    footer.append(status, actions);
    body.append(flow, footer);
    card.append(artwork, body);
    grid.append(card);
  }
  gallery.append(grid);
  return gallery;
}

export const officialWorkflowStyles = `
.fow-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.fow-source{font-size:12px;color:var(--af-text-secondary);text-decoration:none;white-space:nowrap}.fow-source:hover{color:var(--af-text)}.fow-source:focus-visible{outline:2px solid var(--af-info);outline-offset:4px;border-radius:2px}
.fow-gallery{padding:0}.fow-intro{display:flex;align-items:baseline;gap:8px 16px;flex-wrap:wrap;margin:0 0 4px}.fow-intro h3{font-size:18px;letter-spacing:-.02em;font-weight:650;color:var(--af-text);margin:0}.fow-intro p,.fow-note{color:var(--af-text-secondary);font-size:12px;line-height:1.6;margin:0}.fow-note{margin-bottom:14px;color:var(--af-text-secondary)}
.fow-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.fow-card{overflow:hidden;border:1px solid var(--af-border);border-radius:10px;background:var(--af-surface);display:flex;flex-direction:column;min-width:0}.fow-artwork{position:relative;aspect-ratio:2.5;flex-shrink:0;overflow:hidden;background:var(--af-surface-raised)}.fow-artwork img{width:100%;height:100%;object-fit:cover;object-position:center 44%;display:block}.fow-medium{position:absolute;left:12px;bottom:10px;padding:3px 7px;border-radius:5px;background:var(--af-media-bg);color:var(--af-media-text);font-size:11px}.fow-body{padding:14px;display:flex;flex-direction:column;flex:1;min-width:0}.fow-body h4{font-size:16px;font-weight:600;line-height:1.45;margin:0 0 6px;overflow-wrap:anywhere;color:var(--af-text)}.fow-description{color:var(--af-text-secondary);font-size:12px;line-height:1.65;margin:0 0 10px}.fow-flow{border-top:1px solid var(--af-border);padding:10px 0;display:flex;align-items:center;justify-content:space-between;gap:10px;color:var(--af-text-secondary);font-size:11px;line-height:1.5;margin-top:auto}.fow-output{color:var(--af-text);white-space:nowrap}.fow-output:before{content:'→';margin-right:12px;color:var(--af-text-muted)}.fow-footer{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px}.fow-actions .fwm-button{min-height:32px;padding:6px 12px;font-size:12px}.fow-actions{margin-left:auto}.fow-status{font-size:11px;line-height:1.6;color:var(--af-text-muted);overflow-wrap:anywhere}.fow-status[role=alert]{color:var(--af-danger)}.fow-character-mark{font-size:64px;letter-spacing:.22em;color:var(--af-text);font-weight:300}.fow-character-caption{font-size:12px;letter-spacing:.1em;color:var(--af-text-secondary)}.fow-artwork.is-character{display:flex;align-items:center;justify-content:center;gap:28px;background:linear-gradient(115deg,var(--af-surface-raised),var(--af-surface))}
.fwm-library-navigation{display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--af-border);padding:0 0 12px;margin-bottom:14px}.fwm-library-navigation button{border:0;border-radius:8px;background:transparent;color:var(--af-text-secondary);padding:8px 12px;cursor:pointer;font:inherit;font-size:13px}.fwm-library-navigation button[aria-pressed=true]{background:var(--af-primary);color:var(--af-on-primary)}.fwm-library-navigation button:focus-visible{outline:2px solid var(--af-info);outline-offset:3px}.fwm-library-panel .fwm-library-toolbar h4{font-size:18px}.fwm-library-panel .fwm-card-meta{font-size:11px;line-height:1.6}.fwm-library-panel .fwm-workflow-card{border-radius:14px}
@media(max-width:900px){.fow-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:640px){.fow-grid{grid-template-columns:1fr}.fow-intro{gap:10px}.fow-intro h3{font-size:18px}.fow-body{padding:14px}.fow-footer{flex-wrap:wrap}.fwm-library-navigation{overflow-x:auto}.fwm-library-navigation button{white-space:nowrap;padding:10px 12px}.fow-character-mark{font-size:48px}.fow-character-caption{display:none}}
`;
