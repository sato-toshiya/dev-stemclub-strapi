export default {
  routes: [
    {
      method: 'POST',
      path: '/projects/upload',
      handler: 'project.uploadProjectMultipart',
      config: { auth: { required: true } },
    },
    {
      method: 'GET',
      path: '/projects/my',
      handler: 'project.myProjects',
      config: { auth: { required: true } },
    },
    {
      method: 'PUT',
      path: '/projects/:id/edit',
      handler: 'project.editProjectMultipart',
      config: { auth: { required: true } },
    },
    {
      method: 'GET',
      path: '/projects/by-student',
      handler: 'project.listByStudent',
      config: { auth: { required: true } },
    },
    {
      method: 'GET',
      path: '/projects/by-class',
      handler: 'project.listByClass',
      config: { auth: { required: true } },
    },
    {
      method: 'GET',
      path: '/projects/by-class-days',
      handler: 'project.listClassDaysByMonth',
      config: { auth: { required: true } },
    },
    {
      method: 'DELETE',
      path: '/projects/admin/:id',
      handler: 'project.adminDelete',
      config: { auth: { required: true } },
    },
    {
      method: 'PUT',
      path: '/projects/admin/:id/title',
      handler: 'project.adminRename',
      config: { auth: { required: true } },
    },
    {
      method: 'PUT',
      path: '/projects/admin/:id/transfer-student',
      handler: 'project.adminTransferStudent',
      config: { auth: { required: true } },
    },
    {
      method: 'POST',
      path: '/projects/admin/share-day',
      handler: 'project.adminCreateDayShare',
      config: { auth: { required: true } },
    },
    {
      method: 'POST',
      path: '/projects/admin/:id/share',
      handler: 'project.adminCreateShare',
      config: { auth: { required: true } },
    },
    {
      method: 'POST',
      path: '/projects/share/day/resolve',
      handler: 'project.publicResolveDayShare',
      config: { auth: { required: false } },
    },
    {
      method: 'POST',
      path: '/projects/share/resolve',
      handler: 'project.publicResolveShare',
      config: { auth: { required: false } },
    },
  ],
};
