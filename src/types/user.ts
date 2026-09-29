export type UserWithoutSecrets = {
  id?: number;
  email?: string;
  username?: string;
  phone?: string;
  blocked?: boolean;
  confirmed?: boolean;
  [key: string]: unknown;
};
