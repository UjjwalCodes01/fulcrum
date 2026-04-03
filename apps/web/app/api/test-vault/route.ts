import { NextRequest, NextResponse } from 'next/server';
import { getSession, getAccessToken } from '@auth0/nextjs-auth0';

// Define types at top level
interface VaultResult {
  accessToken?: string;
  error?: string;
  exchangeMethod?: string;
  expiresIn?: number;
}

interface GithubRepo {
  name: string;
  private: boolean;
  html_url: string;
}

/**
 * Test Token Vault Exchange
 * 
 * This endpoint tests Token Vault using ACCESS TOKEN exchange:
 * 1. Get user's Auth0 access token  
 * 2. Exchange via Token Vault for GitHub token (using access token flow)
 * 3. Use GitHub token to fetch repos
 * 
 * NOTE: We use ACCESS TOKEN exchange which doesn't require refresh tokens.
 * This bypasses the GitHub App refresh token issue.
 */
export async function GET(_request: NextRequest) {
  try {
    // Step 1: Get the user's session
    const session = await getSession();
    
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Check if user is logged in via GitHub
    if (!session.user.sub?.startsWith('github|')) {
      return NextResponse.json({
        error: 'Not logged in via GitHub',
        hint: 'Log out and log back in using GitHub OAuth',
        currentIdentity: session.user.sub,
      }, { status: 400 });
    }

    // Step 2: Get the access token (we'll use this for Token Vault exchange)
    let tokenResponse;
    try {
      tokenResponse = await getAccessToken();
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({
        error: 'Failed to get access token',
        details: error,
        hint: 'Try logging out and back in',
      }, { status: 401 });
    }
    
    if (!tokenResponse?.accessToken) {
      return NextResponse.json({ 
        error: 'No access token available',
        hint: 'Try logging out and back in',
      }, { status: 401 });
    }

    // Step 3: Call backend Token Vault exchange
    // The backend now supports ACCESS TOKEN exchange (no refresh token needed!)
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    
    const vaultResponse = await fetch(`${backendUrl}/api/connections/github/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenResponse.accessToken}`,
      },
      // Empty body - backend will use the access token from Authorization header
      body: JSON.stringify({}),
    });

    const vaultResult = await vaultResponse.json() as VaultResult;

    if (!vaultResponse.ok) {
      return NextResponse.json({
        success: false,
        phase: 'Backend Token Exchange',
        error: vaultResult.error || 'Token exchange failed',
        exchangeMethod: vaultResult.exchangeMethod || 'access_token',
        user: {
          sub: session.user.sub,
          email: session.user.email,
        },
        debug: {
          backendUrl,
          hasAccessToken: !!tokenResponse.accessToken,
        },
      }, { status: 400 });
    }

    // Step 4: Test the GitHub token by fetching repos
    if (vaultResult.accessToken) {
      const githubResponse = await fetch('https://api.github.com/user/repos?per_page=5', {
        headers: {
          Authorization: `Bearer ${vaultResult.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Fulcrum-Security-Agent',
        },
      });

      if (!githubResponse.ok) {
        const errorText = await githubResponse.text();
        return NextResponse.json({
          success: false,
          phase: 'GitHub API Call',
          error: `GitHub API returned ${githubResponse.status}`,
          details: errorText,
          exchangeMethod: vaultResult.exchangeMethod,
        }, { status: 400 });
      }

      const repos = await githubResponse.json() as GithubRepo[];

      return NextResponse.json({
        success: true,
        phase: '🎉 TOKEN VAULT WORKING!',
        exchangeMethod: vaultResult.exchangeMethod,
        user: {
          sub: session.user.sub,
          email: session.user.email,
          name: session.user.name,
        },
        tokenExpiresIn: vaultResult.expiresIn,
        repos: repos.map((r) => ({
          name: r.name,
          private: r.private,
          url: r.html_url,
        })),
      });
    }

    return NextResponse.json({
      success: false,
      phase: 'Token Exchange',
      result: vaultResult,
      user: {
        sub: session.user.sub,
        email: session.user.email,
      },
    });
  } catch (error) {
    console.error('Test vault error:', error);
    return NextResponse.json({ 
      error: 'Failed to test Token Vault',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
