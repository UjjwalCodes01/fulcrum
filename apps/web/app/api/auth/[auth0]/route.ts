import { handleAuth, handleLogin, handleLogout } from '@auth0/nextjs-auth0';

export const GET = handleAuth({
  login: handleLogin({
    authorizationParams: {
      audience: 'https://fulcrum-api',
      // offline_access is REQUIRED for Token Vault - it grants refresh tokens
      scope: 'openid profile email offline_access',
    },
    returnTo: '/dashboard',
  }),
  logout: handleLogout({
    returnTo: '/',
  }),
});
