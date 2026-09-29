import type { Modules } from '@strapi/types';

export const SAFE_USER_FIELDS = [
  'id',
  'documentId',
  'username',
  'email',
  'phone',
  'blocked',
  'confirmed',
] as const;

type StudentPopulate = Modules.Documents.Params.Populate.Any<'api::student.student'>;

export const POPULATE_SAFE: StudentPopulate = {
  class: {
    fields: ['name', 'documentId'],
    populate: {
      academic_year: { fields: ['documentId', 'name', 'academic_status'] },
    },
  },
  users_permissions_user: { fields: [...SAFE_USER_FIELDS] },
  school_admin: { fields: ['id', 'documentId', 'name'] },
};

export type SafeUser = {
  id: number;
  documentId: string;
  username?: string;
  email?: string;
  phone?: string;
  blocked?: boolean;
  confirmed?: boolean;
};

export type SafeAcademicYear = {
  documentId: string;
  name?: string;
  academic_status?: 'active' | 'pending' | 'inactive' | null;
};

export type SafeClass = {
  documentId: string;
  name?: string;
  academic_year?: SafeAcademicYear | null;
};
export type SafeSchoolAdmin = { id: number; documentId: string; name?: string };

export type StudentSafeRow = {
  id: number;
  documentId: string;
  name?: string;
  name_kana?: string;
  birthday?: string | null;
  gender?: 'male' | 'female' | 'other' | null;
  code?: string | null;
  grade?: string | null;

  guardian_name?: string;
  guardian_relationship?: 'father' | 'mother' | 'grandfather' | 'grandmother' | 'other' | null;
  guardian_phone?: string | null;
  emergency_phone?: string | null;

  guardian_email?: string | null;
  address?: string | null;
  enrollment_date?: string | null;
  notes?: string | null;

  class?: SafeClass | null;
  users_permissions_user?: SafeUser | null;
  school_admin?: SafeSchoolAdmin | null;
};
