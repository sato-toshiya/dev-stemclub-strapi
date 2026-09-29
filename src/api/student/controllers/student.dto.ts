import type { Gender, GuardianRelationship } from '../../../constants/enums';

export type StudentInput = {
  name: string;
  name_kana: string;
  birthday?: string;
  gender: Gender;
  guardian_name: string;
  guardian_phone?: string;
  emergency_phone?: string;
  code?: string;
  grade?: string | null;
  address?: string | null;
  guardian_email?: string | null;
  guardian_relationship?: GuardianRelationship | null;
  enrollment_date?: string | null;
  notes?: string | null;

  qr_token: string;
  users_permissions_user: number;
  school_admin: number;
};

export type StudentUpdateInput = Record<string, unknown>;
