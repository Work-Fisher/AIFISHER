import { app } from "../../../scripts/app.js";

const SETTING_ID = "FisherAI.NodeIds.Show";
let showNodeIds = true;

function drawRoundedRect(ctx, x, y, width, height, radius) {
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    return;
  }

  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
}

function drawNodeIdBadge(ctx, node) {
  if (!showNodeIds || node?.id === undefined || node?.id === null || node.id === -1) {
    return;
  }

  const label = `#${node.id}`;
  const titleHeight = Number(globalThis.LiteGraph?.NODE_TITLE_HEIGHT ?? 30);
  const badgeHeight = Math.max(18, titleHeight - 8);

  ctx.save();
  ctx.font = "600 12px ui-monospace, SFMono-Regular, Consolas, monospace";
  const badgeWidth = Math.ceil(ctx.measureText(label).width) + 12;
  const x = Math.max(6, Number(node.size?.[0] ?? badgeWidth + 14) - badgeWidth - 8);
  const y = -titleHeight + Math.max(3, (titleHeight - badgeHeight) / 2);

  drawRoundedRect(ctx, x, y, badgeWidth, badgeHeight, 5);
  ctx.fillStyle = "rgba(8, 15, 24, 0.88)";
  ctx.fill();
  ctx.strokeStyle = "rgba(96, 165, 250, 0.95)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#dbeafe";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + badgeWidth / 2, y + badgeHeight / 2 + 0.5);
  ctx.restore();
}

app.registerExtension({
  name: "FisherAI.NodeIds",

  setup() {
    const setting = app.ui.settings.addSetting({
      id: SETTING_ID,
      name: "AIFISHER：在节点标题显示编号",
      tooltip: "显示工作流 JSON 中的节点实例 ID，方便与 AIFISHER 外置参数对应。",
      type: "boolean",
      defaultValue: true,
      onChange(value) {
        showNodeIds = value !== false;
        app.graph?.setDirtyCanvas?.(true, true);
      },
    });

    showNodeIds = setting?.value !== false;
  },

  nodeCreated(node) {
    const originalOnDrawTitle = node.onDrawTitle;

    node.onDrawTitle = function (ctx) {
      const result = originalOnDrawTitle?.apply?.(this, arguments);
      drawNodeIdBadge(ctx, this);
      return result;
    };
  },
});
