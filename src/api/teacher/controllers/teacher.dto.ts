import { toGender } from '../../../constants/enums';

export type TeacherCreateInput = {
  name: string;
  name_kana: string;
  birthday: string | null;
  phone: string | null;
  gender: ReturnType<typeof toGender>;
  email: string;
  blocked: boolean;
};

export type TeacherUpdateInput = {
  name: string;
  name_kana?: string | null;
  birthday?: string | null;
  phone?: string | null;
  gender: ReturnType<typeof toGender>;
  email?: string | null;
  blocked: boolean;
};
