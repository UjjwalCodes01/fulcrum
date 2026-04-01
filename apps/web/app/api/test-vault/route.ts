import { NextRequest, NextResponse } from 'next/server';
import { getSession, getAccessToken } from '@auth0/nextjs-auth0';

/**
 * Test Token Vault Exchange
 * 
 * This endpoint tests Token Vault directly:
 * 1. Get user's Auth0 access token  
 * 2. Exchange via Token Vault for GitHub token
 * 3. Use GitHub token to fetch repos
 */
export async function GET(request: NextRequest) {
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

    // Step 2: Get the access token
    let tokenResponse;
    try {
      tokenResponse = await getAccessToken();
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({
        error: 'Failed to get access token',
        details: error,
      }, { status: 401 });
    }
    
    if (!tokenResponse?.accessToken) {
      return NextResponse.json({ 
        error: 'No access token available',
      }, { status: 401 });
    }

    // Call our backend to do the Token Vault exchange
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    
    const vaultResponse = await fetch(`${backendUrl}/api/connections/github/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenResponse.accessToken}`,
      },
    });

    const vaultResult = await vaultResponse.json();

    if (!vaultResponse.ok) {
      return NextResponse.json({
        success: false,
        phase: 'Backend Token Exchange',
        error: vaultResult.error || 'Token exchange failed',
        user: {
          sub: session.user.sub,
          email: session.user.email,
        },
      }, { status: 400 });
    }

    // If we got a GitHub token, test it by fetching repos
    if (vaultResult.accessToken) {
      const githubResponse = await fetch('https://api.github.com/user/repos?per_page=5', {
        headers: {
          Authorization: `Bearer ${vaultResult.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      const repos = await githubResponse.json();

      return NextResponse.json({
        success: true,
        phase: '🎉 TOKEN VAULT WORKING!',
        user: {
          sub: session.user.sub,
          email: session.user.email,
          name: session.user.name,
        },
        repos: repos.map?.((r: any) => ({
          name: r.name,
          private: r.private,
        })) || repos,
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
