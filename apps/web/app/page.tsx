'use client';

import Link from 'next/link';
import { useUser } from '@auth0/nextjs-auth0/client';
import { Shield, Lock, Key, Zap, LogOut, User } from 'lucide-react';

export default function Home() {
  const { user, isLoading } = useUser();

  return (
    <main className="min-h-screen">
      {/* Hero Section */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-4 py-20">
          {/* User Status Bar */}
          {user && (
            <div className="flex items-center justify-end gap-4 mb-8">
              <div className="flex items-center gap-2 text-slate-300">
                <User className="w-4 h-4" />
                <span className="text-sm">{user.email}</span>
              </div>
              <a 
                href="/api/auth/logout"
                className="flex items-center gap-1 text-sm text-slate-400 hover:text-white"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </a>
            </div>
          )}

          <div className="text-center">
            <div className="inline-flex items-center gap-2 bg-blue-500/20 border border-blue-400/30 rounded-full px-4 py-1.5 mb-6">
              <Shield className="w-4 h-4 text-blue-400" />
              <span className="text-sm text-blue-200">Zero-Trust AI Security</span>
            </div>
            
            <h1 className="text-5xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-white via-blue-100 to-blue-200 bg-clip-text text-transparent">
              Project Fulcrum
            </h1>
            
            <p className="text-xl md:text-2xl text-slate-300 mb-8 max-w-3xl mx-auto">
              The AI agent that doesn&apos;t hold your keys. 
              <span className="text-blue-400"> Identity-less by default.</span>
            </p>
            
            <p className="text-slate-400 mb-12 max-w-2xl mx-auto">
              Secure cross-domain security auditing with Auth0 Token Vault, 
              Fine-Grained Authorization, and human-in-the-loop approval for high-stakes actions.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              {isLoading ? (
                <div className="px-8 py-3 bg-slate-700 text-slate-400 rounded-lg">
                  Loading...
                </div>
              ) : user ? (
                <Link 
                  href="/dashboard"
                  className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-lg font-semibold transition-colors"
                >
                  <Shield className="w-5 h-5" />
                  Go to Dashboard
                </Link>
              ) : (
                <a 
                  href="/api/auth/login"
                  className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-lg font-semibold transition-colors"
                >
                  <Key className="w-5 h-5" />
                  Connect with Auth0
                </a>
              )}
              <Link 
                href="/dashboard"
                className="inline-flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-8 py-3 rounded-lg font-semibold transition-colors"
              >
                View Dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="max-w-6xl mx-auto px-4 py-20">
        <h2 className="text-3xl font-bold text-center mb-12">
          Why Fulcrum is Different
        </h2>
        
        <div className="grid md:grid-cols-3 gap-8">
          <FeatureCard
            icon={<Lock className="w-8 h-8 text-blue-600" />}
            title="Token Vault"
            description="Your API tokens are stored in Auth0's Token Vault. The agent never sees raw credentials - only short-lived, scoped proxy tokens."
          />
          <FeatureCard
            icon={<Shield className="w-8 h-8 text-green-600" />}
            title="Fine-Grained Authorization"
            description="Every action is checked against permission rules. If the relationship doesn't exist, the agent can't act."
          />
          <FeatureCard
            icon={<Zap className="w-8 h-8 text-amber-500" />}
            title="Human-in-the-Loop"
            description="High-stakes actions (delete, merge, modify) require your approval via push notification. You stay in control."
          />
        </div>
      </div>

      {/* Status Banner */}
      <div className="bg-green-50 border-t border-green-200">
        <div className="max-w-6xl mx-auto px-4 py-4 text-center">
          <p className="text-green-800">
            ✅ <strong>Auth0 Connected!</strong> {user ? `Logged in as ${user.email}` : 'Click "Connect with Auth0" to login'}
          </p>
        </div>
      </div>
    </main>
  );
}

function FeatureCard({ 
  icon, 
  title, 
  description 
}: { 
  icon: React.ReactNode; 
  title: string; 
  description: string;
}) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
      <div className="mb-4">{icon}</div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-slate-600">{description}</p>
    </div>
  );
}
