import type { Predicate } from './types.js';

export function GrantScopeForm({
  predicate,
  onChange,
}: {
  predicate: Predicate;
  onChange(predicate: Predicate): void;
}) {
  return (
    <div className="scope-form">
      <label>
        Context path
        <input
          value={predicate.path}
          placeholder="/groupId"
          onChange={(event) =>
            onChange({ ...predicate, path: event.target.value })
          }
        />
      </label>
      <label>
        Operator
        <select
          value={predicate.operator}
          onChange={(event) =>
            onChange({
              ...predicate,
              operator: event.target.value as Predicate['operator'],
            })
          }
        >
          <option value="equals">equals</option>
          <option value="in">in</option>
          <option value="startsWith">startsWith</option>
          <option value="exists">exists</option>
        </select>
      </label>
      {predicate.operator !== 'exists' && (
        <label>
          Value
          <input
            value={String(predicate.value ?? '')}
            onChange={(event) =>
              onChange({ ...predicate, value: event.target.value })
            }
          />
        </label>
      )}
      <code>{JSON.stringify(predicate)}</code>
    </div>
  );
}
