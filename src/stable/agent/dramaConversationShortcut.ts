import { observeStableEnhancement } from '../lifecycle/enhancementLifecycle';
import {
  createAgentSkillClient,
  type AgentSkill,
  type AgentSkillClient,
} from '../skills/skillClient';
import {
  createAgentConversation,
  DEFAULT_AGENT_SKILL,
  type AgentConversation,
} from './agentConversation';
import type { DramaCanvasBridge } from './dramaCanvasBridge';
import { productionProfileForSkill } from '../../shared/officialProductionProfiles.js';
import { officialSkillCover, appendOfficialSkillPreview } from '../skills/officialSkillCovers';

export const DRAMA_SHORTCUT_LABEL = '剧本文戏·官方推荐';
export const SELECT_AGENT_SKILL_EVENT = 'fisherai:select-agent-skill';
const LEGACY_OPEN_EVENT = 'fisherai:open-drama-production';
const ATTRIBUTE = 'data-fisherai-agent-official-skills';

/** Selection only saves the current conversation's skill; it never submits a chat or generation. */
export function installDramaConversationShortcut(
  canvas: DramaCanvasBridge,
  conversation: AgentConversation = createAgentConversation(() => canvas.projectId()),
  skills: AgentSkillClient = window.__FISHERAI_SKILLS__ || createAgentSkillClient(),
) {
  window.__FISHERAI_AGENT_CONVERSATION__ = conversation;
  window.dispatchEvent(new Event('fisherai:agent-conversation-ready'));
  let disposed = false;
  let selecting = false;
  let root: HTMLElement | null = null;
  let expanded = false;
  let catalog: AgentSkill[] | null = null;
  let loading = false;
  let error = '';
  let filter = '';
  let category: 'open' | 'closed' = 'open';
  let context = '';
  let feedback = '';
  let feedbackTimer: number | undefined;
  let selectionChip: HTMLElement | null = null;
  let refresh: () => void = () => {};
  let collapse: () => void = () => {};
  let syncPlacement: () => void = () => {};
  const skillName = (slug: string) =>
    catalog?.find((skill) => skill.slug === slug)?.name ||
    productionProfileForSkill(slug)?.name ||
    slug;
  const clearFeedback = () => {
    window.clearTimeout(feedbackTimer);
    feedback = '';
  };

  const select = async (slug: string | null) => {
    if (disposed || selecting) return;
    selecting = true;
    clearFeedback();
    error = '';
    refresh();
    const project = canvas.projectId();
    const session = conversation.snapshot().sessionId;
    const current = () =>
      !disposed &&
      project === canvas.projectId() &&
      (!session || session === conversation.snapshot().sessionId);
    try {
      const openingAgent = !document.querySelector('[data-fisherai-agent-panel]');
      if (openingAgent) {
        document.querySelector<HTMLButtonElement>('[data-fisherai-agent-launcher]')?.click();
      }
      for (let i = 0; i < 30 && !document.querySelector('[data-fisherai-agent-composer]'); i += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 40));
        if (!current()) return;
      }
      // Opening the native panel binds its conversation in a React effect. Let that
      // binding settle, then wait only for its read-only history restoration.
      if (openingAgent) await new Promise((resolve) => window.setTimeout(resolve, 16));
      for (let i = 0; i < 30 && conversation.snapshot().restoring; i += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 40));
        if (!current()) return;
      }
      if (!current()) return;
      if (document.querySelector('[data-fisherai-agent-backend="codex"]')) {
        error = '请先在模型菜单切回 API 文本模型，再使用剧本文戏。';
        refresh();
        return;
      }
      const selected = await conversation.selectSkill(slug);
      if (!current()) return;
      if (!selected) {
        error = '请等待当前回复或操作完成，再切换 SKILL。';
        refresh();
        return;
      }
      error = '';
      feedback = slug ? `已使用「${skillName(slug)}」` : '已取消技能';
      if (selectionChip) {
        selectionChip.dataset.feedback = 'true';
      }
      feedbackTimer = window.setTimeout(() => {
        feedback = '';
        if (selectionChip) delete selectionChip.dataset.feedback;
        refresh();
      }, 2600);
      collapse();
      // The native React commit may still be enabling the textarea.
      for (
        let i = 0;
        i < 30 &&
        document.querySelector<HTMLTextAreaElement>('[data-fisherai-agent-composer]')?.disabled;
        i += 1
      ) {
        await new Promise((resolve) => window.setTimeout(resolve, 16));
        if (!current()) return;
      }
      document.querySelector<HTMLTextAreaElement>('[data-fisherai-agent-composer]')?.focus();
    } catch (cause) {
      if (current()) {
        error = cause instanceof Error ? cause.message : '暂时无法切换 SKILL。';
        refresh();
      }
    } finally {
      selecting = false;
      if (!disposed) refresh();
    }
  };

  const readCatalog = async () => {
    if (loading || disposed) return;
    loading = true;
    error = '';
    refresh();
    try {
      const result = await skills.list();
      if (!disposed) catalog = result;
    } catch (cause) {
      if (!disposed) error = cause instanceof Error ? cause.message : '读取官方推荐失败，请重试。';
    } finally {
      loading = false;
      if (!disposed) refresh();
    }
  };

  const mount = () => {
    if (disposed) return;
    if (root?.isConnected) {
      syncPlacement();
      return;
    }
    const composer = document.querySelector<HTMLTextAreaElement>('[data-fisherai-agent-composer]');
    const agentPanel = composer?.closest('[data-fisherai-agent-panel]');
    if (
      !composer ||
      !agentPanel ||
      agentPanel.getAttribute('data-fisherai-agent-backend') === 'codex'
    )
      return;
    // Keep the original attachment / textarea / model-control box untouched.
    const anchor =
      composer.parentElement && composer.parentElement !== agentPanel
        ? composer.parentElement
        : composer;
    selectionChip?.remove();
    selectionChip = document.createElement('div');
    selectionChip.className = 'fisher-agent-skill-context';
    selectionChip.dataset.fisheraiAgentSelectedSkill = 'true';
    const chip = document.createElement('div');
    chip.className = 'fisher-agent-skill-chip';
    const chipLabel = document.createElement('span');
    chipLabel.className = 'fisher-agent-skill-name';
    const chipIcon = document.createElement('span');
    chipIcon.className = 'fisher-agent-skill-symbol';
    chipIcon.setAttribute('aria-hidden', 'true');
    chipIcon.textContent = '✦';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'fisher-agent-skill-cancel';
    cancel.textContent = '×';
    cancel.title = '取消使用此技能';
    cancel.addEventListener('click', () => {
      void select(null);
    });
    chip.append(chipIcon, chipLabel, cancel);
    selectionChip.append(chip);
    const contextSlot = agentPanel.querySelector('[data-fisherai-agent-context-slot]');
    if (contextSlot) contextSlot.append(selectionChip);
    else composer.before(selectionChip);
    root = document.createElement('section');
    root.setAttribute(ATTRIBUTE, 'true');
    root.dataset.fisheraiOfficialRecommendations = 'true';
    root.className = 'fisher-agent-skills';
    expanded = false;
    filter = '';
    const heading = document.createElement('h2');
    heading.className = 'fisher-agent-skills-heading';
    heading.textContent = '官方推荐';
    const categories = document.createElement('div');
    categories.className = 'fisher-agent-skills-categories';
    categories.setAttribute('role', 'tablist');
    categories.setAttribute('aria-label', '官方技能分类');
    const categoryButtons = (['closed', 'open'] as const).map((value) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.textContent = value === 'open' ? '开源篇' : '闭源篇';
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', () => {
        category = value;
        refresh();
      });
      categories.append(tab);
      return tab;
    });
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'fisher-agent-skills-toggle';
    toggle.setAttribute('aria-controls', 'fisher-agent-official-skills-options');
    toggle.setAttribute('aria-label', '官方推荐');
    const arrow = document.createElement('span');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.className = 'fisher-agent-skills-chevron';
    arrow.textContent = '›';
    const label = document.createElement('span');
    label.textContent = '切换技能';
    const hint = document.createElement('span');
    hint.className = 'fisher-agent-skills-hint';
    hint.setAttribute('aria-hidden', 'true');
    toggle.append(label, hint, arrow);
    const options = document.createElement('div');
    options.id = 'fisher-agent-official-skills-options';
    options.className = 'fisher-agent-skills-options';
    options.setAttribute('role', 'region');
    options.setAttribute('aria-label', '选择官方 SKILL');
    const optionsInner = document.createElement('div');
    optionsInner.className = 'fisher-agent-skills-inner';
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = '搜索官方 SKILL';
    search.setAttribute('aria-label', '搜索官方 SKILL');
    const list = document.createElement('div');
    list.className = 'fisher-agent-skills-list';
    const note = document.createElement('p');
    note.setAttribute('role', 'status');
    note.className = 'fisher-agent-skills-note';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = '重新读取';
    retry.className = 'fisher-agent-skills-retry';
    retry.addEventListener('click', () => {
      void readCatalog();
    });
    optionsInner.append(categories, search, list);
    options.append(optionsInner);
    root.append(heading, toggle, options, note, retry);
    const skillsSlot =
      agentPanel.querySelector('[data-fisherai-agent-welcome-skills-slot]') ||
      agentPanel.querySelector('[data-fisherai-agent-skills-slot]');
    if (skillsSlot) skillsSlot.append(root);
    else anchor.before(root);
    let listSignature = '';
    collapse = () => {
      expanded = false;
      refresh();
    };
    refresh = () => {
      if (!root?.isConnected || disposed) return;
      const snapshot = conversation.snapshot();
      const welcome =
        root.parentElement?.hasAttribute('data-fisherai-agent-welcome-skills-slot') ?? false;
      const showOptions = welcome || expanded;
      root.dataset.presentation = welcome ? 'welcome' : 'compact';
      heading.hidden = !welcome;
      toggle.hidden = welcome;
      toggle.setAttribute('aria-expanded', String(showOptions));
      root.dataset.expanded = String(showOptions);
      options.setAttribute('aria-hidden', String(!showOptions));
      options.inert = !showOptions;
      hint.textContent = expanded ? '收起' : '选择技能';
      const active = snapshot.selectedSkill;
      const name = active ? skillName(active.slug) : '';
      if (selectionChip) selectionChip.hidden = !active && !snapshot.restoring;
      chipLabel.textContent = snapshot.restoring ? '正在恢复技能…' : name;
      chipLabel.title = name;
      chip.dataset.active = String(Boolean(active) && !snapshot.restoring);
      chipIcon.hidden = !active || snapshot.restoring;
      cancel.hidden = !active || snapshot.restoring;
      cancel.disabled = selecting || snapshot.busy;
      cancel.setAttribute('aria-label', `取消使用${name}`);
      chip.setAttribute('aria-busy', String(selecting || snapshot.restoring));
      note.textContent =
        error ||
        (selecting ? '正在切换技能…' : feedback) ||
        (showOptions && loading
          ? '正在读取官方推荐…'
          : showOptions && snapshot.restoring
            ? '正在读取当前选择…'
            : '');
      note.hidden = !note.textContent;
      note.dataset.fisheraiState = error ? 'error' : feedback ? 'success' : 'loading';
      retry.hidden = !error || selecting;
      retry.disabled = loading;
      const officialCatalog = (catalog || []).filter((skill) => skill.source === 'official');
      search.hidden = officialCatalog.length <= 4;
      categoryButtons.forEach((tab, index) =>
        tab.setAttribute('aria-selected', String(category === (index === 0 ? 'closed' : 'open'))),
      );
      const signature = JSON.stringify([
        showOptions,
        officialCatalog,
        category,
        filter,
        loading,
        snapshot.restoring,
        active,
        snapshot.busy,
        selecting,
      ]);
      if (signature === listSignature || !showOptions) return;
      listSignature = signature;
      const focusedSlug =
        document.activeElement instanceof HTMLElement
          ? document.activeElement.dataset.fisheraiOfficialSkill
          : null;
      list.replaceChildren();
      const matching = officialCatalog
        .filter((skill) => (skill.openness || 'open') === category)
        .filter((skill) =>
          `${skill.name} ${skill.description} ${skill.slug}`.toLowerCase().includes(filter),
        );
      if (!loading && catalog && !matching.length) {
        const empty = document.createElement('p');
        empty.className = 'fisher-agent-skills-note';
        empty.textContent = filter ? '没有匹配的官方 SKILL。' : '暂无可用的官方推荐。';
        list.append(empty);
      }
      for (const skill of matching) {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'fisher-agent-skills-option';
        option.dataset.fisheraiOfficialSkill = skill.slug;
        const selected =
          !snapshot.restoring &&
          snapshot.selectedSkill?.source === 'official' &&
          snapshot.selectedSkill.slug === skill.slug;
        option.setAttribute('aria-pressed', String(selected));
        option.disabled = selecting || snapshot.busy;
        const name = document.createElement('strong');
        name.textContent = skill.name;
        const description = document.createElement('span');
        description.className = 'fisher-agent-skills-description';
        description.textContent =
          skill.slug === DEFAULT_AGENT_SKILL.slug
            ? '从剧本到人物、场景，再到文戏分镜。'
            : skill.description;
        const checked = document.createElement('small');
        checked.textContent = selected ? '✓ 已启用' : '使用 →';
        const cover = officialSkillCover(skill);
        if (cover) {
          const image = document.createElement('img');
          image.className = 'fisher-agent-skills-cover';
          image.src = cover;
          image.alt = '';
          image.draggable = false;
          image.decoding = 'async';
          image.addEventListener(
            'error',
            () => {
              image.hidden = true;
            },
            { once: true },
          );
          option.append(image);
          appendOfficialSkillPreview(option, skill, 'fisher-agent-skills-cover');
        }
        const content = document.createElement('span');
        content.className = 'fisher-agent-skills-card-content';
        content.append(name, description, checked);
        option.append(content);
        option.addEventListener('click', () => {
          void select(skill.slug);
        });
        list.append(option);
        if (focusedSlug === skill.slug && !option.disabled) option.focus();
      }
    };
    toggle.addEventListener('click', () => {
      expanded = !expanded;
      refresh();
      if (expanded && !catalog) void readCatalog();
    });
    search.addEventListener('input', () => {
      filter = search.value.trim().toLowerCase();
      refresh();
    });
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !expanded) return;
      event.preventDefault();
      event.stopPropagation();
      collapse();
      toggle.focus();
    });
    syncPlacement = () => {
      if (!root?.isConnected) return;
      const target =
        agentPanel.querySelector('[data-fisherai-agent-welcome-skills-slot]') ||
        agentPanel.querySelector('[data-fisherai-agent-skills-slot]');
      if (target && root.parentElement !== target) {
        target.append(root);
        expanded = false;
        filter = '';
        search.value = '';
        listSignature = '';
        refresh();
      }
      if (
        target?.hasAttribute('data-fisherai-agent-welcome-skills-slot') &&
        !catalog &&
        !loading &&
        !error
      )
        void readCatalog();
    };
    refresh();
    syncPlacement();
  };
  const unobserve = observeStableEnhancement(mount);
  const unsubscribe = conversation.subscribe(() => {
    const snapshot = conversation.snapshot();
    const next = `${snapshot.projectId || ''}:${snapshot.sessionId || ''}`;
    if (next !== context) {
      context = next;
      expanded = false;
      error = '';
      filter = '';
      clearFeedback();
      if (selectionChip) delete selectionChip.dataset.feedback;
      const search = root?.querySelector<HTMLInputElement>('input[type=search]');
      if (search) search.value = '';
    }
    refresh();
    if (snapshot.selectedSkill?.source === 'local' && !catalog && !loading && !error)
      void readCatalog();
  });
  const onSelect = (event: Event) => {
    const slug = (event as CustomEvent<{ slug?: unknown }>).detail?.slug;
    if (typeof slug === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) void select(slug);
  };
  const onLegacyOpen = () => {
    void select(DEFAULT_AGENT_SKILL.slug);
  };
  const style = document.createElement('style');
  style.textContent = `
    .fisher-agent-skills,.fisher-agent-skill-context{color:var(--af-text);font:12px/1.5 Inter,"Microsoft YaHei UI",system-ui,sans-serif}
    .fisher-agent-skills{margin-bottom:8px;min-width:0}
    .fisher-agent-skills-categories{display:flex;gap:6px;margin:0 0 12px}.fisher-agent-skills-categories button{border:0;border-radius:8px;padding:7px 12px;background:transparent;color:var(--af-text-secondary);font:inherit;cursor:pointer}.fisher-agent-skills-categories button[aria-selected=true]{background:var(--af-hover);color:var(--af-text)}
    .fisher-agent-skills-heading{margin:0 0 12px;font-size:14px;font-weight:700;color:var(--af-text)}
    .fisher-agent-skills [hidden],.fisher-agent-skill-context[hidden],.fisher-agent-skill-context [hidden]{display:none}
    .fisher-agent-skills-toggle{display:flex;align-items:center;gap:8px;width:100%;min-height:38px;padding:6px 4px;border:0;background:transparent;color:var(--af-text);font-size:14px;font-weight:700;cursor:pointer;transition:color 160ms ease}
    .fisher-agent-skills-toggle:hover{color:var(--af-text)}
    .fisher-agent-skills-hint{margin-left:auto;color:var(--af-text-muted);font-size:11px;font-weight:400}
    .fisher-agent-skills-chevron{font-size:20px;line-height:16px;width:16px;text-align:center;transform:rotate(90deg);transition:transform 200ms ease}
    .fisher-agent-skills[data-expanded=true] .fisher-agent-skills-chevron{transform:rotate(-90deg)}
    .fisher-agent-skills-options{display:grid;grid-template-rows:0fr;opacity:0;visibility:hidden;transition:grid-template-rows 220ms cubic-bezier(.2,.7,.2,1),opacity 160ms ease,visibility 220ms;}
    .fisher-agent-skills[data-expanded=true] .fisher-agent-skills-options{grid-template-rows:1fr;opacity:1;visibility:visible}
    .fisher-agent-skills-inner{min-height:0;overflow:hidden}
    .fisher-agent-skills input{box-sizing:border-box;width:100%;margin:4px 0 8px;padding:9px 12px;border:1px solid var(--af-border-control);border-radius:8px;background:var(--af-surface);color:var(--af-text);font-size:12px}
    .fisher-agent-skills-list{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;max-height:min(300px,32vh);overflow:auto;overscroll-behavior:contain;padding:2px 2px 6px;scrollbar-width:thin}
    .fisher-agent-skills[data-presentation=welcome] .fisher-agent-skills-list{max-height:none;overflow:visible}
    .fisher-agent-skills[data-presentation=welcome] .fisher-agent-skills-options{transition:none}
    .fisher-agent-skills-option{position:relative;isolation:isolate;min-width:0;min-height:110px;width:100%;padding:0;overflow:hidden;border:1px solid var(--af-border);border-radius:10px;background:var(--af-surface-raised);color:inherit;text-align:left;cursor:pointer;transition:background 150ms ease,border-color 150ms ease,transform 150ms ease}
    .fisher-agent-skills-option:hover{background:var(--af-surface-raised);border-color:var(--af-border-control);transform:translateY(-1px)}
    .fisher-agent-skills-option:active{transform:scale(.99)}
    .fisher-agent-skills-option[aria-pressed=true]{background:var(--af-surface-raised);border-color:var(--af-border-control)}
    .fisher-agent-skills-cover{position:absolute;inset:0 0 0 auto;width:52%;height:100%;object-fit:cover;object-position:center;pointer-events:none;z-index:-2;transition:transform 200ms ease}
    .fisher-agent-skills-option::before{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(90deg,var(--af-recommendation-surface) 28%,color-mix(in srgb,var(--af-recommendation-surface) 100%,transparent) 43%,color-mix(in srgb,var(--af-recommendation-surface) 96%,transparent) 82%,color-mix(in srgb,var(--af-recommendation-surface) 6%,transparent) 100%);pointer-events:none}
    .fisher-agent-skills-option:hover .fisher-agent-skills-cover{transform:scale(1.035)}
    .fisher-agent-skills-card-content{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:7px;padding:14px;max-width:82%;min-height:110px;box-sizing:border-box}
    .fisher-agent-skills-option strong{min-width:0;overflow-wrap:anywhere;font-size:14px;font-weight:700;color:var(--af-text)}
    .fisher-agent-skills-description{color:var(--af-text-secondary);font-size:12px;line-height:1.6;overflow-wrap:anywhere;text-shadow:none}
    .fisher-agent-skills-option small{margin-top:auto;font-size:10px;color:var(--af-text);white-space:nowrap}
    @container(min-width:640px){.fisher-agent-skills-list{grid-template-columns:repeat(2,minmax(0,1fr))}}
    .fisher-agent-skills[data-presentation=welcome]{container:agent-welcome-skills / inline-size;font-size:clamp(14px,2.2cqi,16px)}
    .fisher-agent-skills[data-presentation=welcome] .fisher-agent-skills-list{grid-template-columns:minmax(0,1fr);gap:clamp(12px,2cqi,18px)}
    .fisher-agent-skills[data-presentation=welcome] .fisher-agent-skills-heading{font-size:clamp(16px,2.8cqi,20px)}
    .fisher-agent-skills[data-presentation=welcome] input{font-size:inherit;min-height:42px}
    .fisher-agent-skills[data-presentation=welcome] .fisher-agent-skills-card-content{min-height:clamp(148px,22cqi,180px);padding:clamp(16px,2.5cqi,22px);gap:10px;max-width:88%}
    .fisher-agent-skills[data-presentation=welcome] .fisher-agent-skills-option strong{font-size:clamp(16px,2.6cqi,18px)}
    .fisher-agent-skills[data-presentation=welcome] .fisher-agent-skills-description{font-size:clamp(14px,2.2cqi,16px)}
    .fisher-agent-skills[data-presentation=welcome] .fisher-agent-skills-option small{font-size:12px}
    .fisher-agent-skills-option:disabled{opacity:.5;cursor:wait;transform:none}
    .fisher-agent-skills-note{margin:4px 4px 0;color:var(--af-text-secondary);font-size:11px}
    .fisher-agent-skills-note[data-fisherai-state=success]{color:var(--af-text)}
    .fisher-agent-skills-note[data-fisherai-state=error]{color:var(--af-warning)}
    .fisher-agent-skills-retry{border:1px solid var(--af-border);border-radius:6px;padding:4px 8px;background:var(--af-surface-raised);color:var(--af-text)}
    .fisher-agent-skill-context{display:inline-flex;align-items:center;vertical-align:middle;min-width:0;max-width:100%;margin:2px 8px 10px 0}
    .fisher-agent-skill-context + .fisher-drama-attachment:not([hidden]):not(:has(.fisher-drama-attachment-name,p)){display:inline-flex;vertical-align:middle;margin-bottom:10px}
    .fisher-agent-skill-chip{display:inline-flex;align-items:center;gap:7px;max-width:100%;box-sizing:border-box;min-height:30px;padding:2px 3px 2px 10px;border:1px solid var(--af-border-control);border-radius:8px;background:var(--af-hover);color:var(--af-text);transition:background 180ms ease,border-color 180ms ease}
    .fisher-agent-skill-chip[data-active=false]{color:var(--af-text-secondary);background:transparent;border-color:transparent;padding-left:0}
    .fisher-agent-skill-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:500}
    .fisher-agent-skill-symbol{color:var(--af-text);font-size:13px}
    .fisher-agent-skill-cancel{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:26px;height:26px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--af-text-secondary);font-size:19px;cursor:pointer;transition:background 150ms ease,color 150ms ease}
    .fisher-agent-skill-cancel:hover{background:var(--af-hover);color:var(--af-text)}
    .fisher-agent-skill-cancel:disabled{opacity:.45;cursor:wait}
    .fisher-agent-skill-context[data-feedback=true] .fisher-agent-skill-chip{animation:fisher-skill-selected 360ms ease-out}
    @keyframes fisher-skill-selected{0%{transform:translateY(3px);background:var(--af-hover)}100%{transform:translateY(0)}}
    .fisher-agent-skills button:focus-visible,.fisher-agent-skills input:focus-visible,.fisher-agent-skill-cancel:focus-visible{outline:2px solid var(--af-info);outline-offset:2px}
    @media(prefers-reduced-motion:reduce){.fisher-agent-skills *,.fisher-agent-skill-context *{transition:none!important;animation:none!important}}
  `;
  document.head.append(style);
  window.addEventListener(SELECT_AGENT_SKILL_EVENT, onSelect);
  window.addEventListener(LEGACY_OPEN_EVENT, onLegacyOpen);
  return () => {
    disposed = true;
    clearFeedback();
    unobserve();
    unsubscribe();
    style.remove();
    root?.remove();
    selectionChip?.remove();
    window.removeEventListener(SELECT_AGENT_SKILL_EVENT, onSelect);
    window.removeEventListener(LEGACY_OPEN_EVENT, onLegacyOpen);
    conversation.dispose();
    if (window.__FISHERAI_AGENT_CONVERSATION__ === conversation)
      delete window.__FISHERAI_AGENT_CONVERSATION__;
  };
}
