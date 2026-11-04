import { normalizeSettings } from '../shared/settings.js';
import { failure } from '../providers/errors.js';

const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const conflict = () => { throw failure('SETTINGS_CONFLICT', '设置已在另一窗口更改，请重新读取设置后再保存。'); };

function mergeFields(base, draft, current, ignored = new Set()) {
  const result = structuredClone(current);
  for (const key of Object.keys(draft)) {
    if (ignored.has(key) || equal(draft[key], base[key])) continue;
    if (!equal(current[key], base[key]) && !equal(current[key], draft[key])) conflict();
    result[key] = structuredClone(draft[key]);
  }
  return result;
}

/** Apply only the fields this window edited, against the current serialized record. */
export function mergeSettings(base, draft, current) {
  const groups=['pageStyle','subtitleStyle','pageOptions','selectionOptions','inputOptions','hoverOptions'];
  const result = mergeFields(base, draft, current, new Set(['schemaVersion', 'providerRevision', 'providers', 'showOriginal', ...groups]));
  for (const key of groups) result[key]=mergeFields(base[key] || {},draft[key] || {},current[key] || {});
  const original = new Map(base.providers.map(provider => [provider.id, provider]));
  const wanted = new Map(draft.providers.map(provider => [provider.id, provider]));
  const latest = new Map(current.providers.map(provider => [provider.id, provider]));

  for (const [id, before] of original) {
    const after = wanted.get(id), now = latest.get(id);
    if (!after) {
      if (now && !equal(now, before)) conflict();
      latest.delete(id);
      continue;
    }
    if (equal(before, after)) continue; // Preserve another window's edit or deletion.
    if (!now) conflict();

    // A new credential must never silently follow another window's recipient change.
    const changedRecipient = after.type !== before.type || after.baseUrl !== before.baseUrl;
    const latestRecipient = now.type !== before.type || now.baseUrl !== before.baseUrl;
    if (changedRecipient && now.apiKey !== before.apiKey && after.apiKey !== now.apiKey) conflict();
    if (after.apiKey !== before.apiKey && latestRecipient && (after.type !== now.type || after.baseUrl !== now.baseUrl)) conflict();
    latest.set(id, mergeFields(before, after, now, new Set(['id'])));
  }
  for (const [id, added] of wanted) {
    if (original.has(id)) continue;
    if (latest.has(id) && !equal(latest.get(id), added)) conflict();
    latest.set(id, structuredClone(added));
  }
  result.providers = [...latest.values()];
  return normalizeSettings(result);
}
