export const ensureAuthUserId = (ctx): number | null => {
  const authUser = ctx.state?.user as { id?: number } | undefined;
  return typeof authUser?.id === 'number' ? authUser.id : null;
};
