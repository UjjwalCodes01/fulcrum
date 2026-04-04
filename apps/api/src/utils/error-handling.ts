/**
 * Production-Grade Error Handling and Observability
 * 
 * Provides:
 * - Exponential backoff retries for external API calls
 * - Rate limiting per provider
 * - Structured error classification
 * - Operational metrics tracking
 */

import { logger } from '../utils/logger.js';

/**
 * Error classification for better handling
 */
export enum ErrorCategory {
  // Retryable errors
  NETWORK = 'network',
  RATE_LIMIT = 'rate_limit',
  TIMEOUT = 'timeout',
  SERVER_ERROR = 'server_error',
  
  // Non-retryable errors
  AUTH_FAILED = 'auth_failed',
  PERMISSION_DENIED = 'permission_denied',
  NOT_FOUND = 'not_found',
  INVALID_INPUT = 'invalid_input',
  
  // System errors
  INTERNAL_ERROR = 'internal_error',
  CONFIG_ERROR = 'config_error',
}

/**
 * Classified error with context
 */
export interface ClassifiedError {
  category: ErrorCategory;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  statusCode?: number;
  provider?: string;
  originalError?: unknown;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableCategories: ErrorCategory[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableCategories: [
    ErrorCategory.NETWORK,
    ErrorCategory.RATE_LIMIT,
    ErrorCategory.TIMEOUT,
    ErrorCategory.SERVER_ERROR,
  ],
};

/**
 * Rate limiter per provider
 */
class RateLimiter {
  private requests = new Map<string, number[]>();
  private limits = new Map<string, { requestsPerMinute: number; requestsPerHour: number }>();

  constructor() {
    // GitHub: 5000/hour authenticated (conservative limit)
    this.limits.set('github', { requestsPerMinute: 60, requestsPerHour: 4800 });
    
    // Jira: 300/minute (Atlassian limit)
    this.limits.set('jira', { requestsPerMinute: 250, requestsPerHour: 10000 });
    
    // Slack: Tier 2 = 20/minute (conservative)
    this.limits.set('slack', { requestsPerMinute: 15, requestsPerHour: 500 });
    
    // Gemini: Custom daily limit
    this.limits.set('gemini', { requestsPerMinute: 10, requestsPerHour: 500 });
  }

  /**
   * Check if request is allowed
   */
  async checkLimit(provider: string): Promise<{ allowed: boolean; retryAfterMs?: number }> {
    const limit = this.limits.get(provider);
    if (!limit) {
      // Unknown provider, allow
      return { allowed: true };
    }

    const now = Date.now();
    const requests = this.requests.get(provider) || [];
    
    // Clean up old requests
    const oneMinuteAgo = now - 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;
    const recentRequests = requests.filter(ts => ts > oneHourAgo);
    
    // Check minute limit
    const lastMinute = recentRequests.filter(ts => ts > oneMinuteAgo);
    if (lastMinute.length >= limit.requestsPerMinute) {
      const oldestInWindow = Math.min(...lastMinute);
      const retryAfterMs = 60 * 1000 - (now - oldestInWindow);
      return { allowed: false, retryAfterMs };
    }
    
    // Check hour limit
    if (recentRequests.length >= limit.requestsPerHour) {
      const oldestInWindow = Math.min(...recentRequests);
      const retryAfterMs = 60 * 60 * 1000 - (now - oldestInWindow);
      return { allowed: false, retryAfterMs };
    }
    
    // Allow and record
    recentRequests.push(now);
    this.requests.set(provider, recentRequests);
    
    return { allowed: true };
  }

  /**
   * Get current usage stats
   */
  getUsage(provider: string): { lastMinute: number; lastHour: number } {
    const requests = this.requests.get(provider) || [];
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;
    
    return {
      lastMinute: requests.filter(ts => ts > oneMinuteAgo).length,
      lastHour: requests.filter(ts => ts > oneHourAgo).length,
    };
  }
}

const rateLimiter = new RateLimiter();

/**
 * Classify error from external API
 */
export function classifyError(error: unknown, provider?: string): ClassifiedError {
  const err = error as any;
  
  // Network errors
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
    return {
      category: ErrorCategory.NETWORK,
      message: `Network error: ${err.message}`,
      retryable: true,
      provider,
      originalError: error,
    };
  }
  
  // HTTP status codes
  const statusCode = err.status || err.statusCode || err.response?.status;
  
  if (statusCode === 429) {
    const retryAfter = err.response?.headers?.['retry-after'];
    return {
      category: ErrorCategory.RATE_LIMIT,
      message: 'Rate limit exceeded',
      retryable: true,
      retryAfterMs: retryAfter ? parseInt(retryAfter) * 1000 : 60000,
      statusCode,
      provider,
      originalError: error,
    };
  }
  
