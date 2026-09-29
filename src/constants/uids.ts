export const UID = {
  class: 'api::class.class',
  teacher: 'api::teacher.teacher',
  academicYear: 'api::academic-year.academic-year',
  student: 'api::student.student',
  project: 'api::project.project',
  agencyAdmin: 'api::agency-admin.agency-admin',
  schoolAdmin: 'api::school-admin.school-admin',
  classAssignment: 'api::class-assignment.class-assignment',
  assignmentSubmission: 'api::assignment-submission.assignment-submission',
} as const;

export type ContentUID = (typeof UID)[keyof typeof UID];
