import { auth, type AuthResult } from 'express-oauth2-jwt-bearer';
import type { Request, Response, NextFunction } from 'express';

// JWT validation middleware using Auth0
export const jwtCheck = auth({
  audience: process.env.AUTH0_AUDIENCE || 'https://fulcrum-api',
  issuerBaseURL: `https://${process.env.AUTH0_DOMAIN}`,
  tokenSigningAlg: 'RS256',
});

// Extend Express Request to include auth
declare global {
  namespace Express {
    interface Request {
      auth?: AuthResult;
    }
  }
}

// Extract user info from JWT
export function getUserFromToken(req: Request): { userId: string; email?: string } | null {
  if (!req.auth?.payload?.sub) {
    return null;
  }
  
  return {
    userId: req.auth.payload.sub,
    email: req.auth.payload.email as string | undefined,
  };
}

// Optional auth - doesn't fail if no token, just doesn't set req.auth
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }
  
  // If there's a token, validate it
  jwtCheck(req, res, (err) => {
    if (err) {
      // Token invalid but optional, just continue without auth
      return next();
    }
    next();
  });
}

/**
 * Admin role check middleware
 * Requires authentication + admin role in JWT
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  jwtCheck(req, res, (err) => {
    if (err) {
      return next(err);
    }
    
    const user = getUserFromToken(req);
    if (!user) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }
    
    // Check for admin role in JWT
    // Auth0 can include roles in custom claims or app_metadata
    const roles = req.auth?.payload?.['https://fulcrum.app/roles'] as string[] | undefined;
    const appMetadata = req.auth?.payload?.['app_metadata'] as { roles?: string[] } | undefined;
    const isAdmin = roles?.includes('admin') || 
                   appMetadata?.roles?.includes('admin');
    
    if (!isAdmin) {
      return res.status(403).json({
        error: 'Admin role required',
        code: 'ADMIN_REQUIRED',
      });
    }
    
    next();
  });
}
