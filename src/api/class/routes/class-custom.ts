export default {
  routes: [
    {
      method: 'GET',
      path: '/classes/available',
      handler: 'class.available',
      config: {
        auth: { required: true },
      },
    },
    {
      method: 'GET',
      path: '/classes/my',
      handler: 'class.myClasses',
      config: {
        auth: { required: true },
      },
    },
    {
      method: 'GET',
      path: '/classes/active',
      handler: 'class.active',
      config: {
        auth: { required: true },
      },
    },
    {
      method: 'GET',
      path: '/classes/by-academic-year',
      handler: 'class.byAcademicYear',
      config: {
        auth: { required: true },
      },
    },
  ],
};
