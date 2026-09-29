import { UID } from '../../constants/uids';

export type TeacherActor = {
  id: number;
  documentId: string;
  schoolAdminId: number;
  schoolAdminDocId: string;
};

export type StudentActor = {
  id: number;
  documentId: string;
  name?: string;
  schoolAdminId: number;
  schoolAdminDocId: string;
  classId?: number;
  classDocId?: string;
};

export type Actor =
  | { kind: 'teacher'; teacher: TeacherActor }
  | { kind: 'student'; student: StudentActor };

export const resolveActorByUserId = async (strapi, userId: number): Promise<Actor | null> => {
  const teacher =
    (await strapi.db.query(UID.teacher).findOne({
      where: { users_permissions_user: userId },
      select: ['id', 'documentId'],
      populate: { school_admin: { select: ['id', 'documentId'] } },
    })) ??
    (await strapi.db.query(UID.teacher).findOne({
      where: { users_permissions_user: { id: userId } },
      select: ['id', 'documentId'],
      populate: { school_admin: { select: ['id', 'documentId'] } },
    }));

  if (teacher?.id && teacher?.school_admin?.id && teacher?.school_admin?.documentId) {
    return {
      kind: 'teacher',
      teacher: {
        id: teacher.id,
        documentId: String(teacher.documentId ?? ''),
        schoolAdminId: teacher.school_admin.id,
        schoolAdminDocId: String(teacher.school_admin.documentId ?? ''),
      },
    };
  }

  const student =
    (await strapi.db.query(UID.student).findOne({
      where: { users_permissions_user: userId },
      select: ['id', 'documentId', 'name'],
      populate: {
        class: { select: ['id', 'documentId'] },
        school_admin: { select: ['id', 'documentId'] },
      },
    })) ??
    (await strapi.db.query(UID.student).findOne({
      where: { users_permissions_user: { id: userId } },
      select: ['id', 'documentId', 'name'],
      populate: {
        class: { select: ['id', 'documentId'] },
        school_admin: { select: ['id', 'documentId'] },
      },
    }));

  if (student?.id && student?.school_admin?.id && student?.school_admin?.documentId) {
    return {
      kind: 'student',
      student: {
        id: student.id,
        documentId: String(student.documentId ?? ''),
        name: typeof student.name === 'string' ? student.name : undefined,
        schoolAdminId: student.school_admin.id,
        schoolAdminDocId: String(student.school_admin.documentId ?? ''),
        classId: typeof student.class?.id === 'number' ? student.class.id : undefined,
        classDocId:
          typeof student.class?.documentId === 'string' ? student.class.documentId : undefined,
      },
    };
  }

  return null;
};
