export default {
  routes: [
    {
      method: 'GET',
      path: '/academic-years-with-stats',
      handler: 'academic-year.listWithStats',
      config: {
        auth: { required: true },
      },
    },
  ],
};
