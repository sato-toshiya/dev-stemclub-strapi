export default (plugin: any) => {
  const defaultMe = plugin.controllers.user.me;

  plugin.controllers.user.me = async (ctx: any) => {
    const res = await defaultMe(ctx);
    const authUser = ctx.state.user;

    if (!authUser?.id) {
      return res;
    }

    const fullUser = await strapi.entityService.findOne(
      'plugin::users-permissions.user',
      authUser.id,
      {
        populate: {
          role: true,
          school_admin: true,
        },
      }
    );

    if (!fullUser) return res;

    const { _password, resetPasswordToken, confirmationToken, ...safe } = fullUser as any;

    ctx.body = safe;
    return ctx.body;
  };

  return plugin;
};
