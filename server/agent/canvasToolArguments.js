import { canvasControlTool } from '../../src/shared/canvasControlProtocol.js';

const properties = canvasControlTool.inputSchema.properties;
const enumFields = {
  action: properties.action.enum,
  operation: properties.operation.enum,
  type: properties.type.enum,
  kind: properties.operations.items.properties.kind.enum,
};

/** Some tool streams return {"action": read}. Quote only declared enum values;
 * preserve quoted data verbatim and leave all other invalid syntax rejected. */
export function parseCanvasToolArguments(raw) {
  try { return JSON.parse(raw); } catch { /* Check the narrow bare-enum form. */ }
  let repaired = '';
  for (let index = 0; index < raw.length;) {
    if (raw[index] !== '"') { repaired += raw[index++]; continue; }
    const start = index++;
    while (index < raw.length) {
      if (raw[index] === '\\') { index += 2; continue; }
      if (raw[index++] === '"') break;
    }
    const token = raw.slice(start, index);
    repaired += token;
    let key;
    try { key = JSON.parse(token); } catch { return undefined; }
    if (!Object.hasOwn(enumFields, key)) continue;
    const match = raw.slice(index).match(/^(\s*:\s*)([A-Za-z][A-Za-z0-9]*)(?=\s*[,}])/);
    if (!match || !enumFields[key].includes(match[2])) continue;
    repaired += match[1] + JSON.stringify(match[2]);
    index += match[0].length;
  }
  try { return JSON.parse(repaired); } catch { return undefined; }
}
