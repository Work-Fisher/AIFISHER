import { observeStableEnhancement } from '../lifecycle/enhancementLifecycle';
import type { AgentConversation, ConversationTools } from './agentConversation';
import type { DramaConversationState } from './agentClient';
import {
  productionProfileForSkill,
  productionProfileForBundle,
} from '../../shared/officialProductionProfiles.js';
import { buildDramaAssetNodes, buildDramaCanvasNodes, mergeDramaCanvasNodes } from './dramaCanvas';
import type { DramaCanvasBridge } from './dramaCanvasBridge';
import {
  createDramaClient,
  type DramaAssetExecution,
  type DramaClient,
  type DramaPlan,
} from './dramaClient';

const MAX_BATCH = 12;
const LABELS: Record<string, string> = {
  pending: '生成中',
  success: '已落盘',
  failed: '失败',
  cancelled: '已停止',
  unknown: '结果待确认',
};
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}
function latestAssets(state: DramaConversationState) {
  const latest = new Map<string, DramaAssetExecution>();
  for (const item of state.execution?.assets || []) {
    const prior = latest.get(item.assetId);
    if (
      !prior ||
      item.attemptNumber > prior.attemptNumber ||
      (item.attemptNumber === prior.attemptNumber &&
        (item.stateRevision || 0) >= (prior.stateRevision || 0))
    )
      latest.set(item.assetId, item);
  }
  return latest;
}

