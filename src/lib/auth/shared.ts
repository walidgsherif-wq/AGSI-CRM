// Shared auth constants safe for both client and server bundles.
// Anything that requires `next/headers` or other server-only APIs must live in
// get-user.ts / require-role.ts — NOT here.

export const DEV_ROLE_COOKIE = 'agsi_dev_role';
