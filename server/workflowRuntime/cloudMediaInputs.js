const MEDIA_KINDS = ['image', 'video', 'audio'];

export function decodeFieldData(value) {
  if (typeof value !== 'string') return value;
  if (value.length > 64 * 1024 || !/^\s*[[{]/.test(value)) return undefined;
  try { return JSON.parse(value); } catch { return undefined; }
}

export function fieldDataSettings(value) {
  const decoded = decodeFieldData(value);
  return Array.isArray(decoded) ? decoded[1] : decoded;
}

export function uploadMediaKind(field) {
  const settings = fieldDataSettings(field?.fieldData);
  return MEDIA_KINDS.find(kind => settings?.[`${kind}_upload`] === true || field?.[`${kind}_upload`] === true);
}

function isEmptyMediaValue(value) {
  return typeof value === 'string' && (value === '' || /^(?:none|null)$/i.test(value));
}

/** Keep the exact sentinel advertised by the app; a filename is never an empty value. */
export function mediaEmptyContract(field, options) {
  const settings = fieldDataSettings(field?.fieldData);
  for (const source of [field, settings]) {
    for (const key of ['fieldValue', 'defaultValue', 'value', 'default']) {
      if (source && Object.hasOwn(source, key) && isEmptyMediaValue(source[key])) {
        return { version: 1, emptyValue: source[key] };
      }
    }
  }
  const emptyValue = options.find(isEmptyMediaValue);
  return { version: 1, ...(emptyValue === undefined ? {} : { emptyValue }) };
}

export function isCloudDeployment(deployment) {
  return ['runninghub-webapp', 'runninghub-workflow'].includes(deployment?.runner);
}

export function cloudMediaEmptyValue(deployment, binding, executionPlan) {
  const input = deployment.relevantCapabilities?.[binding.target.expectedClassType]?.input;
  const spec = input?.required?.[binding.target.fieldName] ?? input?.optional?.[binding.target.fieldName];
  const settings = Array.isArray(spec) ? spec[1] : undefined;
  const contract = settings?.fisheraiMediaInput;
  if (contract?.version === 1) return contract;
  // Native API workflows and older imports can still prove an empty value from
  // their actual schema/default. Never guess from an application ID or filename.
  const options = Array.isArray(spec?.[0]) ? spec[0] : settings?.options || [];
  return mediaEmptyContract({ fieldValue: executionPlan[binding.target.nodeId]?.inputs?.[binding.target.fieldName], fieldData: settings },
    Array.isArray(options) ? options : []);
}

export function isAbsentMediaInput(value) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}
