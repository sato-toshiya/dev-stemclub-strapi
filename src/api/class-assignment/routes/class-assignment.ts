export default {
  routes: [
    {
      method: 'POST',
      path: '/class-assignments/assign',
      handler: 'class-assignment.assignProjectsToClass',
      auth: { required: true },
    },
    {
      method: 'GET',
      path: '/class-assignments/my',
      handler: 'class-assignment.myClassAssignments',
      auth: { required: true },
    },
    {
      method: 'GET',
      path: '/class-assignments/for-student',
      handler: 'class-assignment.studentClassAssignments',
      auth: { required: true },
    },
    {
      method: 'POST',
      path: '/class-assignments/:id/submit',
      handler: 'class-assignment.submitToClassAssignment',
      auth: { required: true },
    },
  ],
};
