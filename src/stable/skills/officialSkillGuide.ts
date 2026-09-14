import { productionProfileForSkill } from '../../shared/officialProductionProfiles.js';

/** Read-only help shared by the Agent picker and community; never selects or executes a skill. */
export function createOfficialSkillGuide(skill: { slug: string; source?: string }) {
  const profile = skill.source === 'official' ? productionProfileForSkill(skill.slug) : undefined;
  if (!profile) return null;
  const assetsOnly = profile.mode === 'assets';
  const high = profile.id === 'minimax-drama-high';
  const steps = assetsOnly
    ? [
        ['描述人物和场景', '选择打斗武戏，在 Agent 中说明人物外观、场景和打斗设想，无需上传剧本。'],
        ['审阅资产计划', '发送要求后查看人物、场景清单；继续对话可修改计划。'],
        [
          '确认并生成资产',
          '展开“查看计划与执行选项”，确认资产清单，选择资产并确认本批调用，再点击“生成所选资产”。',
        ],
        [
          '创建武戏节点',
          '资产生成并显示在画布后，确认资产并创建武戏节点，系统连接人物与场景图片。',
        ],
        ['手动运行视频', '在画布武戏节点内检查提示词、参考图和参数，再自行点击“运行”。'],
      ]
    : [
        [
          '添加剧本与要求',
          `选择${profile.name}，粘贴剧本或点击“添加剧本”上传 TXT、Markdown、DOCX，再输入制作要求并发送。`,
        ],
        ['对话完善计划', '查看人物、场景和文戏分段；继续对话调整内容，确认后再进入资产生成。'],
        [
          '确认并生成资产',
          '展开“查看计划与执行选项”，确认资产清单，选择资产并确认本批调用，再点击“生成所选资产”。',
        ],
        [
          '创建文戏节点',
          `资产生成并显示在画布后，确认资产并创建文戏节点，系统连接参考图并填入分段提示词；使用${high ? '高配' : '低配'} RH 文戏应用。`,
        ],
        ['手动运行视频', '在画布文戏节点内检查提示词、参考图和参数，再自行点击“运行”。'],
      ];
  const root = document.createElement('section');
  root.className = 'fisher-official-guide';
  root.dataset.fisheraiSkillGuide = skill.slug;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'fisher-official-guide-toggle';
  toggle.setAttribute('aria-label', `${profile.name}使用步骤`);
  toggle.setAttribute('aria-expanded', 'false');
  const label = document.createElement('span');
  label.textContent = '使用步骤';
  const hint = document.createElement('span');
  hint.textContent = '5 步上手';
  hint.className = 'fisher-official-guide-hint';
  const arrow = document.createElement('span');
  arrow.textContent = '›';
  arrow.className = 'fisher-official-guide-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  toggle.append(label, hint, arrow);
  const content = document.createElement('div');
  content.className = 'fisher-official-guide-content';
  content.id = `official-guide-${crypto.randomUUID()}`;
  content.setAttribute('role', 'region');
  content.setAttribute('aria-label', `${profile.name}使用步骤`);
  toggle.setAttribute('aria-controls', content.id);
  const inner = document.createElement('div');
  inner.className = 'fisher-official-guide-inner';
  const prerequisites = document.createElement('p');
  prerequisites.textContent =
    '开始前：在设置中配置 API 文本模型、RunningHub 和即梦 5 API 所需的连接。Agent 请使用 API 文本模型来源。';
  const list = document.createElement('ol');
  for (const [title, description] of steps) {
    const item = document.createElement('li');
    const heading = document.createElement('strong');
    heading.textContent = title;
    const body = document.createElement('p');
    body.textContent = description;
    item.append(heading, body);
    list.append(item);
  }
  const notice = document.createElement('p');
  notice.className = 'fisher-official-guide-notice';
  notice.textContent =
    '查看教程、选择技能或添加剧本不会开始生成。发送消息会调用文本模型；资产生成需另行确认，创建节点不等于生成视频。';
  inner.append(prerequisites, list, notice);
  content.append(inner);
  root.append(toggle, content);
  const setOpen = (open: boolean) => {
    root.dataset.open = String(open);
    toggle.setAttribute('aria-expanded', String(open));
    content.setAttribute('aria-hidden', String(!open));
    content.inert = !open;
  };
  setOpen(false);
  toggle.addEventListener('click', () => setOpen(root.dataset.open !== 'true'));
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || root.dataset.open !== 'true') return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    toggle.focus();
  });
  return root;
}

export const OFFICIAL_SKILL_GUIDE_STYLES = `
  .fisher-official-guide{min-width:0;color:var(--af-text);font:12px/1.6 Inter,"Microsoft YaHei UI",system-ui,sans-serif}
  .fisher-official-guide-toggle{display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;border:0;background:transparent;color:var(--af-text);text-align:left;font:inherit;font-weight:600;cursor:pointer}
  .fisher-official-guide-toggle:hover{color:var(--af-text);background:var(--af-surface-raised)}
  .fisher-official-guide-toggle:focus-visible{outline:2px solid var(--af-info);outline-offset:-2px;border-radius:6px}
  .fisher-official-guide-hint{margin-left:auto;color:var(--af-text-secondary);font-size:11px;font-weight:400}
  .fisher-official-guide-arrow{font-size:18px;line-height:1;transition:transform 200ms ease}
  .fisher-official-guide[data-open=true] .fisher-official-guide-arrow{transform:rotate(90deg)}
  .fisher-official-guide-content{display:grid;grid-template-rows:0fr;opacity:0;visibility:hidden;transition:grid-template-rows 220ms ease,opacity 160ms ease,visibility 220ms}
  .fisher-official-guide[data-open=true] .fisher-official-guide-content{grid-template-rows:1fr;opacity:1;visibility:visible}
  .fisher-official-guide-inner{min-height:0;overflow:hidden;overflow-wrap:anywhere}
  .fisher-official-guide-inner>p{margin:8px 12px 12px;color:var(--af-text-secondary)}
  .fisher-official-guide ol{margin:0 12px 12px;padding-left:24px;list-style:decimal outside}
  .fisher-official-guide li{padding-left:4px;margin-bottom:12px}
  .fisher-official-guide li::marker{color:var(--af-text);font-weight:700}
  .fisher-official-guide strong{font-size:12px;font-weight:700}
  .fisher-official-guide li p{margin:3px 0 0;color:var(--af-text-secondary)}
  .fisher-official-guide-inner>.fisher-official-guide-notice{padding-top:10px;border-top:1px solid var(--af-border);font-size:11px}
  @media(prefers-reduced-motion:reduce){.fisher-official-guide-content,.fisher-official-guide-arrow{transition:none}}
`;
