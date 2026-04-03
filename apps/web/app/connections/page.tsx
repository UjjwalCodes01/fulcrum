'use client';

import { Shield, Github, MessageSquare, FileText, Plus, Check, X, Loader2, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useUser } from '@auth0/nextjs-auth0/client';
import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

export default function ConnectionsPage() {
  const { user, isLoading } = useUser();
  const router = useRouter();
  const [connectingService, setConnectingService] = useState<string | null>(null);

  // Check if user is connected via GitHub
  const isGitHubConnected = user?.sub?.startsWith('github|');

  const handleConnectGitHub = useCallback(() => {
    setConnectingService('github');
    // Redirect to Auth0 login with connection hint to force GitHub
    // This will link the GitHub account to the user's profile
    const url = `/api/auth/login?connection=github&returnTo=${encodeURIComponent('/connections')}`;
    router.push(url);
  }, [router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-bold mb-4">Please log in to manage connections</h1>
          <Link 
            href="/api/auth/login"
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Log In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-600" />
            <span className="font-bold text-xl">Fulcrum</span>
          </div>
          <nav className="flex items-center gap-6">
            <Link href="/dashboard" className="text-slate-600 hover:text-slate-900">Dashboard</Link>
            <Link href="/connections" className="text-slate-900 font-medium">Connections</Link>
            <Link href="/audit" className="text-slate-600 hover:text-slate-900">Audit Log</Link>
            <Link href="/api/auth/logout" className="text-red-600 hover:text-red-700">Logout</Link>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">Service Connections</h1>
          <p className="text-slate-600">
            Connect your accounts to allow Fulcrum to audit and protect your infrastructure.
            All credentials are stored securely in Auth0 Token Vault.
          </p>
          <p className="text-sm text-slate-500 mt-2">
            Logged in as: <span className="font-medium">{user.email}</span>
          </p>
        </div>

        <div className="space-y-4">
          {/* GitHub Connection */}
          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-slate-100 rounded-lg">
                  <Github className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    GitHub
                    {isGitHubConnected ? (
                      <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                        <Check className="w-3 h-3" /> Connected via OAuth
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                        <X className="w-3 h-3" /> Not Connected
                      </span>
                    )}
                  </h3>
                  <p className="text-slate-600 text-sm mt-1">
                    Scan repositories for secrets, manage issues and PRs
                  </p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {['repo', 'read:user', 'user:email'].map((scope) => (
                      <span key={scope} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                        {scope}
                      </span>
                    ))}
                  </div>
                  {isGitHubConnected && (
                    <p className="text-xs text-green-600 mt-2">
                      ✓ Token Vault will exchange your Auth0 token for GitHub access
                    </p>
                  )}
                </div>
              </div>
              
              {!isGitHubConnected && (
                <button
                  onClick={handleConnectGitHub}
                  disabled={connectingService === 'github'}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50"
                >
                  {connectingService === 'github' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  Connect GitHub
                </button>
              )}
            </div>
          </div>
          
          {/* Jira Connection */}
          <div className="bg-white rounded-lg border border-slate-200 p-6 opacity-60">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-slate-100 rounded-lg">
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    Jira
                    <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                      Coming Soon
                    </span>
                  </h3>
                  <p className="text-slate-600 text-sm mt-1">
                    Create and manage security tickets
                  </p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {['read:jira-work', 'write:jira-work'].map((scope) => (
                      <span key={scope} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                        {scope}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              
              <button
                disabled
                className="inline-flex items-center gap-2 px-4 py-2 bg-slate-200 text-slate-500 rounded-lg cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
                Connect
              </button>
            </div>
          </div>
          
          {/* Slack Connection */}
          <div className="bg-white rounded-lg border border-slate-200 p-6 opacity-60">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-slate-100 rounded-lg">
                  <MessageSquare className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    Slack
                    <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                      Coming Soon
                    </span>
                  </h3>
                  <p className="text-slate-600 text-sm mt-1">
                    Send security alerts to your team
                  </p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {['channels:read', 'chat:write'].map((scope) => (
                      <span key={scope} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                        {scope}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              
              <button
                disabled
                className="inline-flex items-center gap-2 px-4 py-2 bg-slate-200 text-slate-500 rounded-lg cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
                Connect
              </button>
            </div>
          </div>
        </div>

        {/* Token Vault Info */}
        <div className="mt-12 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="font-semibold text-blue-900 mb-2">🔐 About Token Vault</h3>
          <p className="text-blue-800 text-sm mb-3">
            Your credentials are stored in Auth0&apos;s Token Vault - a secure, isolated storage 
            that the Fulcrum agent never directly accesses. Instead, it receives short-lived, 
            scoped proxy tokens for each operation. If the agent is compromised, your real 
            credentials remain safe.
          </p>
          <a 
            href="https://auth0.com/docs/customize/integrations/authenticate-and-authorize-ai-agents-with-auth0/token-vault" 
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-blue-600 text-sm hover:underline"
          >
            Learn more about Token Vault <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {/* How it works */}
        <div className="mt-8 bg-slate-100 rounded-lg p-6">
          <h3 className="font-semibold text-slate-900 mb-4">How Token Exchange Works</h3>
          <ol className="space-y-3 text-sm text-slate-700">
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">1</span>
              <span>You connect your GitHub account via OAuth through Auth0</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">2</span>
              <span>Auth0 stores your GitHub token securely in Token Vault (never exposed to Fulcrum)</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">3</span>
              <span>When the agent needs GitHub access, it exchanges your Auth0 token for a scoped proxy token</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">4</span>
              <span>The proxy token is short-lived and can be revoked at any time</span>
            </li>
          </ol>
        </div>
      </main>
    </div>
  );
}
