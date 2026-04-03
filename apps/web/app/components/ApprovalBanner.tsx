'use client';

import { useEffect, useState, useCallback } from 'react';
import { Shield, Clock, CheckCircle, XCircle, AlertTriangle, Loader2 } from 'lucide-react';

// CIBA Request Status
type CIBAStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';

// CIBA Request from the API
interface CIBARequest {
  id: string;
  tool: string;
  status: CIBAStatus;
  bindingMessage: string;
  expiresAt: string;
  createdAt: string;
  approvedAt?: string;
  deniedAt?: string;
}

// Props for ApprovalBanner
interface ApprovalBannerProps {
  requestId?: string;
  onApprovalComplete?: (status: CIBAStatus) => void;
  apiBaseUrl?: string;
  pollInterval?: number; // ms
}

// Risk level badge colors
const RISK_COLORS = {
  github_merge_pr: 'bg-red-100 text-red-800 border-red-200',
  github_delete_branch: 'bg-red-100 text-red-800 border-red-200',
  jira_delete_issue: 'bg-red-100 text-red-800 border-red-200',
  slack_invite_user: 'bg-orange-100 text-orange-800 border-orange-200',
  default: 'bg-amber-100 text-amber-800 border-amber-200',
};

// Tool display names
const TOOL_NAMES: Record<string, string> = {
  github_merge_pr: 'Merge Pull Request',
  github_delete_branch: 'Delete Branch',
  jira_delete_issue: 'Delete Jira Issue',
  slack_invite_user: 'Invite User to Slack',
};

// Format time remaining
function formatTimeRemaining(expiresAt: string): string {
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (remaining <= 0) return 'Expired';
  
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  
  if (minutes > 0) {
    return `${minutes}m ${seconds}s remaining`;
  }
  return `${seconds}s remaining`;
}

// Status icon component
function StatusIcon({ status }: { status: CIBAStatus }) {
  switch (status) {
    case 'pending':
      return <Loader2 className="w-5 h-5 text-amber-600 animate-spin" />;
    case 'approved':
      return <CheckCircle className="w-5 h-5 text-green-600" />;
    case 'denied':
      return <XCircle className="w-5 h-5 text-red-600" />;
    case 'expired':
      return <Clock className="w-5 h-5 text-slate-500" />;
    case 'cancelled':
      return <XCircle className="w-5 h-5 text-slate-500" />;
    default:
      return <AlertTriangle className="w-5 h-5 text-amber-600" />;
  }
}

// Status colors
function getStatusColors(status: CIBAStatus): string {
  switch (status) {
    case 'pending':
      return 'bg-amber-50 border-amber-200';
    case 'approved':
      return 'bg-green-50 border-green-200';
    case 'denied':
      return 'bg-red-50 border-red-200';
    case 'expired':
    case 'cancelled':
      return 'bg-slate-50 border-slate-200';
    default:
      return 'bg-slate-50 border-slate-200';
  }
}

// Status text
function getStatusText(status: CIBAStatus): string {
  switch (status) {
    case 'pending':
      return 'Awaiting Approval';
    case 'approved':
      return 'Approved';
    case 'denied':
      return 'Denied';
    case 'expired':
      return 'Expired';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Unknown';
  }
}

