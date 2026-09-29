export const GENDERS = ['male', 'female', 'other'] as const;
export type Gender = (typeof GENDERS)[number];

export const toGender = (v: unknown): Gender | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return (GENDERS as readonly string[]).includes(s) ? (s as Gender) : null;
};
export const GUARDIAN_RELATIONSHIPS = [
  'father',
  'mother',
  'grandfather',
  'grandmother',
  'other',
] as const;

export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];

export const toGuardianRelationship = (v: unknown): GuardianRelationship | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return (GUARDIAN_RELATIONSHIPS as readonly string[]).includes(s)
    ? (s as GuardianRelationship)
    : null;
};

export const ACADEMIC_STATUSES = ['active', 'pending', 'archived'] as const;
export type AcademicStatus = (typeof ACADEMIC_STATUSES)[number];

export const toAcademicStatus = (v: unknown): AcademicStatus | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return (ACADEMIC_STATUSES as readonly string[]).includes(s) ? (s as AcademicStatus) : null;
};
