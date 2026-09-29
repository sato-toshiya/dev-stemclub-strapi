export default {
  routes: [
    {
      method: 'POST',
      path: '/students/login-by-qr',
      handler: 'student.loginByQr',
      config: {
        auth: { required: false },
      },
    },
    {
      method: 'POST',
      path: '/students/:id/regenerate-qr',
      handler: 'student.regenerateQr',
      config: {
        auth: { required: true },
      },
    },
    {
      method: 'GET',
      path: '/students/export-qr-pdf',
      handler: 'student.exportQrPdf',
      config: {
        auth: { required: true },
      },
    },
    {
      method: 'GET',
      path: '/students/:id/export-qr-pdf',
      handler: 'student.exportQrPdfOne',
      config: {
        auth: { required: true },
      },
    },
    {
      method: 'POST',
      path: '/students/mark-seen',
      handler: 'student.markSeen',
      config: {
        auth: { required: true },
      },
    },
    {
      method: 'POST',
      path: '/students/import',
      handler: 'student.importStudents',
      config: { auth: { required: true } },
    },
  ],
};
