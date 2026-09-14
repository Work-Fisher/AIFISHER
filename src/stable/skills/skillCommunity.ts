import { activateModal } from '../design/modalFocus';
import type { AgentSkill, AgentSkillClient } from './skillClient';
import {
  officialSkillCover,
  officialSkillVideo,
  appendOfficialSkillPreview,
} from './officialSkillCovers';
import { createOfficialSkillGuide, OFFICIAL_SKILL_GUIDE_STYLES } from './officialSkillGuide';

const OPEN_EVENT = 'fisherai:open-skill-community';
const STYLE_ID = 'fisherai-skill-community-styles';
const DIALOG_ATTRIBUTE = 'data-fisherai-skill-community';
const MENU_ATTRIBUTE = 'data-fisherai-skill-menu';

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    ${OFFICIAL_SKILL_GUIDE_STYLES}
    .fisher-skill-overlay{position:fixed;inset:0;z-index:10020;display:grid;place-items:center;padding:28px;background:var(--af-overlay);font-family:Inter,"Microsoft YaHei UI",system-ui,sans-serif}
    .fisher-skill-dialog{width:min(1040px,calc(100vw - 56px));max-height:min(780px,calc(100vh - 56px));display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--af-border);border-radius:18px;background:var(--af-surface);color:var(--af-text);box-shadow:var(--af-shadow)}
    .fisher-skill-head{display:flex;align-items:center;gap:18px;padding:24px 26px;border-bottom:1px solid var(--af-border)}
    .fisher-skill-title{margin:0;font-size:22px;line-height:1.2;font-weight:760;letter-spacing:-.02em}
    .fisher-skill-subtitle{margin:6px 0 0;color:var(--af-text-muted);font-size:13px}
    .fisher-skill-actions{margin-left:auto;display:flex;align-items:center;gap:10px}
    .fisher-skill-button{height:40px;padding:0 16px;border:1px solid var(--af-border-control);border-radius:10px;background:var(--af-surface);color:var(--af-text);font-weight:650;cursor:pointer;white-space:nowrap;flex-shrink:0}
    .fisher-skill-button:hover{border-color:var(--af-border-control);background:var(--af-surface-raised)}
    .fisher-skill-button.is-primary{border-color:var(--af-border-control);background:var(--af-primary);color:var(--af-on-primary)}
    .fisher-skill-close{width:40px;padding:0;font-size:22px;font-weight:400}
    .fisher-skill-body{min-height:min(260px,30vh);overflow:auto;padding:24px 26px 30px;scrollbar-width:thin;scrollbar-color:var(--af-text-muted) var(--af-on-primary)}
    .fisher-skill-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr));gap:14px}
    .fisher-skill-card-group{display:flex;flex-direction:column;min-width:0;align-self:start;border:1px solid var(--af-border);border-radius:13px;overflow:hidden;background:var(--af-surface)}
    .fisher-skill-card-group .fisher-skill-card{width:100%;border:0;border-radius:0}
    .fisher-skill-card-group .fisher-official-guide{border-top:1px solid var(--af-border)}
    .fisher-skill-card{min-width:0;min-height:164px;display:flex;flex-direction:column;padding:0;overflow:hidden;border:1px solid var(--af-border);border-radius:13px;background:var(--af-surface);text-align:left;color:inherit;cursor:pointer}
    .fisher-skill-cover{display:block;flex:none;width:100%;aspect-ratio:16/9;object-fit:cover;object-position:center;background:var(--af-surface-raised);border-bottom:1px solid var(--af-border)}
    .fisher-skill-card-content{display:flex;flex:1;flex-direction:column;min-width:0;padding:18px;overflow-wrap:anywhere}
    .fisher-skill-card:hover{border-color:var(--af-border-control);background:var(--af-surface)}
    .fisher-skill-command{font:700 12px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--af-text-secondary)}
    .fisher-skill-name{margin-top:14px;font-size:17px;font-weight:720}
    .fisher-skill-name:first-child{margin-top:0}
    .fisher-skill-description{margin:8px 0 18px;color:var(--af-text-secondary);font-size:13px;line-height:1.55}
    .fisher-skill-meta{margin-top:auto;color:var(--af-text-muted);font-size:11px}
    .fisher-skill-tabs{display:flex;gap:6px;padding:12px 26px 0}
    .fisher-skill-tabs button{padding:8px 12px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--af-text-secondary);font-weight:700;cursor:pointer}
    .fisher-skill-tabs button[aria-selected=true]{background:var(--af-surface-raised);border-color:var(--af-border-control);color:var(--af-text)}
    .fisher-skill-filters{display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:16px 26px 0}
    .fisher-skill-filter-buttons{display:flex;gap:4px;padding:4px;background:var(--af-input);border:1px solid var(--af-border-control);border-radius:10px}
    .fisher-skill-filter-buttons button{border:0;border-radius:7px;padding:8px 14px;background:transparent;color:var(--af-text-secondary);cursor:pointer;font-size:12px;white-space:nowrap}
    .fisher-skill-filter-buttons button[aria-pressed=true]{background:var(--af-primary);color:var(--af-on-primary)}
    .fisher-skill-filter-note{margin:0;color:var(--af-text-secondary);font-size:12px}
    .fisher-skill-dialog [hidden]{display:none}
    .fisher-skill-dialog button:focus-visible{outline:2px solid var(--af-info);outline-offset:2px}
    .fisher-skill-empty{padding:60px 20px;text-align:center;color:var(--af-text-muted)}
    .fisher-skill-message{padding:10px 26px;border-top:1px solid var(--af-border);color:var(--af-text-secondary);font-size:12px}
    .fisher-skill-menu{position:fixed;z-index:10030;width:min(360px,calc(100vw - 24px));max-height:300px;overflow:auto;padding:8px;border:1px solid var(--af-border);border-radius:12px;background:var(--af-surface);color:var(--af-text);box-shadow:var(--af-shadow)}
    .fisher-skill-menu button{width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:10px 12px;border:0;border-radius:8px;background:transparent;color:inherit;text-align:left;cursor:pointer}
    .fisher-skill-menu button:hover,.fisher-skill-menu button.is-active{background:var(--af-surface-raised)}
    .fisher-skill-menu strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
    .fisher-skill-menu span{color:var(--af-text-muted);font:11px ui-monospace,SFMono-Regular,Consolas,monospace}
    @media (max-width:680px){.fisher-skill-overlay{padding:12px}.fisher-skill-dialog{width:calc(100vw - 24px);max-height:calc(100vh - 24px)}.fisher-skill-head{align-items:flex-start;padding:18px}.fisher-skill-actions{gap:6px}.fisher-skill-body{padding:18px}.fisher-skill-subtitle{max-width:270px}}
    @media (max-width:480px){.fisher-skill-head{position:relative;display:block}.fisher-skill-head>div:first-child{padding-right:38px}.fisher-skill-actions{margin:14px 0 0}.fisher-skill-close{position:absolute;right:18px;top:18px}.fisher-skill-tabs,.fisher-skill-filters{padding-left:18px;padding-right:18px}}
  `;
  document.head.append(style);
}

function setReactTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
  textarea.setSelectionRange(value.length, value.length);
}

function selectSkill(skill: AgentSkill) {
  window.dispatchEvent(
    new CustomEvent('fisherai:select-agent-skill', { detail: { slug: skill.slug } }),
  );
}

function currentSlashQuery(textarea: HTMLTextAreaElement) {
  const cursor = textarea.selectionStart ?? textarea.value.length;
  const prefix = textarea.value.slice(0, cursor);
  const match = prefix.match(/(?:^|\s)\/([a-z0-9-]*)$/i);
  return match
    ? { query: match[1].toLowerCase(), start: cursor - match[1].length - 1, end: cursor }
    : null;
}

export function installSkillCommunity(client: AgentSkillClient) {
  installStyles();
  let disposed = false;
  let cachedSkills: AgentSkill[] | null = null;
  let menu: HTMLElement | null = null;
  let activeIndex = 0;
  let menuSkills: AgentSkill[] = [];

  const getSkills = async (refresh = false) => {
    if (!cachedSkills || refresh) cachedSkills = await client.list();
    return cachedSkills;
  };

  const closeMenu = () => {
    menu?.remove();
    menu = null;
    menuSkills = [];
    activeIndex = 0;
  };

  const chooseFromMenu = (textarea: HTMLTextAreaElement, skill: AgentSkill) => {
    const slash = currentSlashQuery(textarea);
    if (!slash) return;
    // The menu is a selection control, not text inserted into the next model turn.
    // Consume only its query so a later explicit picker choice cannot be shadowed
    // by an old /slug left in the user's otherwise unchanged draft.
    const next = `${textarea.value.slice(0, slash.start)}${textarea.value.slice(slash.end)}`;
    setReactTextareaValue(textarea, next);
    closeMenu();
    selectSkill(skill);
  };

  const renderSlashMenu = async (textarea: HTMLTextAreaElement) => {
    const slash = currentSlashQuery(textarea);
    if (!slash) {
      closeMenu();
      return;
    }
    const skills = (await getSkills()).filter(
      (skill) =>
        !slash.query ||
        skill.slug.includes(slash.query) ||
        skill.name.toLowerCase().includes(slash.query),
    );
    if (disposed || !textarea.isConnected || currentSlashQuery(textarea)?.query !== slash.query)
      return;
    const requestedActiveIndex = activeIndex;
    closeMenu();
    if (!skills.length) return;
    menuSkills = skills;
    activeIndex = Math.min(requestedActiveIndex, skills.length - 1);
    menu = document.createElement('div');
    menu.className = 'fisher-skill-menu';
    menu.setAttribute(MENU_ATTRIBUTE, 'true');
    menu.setAttribute('role', 'listbox');
    const rect = textarea.getBoundingClientRect();
    menu.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 372))}px`;
    menu.style.top = `${Math.max(12, rect.top - Math.min(300, 24 + skills.length * 52))}px`;
    skills.forEach((skill, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.setAttribute('role', 'option');
      option.classList.toggle('is-active', index === activeIndex);
      const name = document.createElement('strong');
      name.textContent = skill.name;
      const command = document.createElement('span');
      command.textContent = `/${skill.slug}`;
      option.append(name, command);
      option.addEventListener('mousedown', (event) => {
        event.preventDefault();
        chooseFromMenu(textarea, skill);
      });
      menu?.append(option);
    });
    document.body.append(menu);
  };

  const onComposerInput = (event: Event) => {
    const textarea = event.target;
    if (
      textarea instanceof HTMLTextAreaElement &&
      textarea.matches('[data-fisherai-agent-composer]')
    ) {
      void renderSlashMenu(textarea).catch(closeMenu);
    }
  };
  const onComposerKeyDown = (event: KeyboardEvent) => {
    const textarea = event.target;
    if (!(textarea instanceof HTMLTextAreaElement) || !menu || !menuSkills.length) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      activeIndex = (activeIndex + delta + menuSkills.length) % menuSkills.length;
      void renderSlashMenu(textarea).catch(closeMenu);
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      chooseFromMenu(textarea, menuSkills[activeIndex]);
    }
  };

  let releaseDialog: (() => void) | undefined;
  const openCommunity = async () => {
    releaseDialog?.();
    document.querySelector(`[${DIALOG_ATTRIBUTE}]`)?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'fisher-skill-overlay';
    overlay.setAttribute(DIALOG_ATTRIBUTE, 'true');
    const dialog = document.createElement('section');
    dialog.className = 'fisher-skill-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'SKILL 社区');
    const head = document.createElement('header');
    head.className = 'fisher-skill-head';
    const title = document.createElement('div');
    title.innerHTML =
      '<h2 class="fisher-skill-title">SKILL 社区</h2><p class="fisher-skill-subtitle">选择官方推荐，或导入自己的 SKILL，在同一个 Agent 对话中使用。</p>';
    const actions = document.createElement('div');
    actions.className = 'fisher-skill-actions';
    const upload = document.createElement('input');
    upload.type = 'file';
    upload.multiple = true;
    upload.hidden = true;
    upload.setAttribute('webkitdirectory', '');
    const importButton = document.createElement('button');
    importButton.type = 'button';
    importButton.className = 'fisher-skill-button is-primary';
    importButton.textContent = '批量导入 SKILL';
    importButton.addEventListener('click', () => upload.click());
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'fisher-skill-button fisher-skill-close';
    close.setAttribute('aria-label', '关闭 SKILL 社区');
    close.textContent = '×';
    const body = document.createElement('div');
    body.className = 'fisher-skill-body';
    const tabs = document.createElement('div');
    tabs.className = 'fisher-skill-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'SKILL 来源');
    type Category = 'official' | 'local';
    let activeCategory: Category = 'official';
    let openness: 'open' | 'closed' = 'closed';
    const filters = document.createElement('div');
    filters.className = 'fisher-skill-filters';
    const filterButtons = document.createElement('div');
    filterButtons.className = 'fisher-skill-filter-buttons';
    filterButtons.setAttribute('role', 'group');
    filterButtons.setAttribute('aria-label', '官方 SKILL 开放方式');
    const opennessButtons = new Map<'open' | 'closed', HTMLButtonElement>();
    for (const value of ['closed', 'open'] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = value === 'open' ? '开源 SKILL' : '闭源 SKILL';
      button.addEventListener('click', () => {
        openness = value;
        void render();
      });
      opennessButtons.set(value, button);
      filterButtons.append(button);
    }
    const filterNote = document.createElement('p');
    filterNote.className = 'fisher-skill-filter-note';
    filters.append(filterButtons, filterNote);
    const categories: Category[] = ['official', 'local'];
    const tabButtons = new Map<Category, HTMLButtonElement>();
    const panels = new Map<Category, HTMLDivElement>();
    for (const category of categories) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.id = `fisher-skill-tab-${category}`;
      tab.setAttribute('aria-controls', `fisher-skill-panel-${category}`);
      tab.textContent = category === 'official' ? '官方推荐' : '我的 SKILL';
      const panel = document.createElement('div');
      panel.id = `fisher-skill-panel-${category}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      panel.tabIndex = 0;
      tabButtons.set(category, tab);
      panels.set(category, panel);
      tabs.append(tab);
      body.append(panel);
    }
    const message = document.createElement('div');
    message.className = 'fisher-skill-message';
    message.setAttribute('role', 'status');
    message.textContent =
      '点击 SKILL 即可切换当前 Agent 对话，不会发送消息或开始生成。上传脚本不会执行，付费生成需要单独确认。';
    const closeDialog = () => {
      releaseDialog?.();
      releaseDialog = undefined;
      overlay.remove();
    };
    close.addEventListener('click', closeDialog);
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) closeDialog();
    });
    let renderRevision = 0;
    const render = async (refresh = false) => {
      const revision = ++renderRevision;
      filters.hidden = activeCategory !== 'official';
      opennessButtons.forEach((button, value) =>
        button.setAttribute('aria-pressed', String(value === openness)),
      );
      filterNote.textContent =
        openness === 'open' ? '公开规则，按创作需求选择。' : '未公开规则的官方技能。';
      for (const category of categories) {
        tabButtons
          .get(category)!
          .setAttribute('aria-selected', String(category === activeCategory));
        tabButtons.get(category)!.tabIndex = category === activeCategory ? 0 : -1;
        panels.get(category)!.hidden = category !== activeCategory;
      }
      const panel = panels.get(activeCategory)!;
      panel.textContent = '正在读取…';
      try {
        const skills = (await getSkills(refresh)).filter(
          (skill) =>
            (skill.source === 'official' ? 'official' : 'local') === activeCategory &&
            (activeCategory !== 'official' || (skill.openness || 'open') === openness),
        );
        if (disposed || !overlay.isConnected || revision !== renderRevision) return;
        panel.replaceChildren();
        if (!skills.length) {
          const empty = document.createElement('div');
          empty.className = 'fisher-skill-empty';
          empty.textContent =
            activeCategory === 'official'
              ? openness === 'closed'
                ? '暂无闭源 SKILL。现有官方推荐均在「开源 SKILL」中。'
                : '暂无可用的官方推荐。'
              : '还没有本机 SKILL，请导入一个包含 SKILL.md 的文件夹。';
          if (activeCategory === 'official' && openness === 'closed') {
            const back = document.createElement('button');
            back.type = 'button';
            back.className = 'fisher-skill-button';
            back.textContent = '查看开源 SKILL';
            back.style.cssText = 'display:block;margin:20px auto 0';
            back.addEventListener('click', () => {
              openness = 'open';
              void render();
            });
            empty.append(back);
          }
          panel.append(empty);
          return;
        }
        const grid = document.createElement('div');
        grid.className = 'fisher-skill-grid';
        for (const skill of skills) {
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'fisher-skill-card';
          card.setAttribute('data-fisherai-skill', skill.slug);
          const cover = officialSkillCover(skill);
          if (cover) {
            const image = document.createElement('img');
            image.className = 'fisher-skill-cover';
            image.src = cover;
            image.alt = ''; // Name and full description below provide the accessible label.
            image.loading = 'lazy';
            image.decoding = 'async';
            image.draggable = false;
            image.addEventListener(
              'error',
              () => {
                image.hidden = true;
              },
              { once: true },
            );
            if (!officialSkillVideo(skill)) card.append(image);
            appendOfficialSkillPreview(card, skill, 'fisher-skill-cover');
          }
          const content = document.createElement('span');
          content.className = 'fisher-skill-card-content';
          if (skill.source !== 'official') {
            const command = document.createElement('span');
            command.className = 'fisher-skill-command';
            command.textContent = `/${skill.slug}`;
            content.append(command);
          }
          const name = document.createElement('strong');
          name.className = 'fisher-skill-name';
          name.textContent = skill.name;
          const description = document.createElement('span');
          description.className = 'fisher-skill-description';
          description.textContent = skill.description || '点击后在 AIFISHER Agent 中使用';
          const meta = document.createElement('span');
          meta.className = 'fisher-skill-meta';
          meta.textContent = `${skill.source === 'official' ? `官方推荐${skill.version ? ` · v${skill.version}` : ''} · ` : '本机导入 · '}${skill.fileCount} 个文件 · 在 Agent 中使用`;
          content.append(name, description, meta);
          card.append(content);
          card.addEventListener('click', () => {
            closeDialog();
            selectSkill(skill);
          });
          const guide = createOfficialSkillGuide(skill);
          if (guide) {
            const group = document.createElement('div');
            group.className = 'fisher-skill-card-group';
            group.append(card, guide);
            grid.append(group);
          } else grid.append(card);
        }
        panel.append(grid);
      } catch (error) {
        if (!disposed && overlay.isConnected && revision === renderRevision)
          panel.textContent = error instanceof Error ? error.message : '读取 SKILL 社区失败';
      }
    };
    for (const [category, tab] of tabButtons) {
      tab.addEventListener('click', () => {
        activeCategory = category;
        void render();
      });
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = categories.indexOf(category);
        activeCategory =
          event.key === 'Home'
            ? categories[0]
            : event.key === 'End'
              ? categories[categories.length - 1]
              : categories[
                  (index + (event.key === 'ArrowRight' ? 1 : categories.length - 1)) %
                    categories.length
                ];
        void render();
        tabButtons.get(activeCategory)!.focus();
      });
    }
    upload.addEventListener('change', () => {
      const files = [...(upload.files || [])];
      if (!files.length) return;
      importButton.disabled = true;
      message.textContent = '正在导入 SKILL…';
      void client
        .importFolders(files)
        .then((skills) => {
          cachedSkills = null;
          if (disposed || !overlay.isConnected) return;
          activeCategory = 'local';
          message.textContent =
            skills.length === 1
              ? `已导入 ${skills[0].name}，输入 /${skills[0].slug} 即可调用。`
              : `已导入 ${skills.length} 个 SKILL。`;
          return render(true);
        })
        .catch((error: unknown) => {
          message.textContent = error instanceof Error ? error.message : '导入 SKILL 失败';
        })
        .finally(() => {
          importButton.disabled = false;
          upload.value = '';
        });
    });
    actions.append(upload, importButton, close);
    head.append(title, actions);
    dialog.append(head, tabs, filters, body, message);
    overlay.append(dialog);
    document.body.append(overlay);
    releaseDialog = activateModal(
      overlay,
      () => {
        // The shared modal owns Escape in capture phase; collapse focused help
        // before dismissing the whole catalog, without adding another modal.
        const focusedGuide = document.activeElement?.closest(
          '[data-fisherai-skill-guide][data-open="true"]',
        );
        const guideToggle =
          focusedGuide && overlay.contains(focusedGuide)
            ? focusedGuide.querySelector<HTMLButtonElement>('.fisher-official-guide-toggle')
            : null;
        if (guideToggle) {
          guideToggle.click();
          guideToggle.focus();
        } else closeDialog();
      },
      { initialFocus: close },
    );
    await render();
  };

  const onOpen = () => {
    void openCommunity();
  };
  window.addEventListener(OPEN_EVENT, onOpen);
  document.addEventListener('input', onComposerInput, true);
  document.addEventListener('keydown', onComposerKeyDown, true);
  return () => {
    disposed = true;
    window.removeEventListener(OPEN_EVENT, onOpen);
    document.removeEventListener('input', onComposerInput, true);
    document.removeEventListener('keydown', onComposerKeyDown, true);
    closeMenu();
    releaseDialog?.();
    document.querySelector(`[${DIALOG_ATTRIBUTE}]`)?.remove();
  };
}
