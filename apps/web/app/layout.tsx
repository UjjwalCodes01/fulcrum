import type { Metadata } from 'next';
import { UserProvider } from '@auth0/nextjs-auth0/client';
import './globals.css';

export const metadata: Metadata = {
  title: 'Project Fulcrum - Zero-Trust AI Security Agent',
  description: 'Sovereign Agentic Security Orchestrator with Auth0 Token Vault',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <UserProvider>
          {children}
        </UserProvider>
      </body>
    </html>
  );
}
