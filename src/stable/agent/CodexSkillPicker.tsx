import { useEffect, useState } from 'react';
import { createAgentSkillClient, type AgentSkill } from '../skills/skillClient';

export function CodexSkillPicker({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange(value: string | null): void;
  disabled: boolean;
}) {
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    void createAgentSkillClient()
      .list()
      .then((items) => {
        if (current) setSkills(items);
      })
      .catch(() => {
        if (current) setError('技能目录读取失败，请重新打开助手。');
      });
    return () => {
      current = false;
    };
  }, []);
  return (
    <div className="mb-2 text-xs text-[var(--af-text-secondary)]">
      <label className="flex items-center gap-2">
        SKILL
        <select
          aria-label="Codex 当前技能"
          value={value || ''}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value || null)}
          className="min-w-0 flex-1 bg-[var(--af-surface)] border border-[var(--af-border-control)] rounded-md p-2 text-[var(--af-text)]"
        >
          <option value="">普通对话</option>
          {value && !skills.some((item) => item.slug === value) && (
            <option value={value}>{value}</option>
          )}
          {skills.map((skill) => (
            <option key={skill.slug} value={skill.slug}>
              {skill.name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="mt-1 text-[var(--af-warning)]">
          {error}
        </p>
      )}
    </div>
  );
}