/** Local tools embedded in the original Agent scroll area, not another chat or wizard. */
export function installDramaConversationTools(
  canvas: DramaCanvasBridge,
  conversation: AgentConversation,
  importer: Pick<DramaClient, 'importScript'> = createDramaClient(),
) {
  let card: HTMLElement | null = null;
  let attachment: HTMLElement | null = null;
  let disposed = false;
  let context = '';
  let contextEpoch = 0;
  let planKey = '';
  let busy = false;
  let running = false;
  let batchEpoch = 0;
  let paidConsent = false;
  let compositionConsent = false;
  let note = '';
  let noteError = false;
  let wake: (() => void) | null = null;
  const selected = new Set<string>();
  let canvasSignature = '';
  let canvasQueue = Promise.resolve();
  let pendingFocus: { control?: string; action?: string; details?: string } | null = null;
  let renderedPlanKey = '';
  const isDramaSelected = () => {
    const skill = conversation.snapshot().selectedSkill;
    return skill?.source === 'official' && Boolean(productionProfileForSkill(skill.slug));
  };
  const status = (text: string, error = false) => {
    note = text;
    noteError = error;
    render();
  };
  const current = (session: string, project: string) =>
    !disposed &&
    Boolean(card?.isConnected) &&
    isDramaSelected() &&
    conversation.isCurrent(session, project) &&
    canvas.projectId() === project;
  const scope = (session: string, project: string) => {
    const epoch = contextEpoch;
    return () => epoch === contextEpoch && current(session, project);
  };
  const stop = (message = true) => {
    batchEpoch += 1;
    wake?.();
    wake = null;
    paidConsent = false;
    if (message && running)
      status(
        '已停止后续提交；已提交的远端任务可能继续运行。点击“查询原任务”可取回结果，不会重新生成。',
      );
  };
  const pause = () =>
    new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => {
        wake = null;
        resolve();
      }, 2000);
      wake = () => {
        window.clearTimeout(timer);
        resolve();
      };
    });
  const mergeAssets = (state: DramaConversationState) => {
    const { plan, execution, session } = state;
    if (!plan || !execution || !execution.assets.length || !current(session.id, plan.projectId))
      return Promise.resolve();
    const active = scope(session.id, plan.projectId);
    const signature = JSON.stringify([session.id, plan.id, plan.revision, execution.assets]);
    if (signature === canvasSignature) return canvasQueue;
    canvasQueue = canvasQueue
      .catch(() => undefined)
      .then(async () => {
        if (!active() || signature === canvasSignature) return;
        const nodes = buildDramaAssetNodes(plan, execution);
        await canvas.commit(
          plan.projectId,
          (previous) => {
            if (!active()) return [...previous];
            return mergeDramaCanvasNodes(previous, nodes, {
              projectId: plan.projectId,
              expectedProjectId: canvas.projectId() || '',
            });
          },
          { select: false },
        );
        if (active()) canvasSignature = signature;
      });
    return canvasQueue;
  };
  const action = async (work: (tools: ConversationTools) => Promise<void>) => {
    if (busy || conversation.snapshot().busy || !isDramaSelected()) return;
    const snapshot = conversation.snapshot();
    if (!snapshot.sessionId || !snapshot.projectId) return;
    const { sessionId, projectId } = snapshot;
    const active = scope(sessionId, projectId);
    busy = true;
    note = '';
    noteError = false;
    render();
    try {
      await conversation.withTools(work);
    } catch (cause) {
      if (active())
        status(
          cause instanceof Error ? cause.message : '操作未完成，请查询原任务；不要重复提交。',
          true,
        );
    } finally {
      busy = false;
      running = false;
      render();
    }
  };
  const uploadScript = async (file: File) => {
    const initial = conversation.snapshot();
    if (busy || initial.busy || initial.restoring || !initial.projectId || !isDramaSelected())
      return;
    if (!/\.(txt|md|docx)$/i.test(file.name)) {
      status('支持 TXT、Markdown、DOCX 剧本文件。', true);
      return;
    }
    const project = initial.projectId;
    const generation = contextEpoch;
    let active = () =>
      generation === contextEpoch &&
      !disposed &&
      isDramaSelected() &&
      canvas.projectId() === project;
    busy = true;
    note = '';
    noteError = false;
    render();
    try {
      // A new chat has a default SKILL without a server task yet. Register it only
      // after an explicit attachment action; registration is not a model request.
      if (!initial.state) {
        const registration = conversation.ensureDefaultSkill();
        const intendedSession = conversation.snapshot().sessionId;
        const registrationEpoch = contextEpoch;
        if (
          !(await registration) ||
          registrationEpoch !== contextEpoch ||
          conversation.snapshot().sessionId !== intendedSession
        )
          return;
      }
      const snapshot = conversation.snapshot();
      if (!snapshot.sessionId || snapshot.projectId !== project || !isDramaSelected()) return;
      active = scope(snapshot.sessionId, project);
      await conversation.withTools(async (tools) => {
        const script = await importer.importScript(file);
        if (!active() || !tools.current()) return;
        await tools.attachScript(script);
        if (!active() || !tools.current()) return;
        status(`已添加「${script.name}」，未调用模型。发送消息后才交给当前文本模型处理。`);
      });
    } catch (cause) {
      if (active()) status(cause instanceof Error ? cause.message : '剧本添加失败，请重试。', true);
    } finally {
      busy = false;
      render();
    }
  };
  const batch = (plan: DramaPlan, ids: string[]) => {
    if (!paidConsent || !ids.length || ids.length > MAX_BATCH) return;
    const state = conversation.snapshot().state;
    if (!state || state.plan?.id !== plan.id || state.plan.revision !== plan.revision) return;
    const original = latestAssets(state);
    const targets = ids.map((id) => ({ id, retry: original.get(id) }));
    // Unknown/pending submissions are queried, never treated as another paid attempt.
    if (
      targets.some(({ retry }) => retry && !(retry.status === 'failed' && retry.retryable === true))
    )
      return;
    paidConsent = false;
    const generation = ++batchEpoch;
    void action(async (tools) => {
      running = true;
      for (const { id, retry } of targets) {
        if (generation !== batchEpoch || !tools.current() || document.hidden) break;
        status(
          `正在提交「${plan.assets.find((asset) => asset.id === id)?.name || id}」；仅本项图片 1 次，不生成视频。`,
        );
        let result = await tools.action({
          action: 'generate',
          planId: plan.id,
          planRevision: plan.revision,
          assetId: id,
          attemptId: crypto.randomUUID(),
          confirmPaidExecution: true,
          maxAssets: 1,
          ...(retry ? { retryOfAttemptId: retry.attemptId } : {}),
        });
        await mergeAssets(result);
        let receipt = latestAssets(result).get(id);
        // Observation is bounded and can always be stopped. It never submits another generation.
        for (let count = 0; receipt?.status === 'pending' && count < 1500; count += 1) {
          if (generation !== batchEpoch || !tools.current() || document.hidden) return;
          await pause();
          if (generation !== batchEpoch || !tools.current() || document.hidden) return;
          result = await tools.action({
            action: 'query',
            planId: plan.id,
            planRevision: plan.revision,
            assetId: id,
            attemptId: receipt.attemptId,
          });
          await mergeAssets(result);
          receipt = latestAssets(result).get(id);
        }
        if (receipt?.status !== 'success') {
          throw new Error(
            receipt?.error || '本项尚未确认成功，已停止后续提交。请查询原任务，不会自动重新生成。',
          );
        }
        selected.delete(id);
      }
      if (generation === batchEpoch && tools.current())
        status('本批资产已生成并显示在画布。可继续对话调整；检查图像后再创建文戏节点。');
    });
  };

  function button(label: string, kind: string, handler: () => void, disabled = false) {
    const node = element('button', label);
    node.type = 'button';
    node.disabled = disabled;
    node.dataset.fisheraiDramaAction = kind;
    node.addEventListener('click', handler);
    return node;
  }
  function check(
    label: string,
    key: string,
    value: boolean,
    change: (value: boolean) => void,
    disabled = false,
  ) {
    const wrapper = element('label');
    wrapper.className = 'fisher-drama-inline-check';
    const control = element('input');
    control.type = 'checkbox';
    control.checked = value;
    control.disabled = disabled;
    control.setAttribute('aria-label', key);
    control.dataset.fisheraiDramaControl = key;
    control.addEventListener('change', () => {
      change(control.checked);
      render();
    });
    wrapper.append(control, element('span', label));
    return wrapper;
  }
  function renderAttachment() {
    if (!attachment) return;
    const snapshot = conversation.snapshot();
    attachment.hidden =
      !snapshot.projectId ||
      !isDramaSelected() ||
      productionProfileForSkill(snapshot.selectedSkill?.slug)?.mode === 'assets';
    if (attachment.hidden) {
      attachment.replaceChildren();
      return;
    }
    const focused = attachment.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.fisheraiDramaAction
      : null;
    attachment.replaceChildren();
    const chooser = element('input');
    chooser.type = 'file';
    chooser.accept = '.txt,.md,.docx';
    chooser.hidden = true;
    chooser.dataset.fisheraiDramaControl = '上传剧本';
    chooser.setAttribute('aria-label', '上传剧本');
    chooser.disabled = busy || snapshot.busy || snapshot.restoring;
    chooser.addEventListener('change', () => {
      const file = chooser.files?.[0];
      if (file) void uploadScript(file);
    });
    const upload = button(
      '添加剧本',
      'upload-script',
      () => chooser.click(),
      busy || snapshot.busy || snapshot.restoring,
    );
    upload.title = '添加 TXT、Markdown 或 DOCX；只在本机解析，不调用模型';
    attachment.append(upload, chooser);
    const script = snapshot.state?.session.workflow?.script;
    if (script) {
      const name = element('span', script.name);
      name.className = 'fisher-drama-attachment-name';
      name.title = `${script.name} · ${script.text.length} 字符`;
      attachment.append(name);
    }
    if (!snapshot.state?.plan && (note || snapshot.error)) {
      const output = element('p', note || snapshot.error || '');
      output.setAttribute('role', noteError || snapshot.error ? 'alert' : 'status');
      attachment.append(output);
    }
    if (focused === 'upload-script') upload.focus({ preventScroll: true });
  }
  function render() {
    renderAttachment();
    if (!card) return;
    const snapshot = conversation.snapshot();
    const state = snapshot.state;
    if (!isDramaSelected() || !state?.plan || !snapshot.sessionId || !snapshot.projectId) {
      card.replaceChildren();
      card.hidden = true;
      renderedPlanKey = '';
      return;
    }
    const nextRenderedPlanKey = `${snapshot.sessionId}:${state.plan.id}:${state.plan.revision}`;
    const newSummary = renderedPlanKey !== nextRenderedPlanKey || !card.childElementCount;
    const focused = card.contains(document.activeElement)
      ? (document.activeElement as HTMLElement)
      : null;
    if (focused)
      pendingFocus = {
        control: focused.dataset.fisheraiDramaControl,
        action: focused.dataset.fisheraiDramaAction,
        details: focused.dataset.fisheraiDramaDetailsSummary,
      };
    else if (document.activeElement && document.activeElement !== document.body)
      pendingFocus = null;
    const focusKey = pendingFocus?.control;
    const focusAction = pendingFocus?.action;
    const focusDetails = pendingFocus?.details;
    const expanded = new Map(
      Array.from(
        card.querySelectorAll<HTMLDetailsElement>('details[data-fisherai-drama-details]'),
      ).map((details) => [details.dataset.fisheraiDramaDetails, details.open]),
    );
    const scrollParent =
      card.closest<HTMLElement>('[data-fisherai-agent-scroll]') || card.parentElement;
    const scrollTop = scrollParent?.scrollTop;
    // Follow a newly appended compact summary only if the user was already at the
    // end of the conversation. Status updates and reading history/details stay put.
    const followSummary =
      newSummary &&
      !expanded.get('plan') &&
      Boolean(scrollParent) &&
      scrollParent!.scrollHeight - scrollParent!.clientHeight - (scrollTop || 0) <= 48;
    card.hidden = false;
    card.replaceChildren();
    const disabled = busy || snapshot.busy;
    const plan = state.plan;
    if (plan) {
      const profile = productionProfileForBundle(plan.bundleId);
      const assetOnly = profile?.mode === 'assets';
      const latest = latestAssets(state);
      const title = element('strong', plan.title);
      card.append(title);
      const completed = plan.assets.filter(
        (asset) => latest.get(asset.id)?.status === 'success',
      ).length;
      const progress = element(
        'p',
        `${plan.assets.filter((asset) => asset.kind === 'character').length} 人物 · ${plan.assets.filter((asset) => asset.kind === 'scene').length} 场景 · ${assetOnly ? '武戏资产准备' : `${plan.segments.length} 段文戏`} · 资产已落盘 ${completed}/${plan.assets.length}`,
      );
      progress.dataset.fisheraiDramaProgress = 'true';
      card.append(progress);
      const details = element('details');
      details.dataset.fisheraiDramaDetails = 'plan';
      details.open = expanded.get('plan') ?? false;
      const summary = element('summary', '查看计划与执行选项');
      summary.dataset.fisheraiDramaDetailsSummary = 'plan';
      details.append(summary);
      details.append(
        element(
          'p',
          '在下方继续对话即可修改计划。生成开始后的改稿会保留原计划与素材，不覆盖原图。',
        ),
      );
      for (const asset of plan.assets) {
        const receipt = latest.get(asset.id);
        const eligible = !receipt || (receipt.status === 'failed' && receipt.retryable === true);
        const row = element('div');
        row.dataset.fisheraiDramaAsset = asset.id;
        row.className = 'fisher-drama-inline-asset';
        row.append(
          check(
            `${asset.name} · ${asset.kind === 'character' ? '人物 RH' : '场景 即梦 5 API'}${receipt ? ` · ${LABELS[receipt.status] || receipt.status}` : ''}`,
            `选择资产 ${asset.name}`,
            selected.has(asset.id),
            (value) => {
              if (value && selected.size < MAX_BATCH) selected.add(asset.id);
              else selected.delete(asset.id);
              paidConsent = false;
            },
            disabled || !eligible,
          ),
        );
        if (receipt?.error) row.append(element('p', receipt.error));
        if (receipt?.status === 'unknown')
          row.append(element('p', '提交是否成功尚未确定，只能查询原任务，不能重新生成。'));
        details.append(row);
      }
      const segments = element('details');
      segments.dataset.fisheraiDramaDetails = 'segments';
      segments.open = expanded.get('segments') ?? false;
      const segmentSummary = element('summary', '查看分段与连续性');
      segmentSummary.dataset.fisheraiDramaDetailsSummary = 'segments';
      segments.append(segmentSummary);
      for (const segment of plan.segments)
        segments.append(
          element(
            'p',
            `${segment.title} · ${segment.duration} 秒 · ${segment.characterIds.map((id) => plan.assets.find((asset) => asset.id === id)?.name || id).join('、')}\n${segment.blocking}\n结束状态：${segment.endState}`,
          ),
        );
      if (!assetOnly) details.append(segments);
      if (profile)
        details.append(
          element(
            'p',
            `当前组合：${profile.name}。视频应用 ${profile.webAppId}；创建节点不会运行视频。`,
          ),
        );
      const questions = [...plan.questions, ...plan.assets.flatMap((asset) => asset.questions)];
      if (questions.length)
        card.append(
          element('p', `待确认：${questions.join('；')}。请通过对话补充，再确认资产清单。`),
        );
      const approved = plan.approvedRevision === plan.revision;
      details.append(
        button(
          approved ? '资产清单已确认' : '确认资产清单（不生成）',
          'approve',
          () =>
            void action(async (tools) => {
              await tools.action({
                action: 'approve',
                planId: plan.id,
                planRevision: plan.revision,
              });
              if (!tools.current()) return;
              status('资产清单已确认。请选择本批图片，明确同意调用后才会生成。');
            }),
          disabled || approved || questions.length > 0,
        ),
      );
      const eligibleIds = plan.assets
        .filter((asset) => !latest.has(asset.id))
        .map((asset) => asset.id)
        .slice(0, MAX_BATCH);
      details.append(
        button(
          '选择未生成资产',
          'select',
          () => {
            selected.clear();
            eligibleIds.forEach((id) => selected.add(id));
            paidConsent = false;
            render();
          },
          disabled || !eligibleIds.length,
        ),
      );
      const targets = plan.assets.filter((asset) => selected.has(asset.id));
      const targetLabel = targets.map((asset) => asset.name).join('、') || '尚未选择';
      details.append(
        element(
          'p',
          `本批：${targetLabel}。人物使用官方人物 RH 工作流，场景使用即梦 5 API；相应提示词将发送到对应服务。每项最多提交 1 次，每批最多 ${MAX_BATCH} 项。失败或结果未知即停止后续。`,
        ),
      );
      details.append(
        check(
          `确认本批 ${targets.length} 项图片可能产生费用；不生成视频。失败项再次选择表示确认一次新的尝试。`,
          '确认本批资产调用（不会生成视频）',
          paidConsent,
          (value) => {
            paidConsent = value;
          },
          disabled || !approved || !targets.length,
        ),
      );
      details.append(
        button(
          running ? '正在生成资产…' : `生成所选资产（${targets.length} 项）`,
          'generate',
          () =>
            batch(
              plan,
              targets.map((asset) => asset.id),
            ),
          disabled || !approved || !paidConsent || !targets.length,
        ),
      );
      card.append(details);
      const operations = element('div');
      operations.className = 'fisher-drama-inline-operations';
      const stopButton = button('停止后续', 'stop', () => stop(), !running);
      stopButton.hidden = !running;
      operations.append(stopButton);
      if (running)
        operations.append(
          element('p', '本批运行时暂锁定发送；停止后续并等当前请求返回，即可继续自由对话。'),
        );
      const query = button(
        '查询原任务',
        'query',
        () =>
          void action(async (tools) => {
            const result = await tools.action({
              action: 'query',
              planId: plan.id,
              planRevision: plan.revision,
            });
            await mergeAssets(result);
            if (tools.current()) status('已查询原任务并同步真实结果；没有重新提交生成。');
          }),
        disabled,
      );
      query.hidden = !latest.size;
      operations.append(query);
      card.append(operations);
      const allReady =
        plan.assets.length > 0 &&
        plan.assets.every((asset) => latest.get(asset.id)?.status === 'success');
      details.append(
        check(
          `我已检查当前人物和场景图像，确认将它们连接到${assetOnly ? '武戏' : '文戏'}草稿；不运行视频。`,
          '确认当前资产图像',
          compositionConsent,
          (value) => {
            compositionConsent = value;
          },
          disabled || !allReady,
        ),
      );
      details.append(
        button(
          `确认资产并创建${assetOnly ? '武戏' : '文戏'}节点`,
          'compose',
          () =>
            void action(async (tools) => {
              if (!compositionConsent || !window.__FISHERAI_WORKFLOW_NODES__)
                throw new Error('请确认资产并等待工作流模块就绪。');
              compositionConsent = false;
              const result = await tools.action({
                action: 'compose',
                planId: plan.id,
                planRevision: plan.revision,
                confirmAssets: true,
              });
              if (!tools.current() || !result.composition)
                throw new Error('没有取得真实组装回执，未写入文戏节点。');
              const nodes = buildDramaCanvasNodes(
                result.composition,
                window.__FISHERAI_WORKFLOW_NODES__,
              );
              await canvas.commit(
                plan.projectId,
                (previous) =>
                  tools.current()
                    ? mergeDramaCanvasNodes(previous, nodes, {
                        projectId: plan.projectId,
                        expectedProjectId: canvas.projectId() || '',
                      })
                    : [...previous],
                { select: false },
              );
              if (tools.current())
                status(
                  `${assetOnly ? '武戏' : '文戏'}草稿及资产连线已加入当前画布，重复创建不会覆盖已有节点。视频尚未运行，请检查对应节点的提示词，再单独确认运行。`,
                );
            }),
          disabled || !allReady || !compositionConsent,
        ),
      );
    }
    const message = note || snapshot.error;
    if (message) {
      const output = element('p', message);
      output.className = 'fisher-drama-inline-status';
      output.setAttribute('role', noteError || snapshot.error ? 'alert' : 'status');
      card.append(output);
    }
    const focus = Array.from(
      card.querySelectorAll<HTMLElement>(
        '[data-fisherai-drama-control],[data-fisherai-drama-action],[data-fisherai-drama-details-summary]',
      ),
    ).find(
      (node) =>
        (focusKey && node.dataset.fisheraiDramaControl === focusKey) ||
        (focusAction && node.dataset.fisheraiDramaAction === focusAction) ||
        (focusDetails && node.dataset.fisheraiDramaDetailsSummary === focusDetails),
    );
    focus?.focus({ preventScroll: true });
    if (document.activeElement === focus) pendingFocus = null;
    if (scrollParent && scrollTop !== undefined) {
      scrollParent.scrollTop = followSummary
        ? Math.max(0, scrollParent.scrollHeight - scrollParent.clientHeight)
        : scrollTop;
    }
    renderedPlanKey = nextRenderedPlanKey;
  }

  const update = () => {
    const snapshot = conversation.snapshot();
    const key = `${snapshot.sessionId || ''}:${snapshot.projectId || ''}:${snapshot.selectedSkill?.source || ''}:${snapshot.selectedSkill?.slug || ''}`;
    if (key !== context) {
      context = key;
      contextEpoch += 1;
      stop(false);
      note = '';
      noteError = false;
      selected.clear();
      compositionConsent = false;
      canvasSignature = '';
      pendingFocus = null;
    }
    const nextPlan = snapshot.state?.plan
      ? `${snapshot.state.plan.id}:${snapshot.state.plan.revision}`
      : '';
    if (nextPlan !== planKey) {
      planKey = nextPlan;
      selected.clear();
      paidConsent = false;
      compositionConsent = false;
      // Attachment-only feedback must not keep saying "未调用模型" after a plan reply.
      note = '';
      noteError = false;
    }
    render();
    if (isDramaSelected() && snapshot.state && snapshot.sessionId && snapshot.projectId) {
      const active = scope(snapshot.sessionId, snapshot.projectId);
      void mergeAssets(snapshot.state).catch((cause) => {
        if (active())
          status(cause instanceof Error ? cause.message : '资产暂未写入画布，请查询原任务。', true);
      });
    }
  };
  const mount = () => {
    const content = document.querySelector('[data-fisherai-agent-conversation-content]');
    if (!content) {
      if (card || attachment) {
        contextEpoch += 1;
        stop(false);
        card?.remove();
        attachment?.remove();
        card = null;
        attachment = null;
      }
      return;
    }
    let changed = false;
    if (card?.parentElement !== content) {
      if (card) {
        contextEpoch += 1;
        stop(false);
        card.remove();
      }
      card = element('section');
      card.dataset.fisheraiDramaConversationTools = 'true';
      card.className = 'fisher-drama-inline';
      card.setAttribute('aria-label', '当前任务');
      content.append(card);
      changed = true;
    }
    const composer = document.querySelector('[data-fisherai-agent-composer]');
    const contextSlot = document.querySelector('[data-fisherai-agent-context-slot]');
    const attachmentParent = contextSlot || composer?.parentElement;
    if (attachmentParent && attachment?.parentElement !== attachmentParent) {
      attachment?.remove();
      attachment = element('div');
      attachment.dataset.fisheraiDramaAttachment = 'true';
      attachment.className = 'fisher-drama-attachment';
      if (contextSlot) contextSlot.append(attachment);
      else composer?.before(attachment);
      changed = true;
    }
    if (!composer && attachment) {
      attachment.remove();
      attachment = null;
      changed = true;
    }
    if (changed) update();
  };
  const unsubscribe = conversation.subscribe(update);
  const uncanvas = canvas.subscribe(update);
  const unobserve = observeStableEnhancement(mount);
  const hidden = () => {
    if (document.hidden) stop();
  };
  document.addEventListener('visibilitychange', hidden);
  const style = element('style');
  style.textContent = `.fisher-drama-inline{margin:12px 0;padding:8px 0;border-top:1px solid var(--af-border);color:var(--af-text);font:12px/1.6 Inter,"Microsoft YaHei UI",sans-serif;overflow-wrap:anywhere}.fisher-drama-inline[hidden],.fisher-drama-attachment[hidden]{display:none}.fisher-drama-inline p{margin:6px 0;color:var(--af-text-secondary);white-space:pre-wrap}.fisher-drama-inline strong{display:block;font-size:13px}.fisher-drama-inline details{margin-top:8px}.fisher-drama-inline summary{cursor:pointer;font-weight:600}.fisher-drama-inline button,.fisher-drama-attachment button{margin:6px 6px 0 0;padding:6px 8px;border:1px solid var(--af-border-control);border-radius:6px;background:var(--af-surface-raised);color:var(--af-text);cursor:pointer;font:inherit}.fisher-drama-inline button:disabled,.fisher-drama-inline input:disabled,.fisher-drama-attachment button:disabled{opacity:.45;cursor:not-allowed}.fisher-drama-inline :is(button,input,summary):focus-visible,.fisher-drama-attachment button:focus-visible{outline:2px solid var(--af-info);outline-offset:2px}.fisher-drama-inline-check{display:flex;align-items:flex-start;gap:7px;margin:8px 0}.fisher-drama-inline-check input{margin-top:4px;accent-color:var(--af-border-control);flex:none}.fisher-drama-inline-asset{border-top:1px solid var(--af-border);padding-top:2px}.fisher-drama-inline .fisher-drama-inline-status{color:var(--af-text)}.fisher-drama-inline [role=alert],.fisher-drama-attachment [role=alert]{color:var(--af-danger)}.fisher-drama-attachment{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0;margin:0 0 6px;color:var(--af-text-secondary);font:12px/1.5 Inter,"Microsoft YaHei UI",sans-serif}.fisher-drama-attachment button{flex:none;margin:0;padding:4px 7px;background:transparent}.fisher-drama-attachment-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:calc(100% - 90px)}.fisher-drama-attachment p{flex-basis:100%;margin:0;overflow-wrap:anywhere}.fisher-drama-inline-operations:empty{display:none}`;
  document.head.append(style);
  return () => {
    disposed = true;
    stop(false);
    unsubscribe();
    uncanvas();
    unobserve();
    card?.remove();
    attachment?.remove();
    style.remove();
    document.removeEventListener('visibilitychange', hidden);
  };
}