  if (statusCode === 401 || statusCode === 403) {
    return {
      category: statusCode === 401 ? ErrorCategory.AUTH_FAILED : ErrorCategory.PERMISSION_DENIED,
      message: statusCode === 401 ? 'Authentication failed' : 'Permission denied',
      retryable: false,
      statusCode,
      provider,
      originalError: error,
    };
  }
  
  if (statusCode === 404) {
    return {
      category: ErrorCategory.NOT_FOUND,
      message: 'Resource not found',
      retryable: false,
      statusCode,
      provider,
      originalError: error,
    };
  }
  
  if (statusCode === 400 || statusCode === 422) {
    return {
      category: ErrorCategory.INVALID_INPUT,
      message: err.message || 'Invalid input',
      retryable: false,
      statusCode,
      provider,
      originalError: error,
    };
  }
  
  if (statusCode && statusCode >= 500) {
    return {
      category: ErrorCategory.SERVER_ERROR,
      message: `Server error: ${err.message || statusCode}`,
      retryable: true,
      statusCode,
      provider,
      originalError: error,
    };
  }
  
  // Timeout errors
  if (err.name === 'TimeoutError' || err.code === 'ETIMEDOUT') {
    return {
      category: ErrorCategory.TIMEOUT,
      message: 'Request timeout',
      retryable: true,
      provider,
      originalError: error,
    };
  }
  
  // Unknown error
  return {
    category: ErrorCategory.INTERNAL_ERROR,
    message: err.message || 'Unknown error',
    retryable: false,
    provider,
    originalError: error,
  };
}

/**
 * Execute with exponential backoff retry
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryConfig> = {},
  provider?: string
): Promise<T> {
  const config = { ...DEFAULT_RETRY_CONFIG, ...options };
  let lastError: ClassifiedError | null = null;
  
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      // Check rate limit
      if (provider) {
        const limitCheck = await rateLimiter.checkLimit(provider);
        if (!limitCheck.allowed) {
          logger.warn('Rate limit reached, waiting', {
            provider,
            retryAfterMs: limitCheck.retryAfterMs,
          });
          
          if (limitCheck.retryAfterMs && limitCheck.retryAfterMs < config.maxDelayMs) {
            await sleep(limitCheck.retryAfterMs);
          } else {
            throw new Error(`Rate limit exceeded for ${provider}`);
          }
        }
      }
      
      // Execute function
      const result = await fn();
      
      // Log success after retry
      if (attempt > 1) {
        logger.info('Operation succeeded after retry', {
          attempt,
          provider,
        });
      }
      
      return result;
    } catch (error) {
      lastError = classifyError(error, provider);
      
      logger.warn('Operation failed', {
        attempt,
        maxAttempts: config.maxAttempts,
        category: lastError.category,
        retryable: lastError.retryable,
        provider,
        error: lastError.message,
      });
      
      // Don't retry if not retryable
      if (!lastError.retryable || !config.retryableCategories.includes(lastError.category)) {
        throw error;
      }
      
      // Don't retry on last attempt
      if (attempt === config.maxAttempts) {
        throw error;
      }
      
      // Calculate delay with exponential backoff
      const delay = Math.min(
        config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1),
        config.maxDelayMs
      );
      
      // Use provider's retry-after if available
      const finalDelay = lastError.retryAfterMs 
        ? Math.min(lastError.retryAfterMs, config.maxDelayMs)
        : delay;
      
      logger.debug('Retrying after delay', {
        delayMs: finalDelay,
        attempt: attempt + 1,
        provider,
      });
      
      await sleep(finalDelay);
    }
  }
  
  // Should never reach here, but TypeScript needs it
  throw lastError?.originalError || new Error('Max retries exceeded');
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get rate limiter usage stats
 */
export function getRateLimiterUsage(provider: string) {
  return rateLimiter.getUsage(provider);
}

/**
 * Circuit breaker for repeated failures
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private name: string,
    private failureThreshold: number = 5,
    _timeoutMs: number = 60000,
    private resetTimeMs: number = 300000
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      const now = Date.now();
      if (now - this.lastFailureTime > this.resetTimeMs) {
        this.state = 'half-open';
        logger.info('Circuit breaker entering half-open state', { name: this.name });
      } else {
        throw new Error(`Circuit breaker open for ${this.name}`);
      }
    }

    try {
      const result = await fn();
      
      // Success - reset circuit
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failures = 0;
        logger.info('Circuit breaker closed', { name: this.name });
      }
      
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();
      
      logger.warn('Circuit breaker recorded failure', {
        name: this.name,
        failures: this.failures,
        threshold: this.failureThreshold,
      });
      
      if (this.failures >= this.failureThreshold) {
        this.state = 'open';
        logger.error('Circuit breaker opened', {
          name: this.name,
          failures: this.failures,
        });
      }
      
      throw error;
    }
  }

  getState() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime,
    };
  }
}
