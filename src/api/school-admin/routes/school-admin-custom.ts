export default {
  routes: [
    {
      method: 'POST',
      path: '/school-admins/import',
      handler: 'school-admin.importSchoolAdmins',
      config: { auth: { required: true } },
    },
  ],
};