export function ApprovalBanner({
  requestId,
  onApprovalComplete,
  apiBaseUrl = '/api',
  pollInterval = 3000,
}: ApprovalBannerProps) {
  const [request, setRequest] = useState<CIBARequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<string>('');
  
  // Fetch request status
  const fetchStatus = useCallback(async () => {
    if (!requestId) {
      setLoading(false);
      return;
    }
    
    try {
      const response = await fetch(`${apiBaseUrl}/agent/ciba/${requestId}`, {
        credentials: 'include',
      });
      
      if (!response.ok) {
        if (response.status === 404) {
          setError('Approval request not found');
          setLoading(false);
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = (await response.json()) as CIBARequest;
      setRequest(data);
      setError(null);
      
      // If status is terminal, notify parent
      if (data.status !== 'pending') {
        onApprovalComplete?.(data.status);
      }
    } catch (err) {
      setError('Failed to fetch approval status');
      console.error('Approval status error:', err);
    } finally {
      setLoading(false);
    }
  }, [requestId, apiBaseUrl, onApprovalComplete]);
  
  // Poll for status updates
  useEffect(() => {
    fetchStatus();
    
    if (!requestId) return;
    
    const interval = setInterval(() => {
      if (request?.status === 'pending') {
        fetchStatus();
      }
    }, pollInterval);
    
    return () => clearInterval(interval);
  }, [requestId, pollInterval, fetchStatus, request?.status]);
  
  // Update time remaining
  useEffect(() => {
    if (!request?.expiresAt || request.status !== 'pending') return;
    
    const updateTime = () => {
      setTimeRemaining(formatTimeRemaining(request.expiresAt));
    };
    
    updateTime();
    const interval = setInterval(updateTime, 1000);
    
    return () => clearInterval(interval);
  }, [request?.expiresAt, request?.status]);
  
  // Handle manual approve (dev mode)
  const handleApprove = async () => {
    if (!requestId) return;
    
    try {
      const response = await fetch(`${apiBaseUrl}/agent/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      await fetchStatus();
    } catch (err) {
      console.error('Approve error:', err);
      setError('Failed to approve');
    }
  };
  
  // Handle manual deny (dev mode)
  const handleDeny = async () => {
    if (!requestId) return;
    
    try {
      const response = await fetch(`${apiBaseUrl}/agent/deny`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      await fetchStatus();
    } catch (err) {
      console.error('Deny error:', err);
      setError('Failed to deny');
    }
  };
  
  // Loading state
  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 bg-slate-50 border border-slate-200 rounded-lg">
        <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
        <span className="text-slate-600">Loading approval request...</span>
      </div>
    );
  }
  
  // No request or error
  if (!requestId || !request) {
    if (error) {
      return (
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          <span className="text-red-800">{error}</span>
        </div>
      );
    }
    return null;
  }
  
  const toolColors = RISK_COLORS[request.tool as keyof typeof RISK_COLORS] || RISK_COLORS.default;
  const toolName = TOOL_NAMES[request.tool] || request.tool;
  
  return (
    <div className={`border rounded-lg overflow-hidden ${getStatusColors(request.status)}`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-current/10">
        <StatusIcon status={request.status} />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{getStatusText(request.status)}</span>
            <span className={`px-2 py-0.5 text-xs font-medium rounded border ${toolColors}`}>
              {toolName}
            </span>
          </div>
          {request.status === 'pending' && (
            <span className="text-sm text-amber-700">{timeRemaining}</span>
          )}
        </div>
        <Shield className="w-5 h-5 text-slate-400" />
      </div>
      
      {/* Content */}
      <div className="px-4 py-3">
        <p className="text-sm">{request.bindingMessage}</p>
        
        {/* Pending actions (dev mode manual approve/deny) */}
        {request.status === 'pending' && (
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-current/10">
            <span className="text-xs text-slate-500">Manual (Dev Mode):</span>
            <button
              onClick={handleApprove}
              className="px-3 py-1 text-sm font-medium bg-green-600 text-white rounded hover:bg-green-500"
            >
              Approve
            </button>
            <button
              onClick={handleDeny}
              className="px-3 py-1 text-sm font-medium bg-red-600 text-white rounded hover:bg-red-500"
            >
              Deny
            </button>
          </div>
        )}
        
        {/* Result info */}
        {request.status === 'approved' && request.approvedAt && (
          <p className="text-xs text-green-700 mt-2">
            Approved at {new Date(request.approvedAt).toLocaleString()}
          </p>
        )}
        {request.status === 'denied' && request.deniedAt && (
          <p className="text-xs text-red-700 mt-2">
            Denied at {new Date(request.deniedAt).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}

// Pending approvals list component
interface PendingApprovalsProps {
  apiBaseUrl?: string;
  onSelectRequest?: (requestId: string) => void;
}

export function PendingApprovalsList({
  apiBaseUrl = '/api',
  onSelectRequest,
}: PendingApprovalsProps) {
  const [requests, setRequests] = useState<CIBARequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Fetch pending requests
  useEffect(() => {
    const fetchPending = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/agent/approvals`, {
          credentials: 'include',
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const data = (await response.json()) as { approvals?: CIBARequest[] };
        setRequests(data.approvals || []);
        setError(null);
      } catch (err) {
        setError('Failed to fetch pending approvals');
        console.error('Pending approvals error:', err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchPending();
    const interval = setInterval(fetchPending, 5000);
    
    return () => clearInterval(interval);
  }, [apiBaseUrl]);
  
  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-slate-600">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading pending approvals...</span>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="flex items-center gap-2 p-4 text-red-600">
        <AlertTriangle className="w-4 h-4" />
        <span className="text-sm">{error}</span>
      </div>
    );
  }
  
  if (requests.length === 0) {
    return (
      <div className="flex items-center gap-2 p-4 text-slate-500">
        <CheckCircle className="w-4 h-4" />
        <span className="text-sm">No pending approvals</span>
      </div>
    );
  }
  
  return (
    <div className="space-y-2">
      {requests.map((request) => (
        <button
          key={request.id}
          onClick={() => onSelectRequest?.(request.id)}
          className="w-full text-left p-3 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 text-amber-600 animate-spin" />
            <span className="font-medium text-amber-900">
              {TOOL_NAMES[request.tool] || request.tool}
            </span>
          </div>
          <p className="text-sm text-amber-700 mt-1 truncate">
            {request.bindingMessage}
          </p>
          <p className="text-xs text-amber-600 mt-1">
            {formatTimeRemaining(request.expiresAt)}
          </p>
        </button>
      ))}
    </div>
  );
}

// Export default for easier importing
export default ApprovalBanner;
