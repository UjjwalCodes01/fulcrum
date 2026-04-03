'use client';

import { useUser } from '@auth0/nextjs-auth0/client';
import { Shield, AlertCircle, CheckCircle, LogOut, User } from 'lucide-react';
import Link from 'next/link';

export default function DashboardPage() {
  const { user, isLoading } = useUser();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <Shield className="w-16 h-16 mx-auto mb-4 text-blue-600 animate-pulse" />
          <p className="text-slate-600">Loading...</p>
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
            <Link href="/dashboard" className="text-slate-900 font-medium">Dashboard</Link>
            <Link href="/connections" className="text-slate-600 hover:text-slate-900">Connections</Link>
            <Link href="/audit" className="text-slate-600 hover:text-slate-900">Audit Log</Link>
            {user && (
              <div className="flex items-center gap-4 ml-4 pl-4 border-l border-slate-200">
                <div className="flex items-center gap-2 text-slate-600">
                  <User className="w-4 h-4" />
                  <span className="text-sm">{user.email}</span>
                </div>
                <a 
                  href="/api/auth/logout"
                  className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
                >
                  <LogOut className="w-4 h-4" />
                </a>
              </div>
            )}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Auth Status Banner */}
        {!user ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-8 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
            <div>
              <h3 className="font-semibold text-amber-800">Login Required</h3>
              <p className="text-amber-700 text-sm">
                Please <a href="/api/auth/login" className="underline font-medium">login with Auth0</a> to access the agent.
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-8 flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
            <div>
              <h3 className="font-semibold text-green-800">Authenticated</h3>
              <p className="text-green-700 text-sm">
                Logged in as <strong>{user.email}</strong>. Connect your services to start using the agent.
              </p>
            </div>
          </div>
        )}

        {/* Agent Chat Placeholder */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="font-semibold text-lg">Fulcrum Agent</h2>
            <p className="text-sm text-slate-500">Zero-Trust Security Auditor</p>
          </div>
          
          <div className="h-96 flex items-center justify-center bg-slate-50">
            <div className="text-center text-slate-500">
              <Shield className="w-16 h-16 mx-auto mb-4 text-slate-300" />
              {user ? (
                <>
                  <p className="text-lg font-medium">Agent Ready</p>
                  <p className="text-sm">Connect GitHub/Jira/Slack to start auditing</p>
                </>
              ) : (
                <>
                  <p className="text-lg font-medium">Agent Not Connected</p>
                  <p className="text-sm">Login with Auth0 to start chatting with Fulcrum</p>
                </>
              )}
            </div>
          </div>
          
          <div className="border-t border-slate-200 p-4">
            <div className="flex gap-3">
              <input
                type="text"
                placeholder={user ? "Type a message..." : "Login required to send messages"}
                disabled={!user}
                className={`flex-1 px-4 py-2 border rounded-lg ${
                  user 
                    ? 'border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none' 
                    : 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                }`}
              />
              <button
                disabled={!user}
                className={`px-6 py-2 rounded-lg font-medium ${
                  user
                    ? 'bg-blue-600 hover:bg-blue-500 text-white'
                    : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                }`}
              >
                Send
              </button>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid md:grid-cols-4 gap-4 mt-8">
          <StatCard label="Agent State" value="IDLE" />
          <StatCard label="Connections" value="0" />
          <StatCard label="Actions Today" value="0" />
          <StatCard label="Pending Approvals" value="0" />
        </div>
      </main>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
