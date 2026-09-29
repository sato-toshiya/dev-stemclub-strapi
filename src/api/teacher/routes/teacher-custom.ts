export default {
  routes: [
    {
      method: 'GET',
      path: '/teachers/class-students-presence',
      handler: 'teacher.studentsPresenceInClass',
      config: {
        auth: { required: true },
      },
    },
    {
      method: 'POST',
      path: '/teachers/login-by-passcode',
      handler: 'teacher.loginByPasscode',
      config: {
        auth: { required: false },
      },
    },
    {
      method: 'POST',
      path: '/teachers/import',
      handler: 'teacher.importTeachers',
      config: { auth: { required: true } },
    },
  ],
};
