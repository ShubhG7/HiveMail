"""Error handling utilities for LLM API calls."""

from typing import Optional, Dict, Any
from enum import Enum


class LLMErrorType(Enum):
    """Types of LLM API errors."""
    RATE_LIMIT = "rate_limit"
    INVALID_API_KEY = "invalid_api_key"
    QUOTA_EXCEEDED = "quota_exceeded"
    PROVIDER_OUTAGE = "provider_outage"
    NETWORK_ERROR = "network_error"
    INVALID_REQUEST = "invalid_request"
    UNKNOWN = "unknown"


class LLMError(Exception):
    """Custom exception for LLM errors with context."""
    def __init__(
        self,
        message: str,
        error_type: LLMErrorType,
        provider: str,
        retryable: bool = False,
        retry_after: Optional[int] = None,
        original_error: Optional[Exception] = None
    ):
        super().__init__(message)
        self.error_type = error_type
        self.provider = provider
        self.retryable = retryable
        self.retry_after = retry_after  # Seconds to wait before retry
        self.original_error = original_error


def classify_llm_error(error: Exception, provider: str) -> LLMError:
    """Classify an LLM API error and return appropriate LLMError."""
    error_str = str(error).lower()
    error_msg = str(error)
    
    # Rate limit errors (429)
    if "429" in error_msg or "rate limit" in error_str or "too many requests" in error_str:
        # Try to extract retry-after header if available
        retry_after = None
        if hasattr(error, "response") and hasattr(error.response, "headers"):
            retry_after_header = error.response.headers.get("retry-after")
            if retry_after_header:
                try:
                    retry_after = int(retry_after_header)
                except ValueError:
                    pass
        
        return LLMError(
            f"Rate limit exceeded for {provider}. Please wait before retrying.",
            LLMErrorType.RATE_LIMIT,
            provider,
            retryable=True,
            retry_after=retry_after or 60,
            original_error=error
        )
    
    # Invalid API key errors (401)
    if "401" in error_msg or "unauthorized" in error_str or "invalid api key" in error_str or "authentication" in error_str:
        return LLMError(
            f"Invalid API key for {provider}. Please check your API key in Settings.",
            LLMErrorType.INVALID_API_KEY,
            provider,
            retryable=False,
            original_error=error
        )
    
    # Quota exceeded errors
    if "quota" in error_str or "billing" in error_str or "payment" in error_str:
        return LLMError(
            f"API quota exceeded for {provider}. Please check your billing or upgrade your plan.",
            LLMErrorType.QUOTA_EXCEEDED,
            provider,
            retryable=False,
            original_error=error
        )
    
    # Network errors
    if "connection" in error_str or "timeout" in error_str or "network" in error_str:
        return LLMError(
            f"Network error connecting to {provider}. Please check your internet connection.",
            LLMErrorType.NETWORK_ERROR,
            provider,
            retryable=True,
            retry_after=30,
            original_error=error
        )
    
    # Provider outage (5xx errors)
    if "500" in error_msg or "502" in error_msg or "503" in error_msg or "504" in error_msg:
        return LLMError(
            f"{provider} is experiencing issues. Please try again later.",
            LLMErrorType.PROVIDER_OUTAGE,
            provider,
            retryable=True,
            retry_after=300,  # 5 minutes
            original_error=error
        )
    
    # Invalid request (400)
    if "400" in error_msg or "bad request" in error_str:
        return LLMError(
            f"Invalid request to {provider}. This may be a configuration issue.",
            LLMErrorType.INVALID_REQUEST,
            provider,
            retryable=False,
            original_error=error
        )
    
    # Unknown error
    return LLMError(
        f"Unexpected error with {provider}: {error_msg}",
        LLMErrorType.UNKNOWN,
        provider,
        retryable=True,
        retry_after=60,
        original_error=error
    )


def should_retry(error: LLMError) -> bool:
    """Determine if an error should be retried."""
    return error.retryable


def get_user_friendly_message(error: LLMError) -> str:
    """Get a user-friendly error message."""
    messages = {
        LLMErrorType.RATE_LIMIT: (
            "Your API rate limit has been reached. "
            "Processing will resume automatically. "
            f"Please wait {error.retry_after} seconds."
        ),
        LLMErrorType.INVALID_API_KEY: (
            "Your API key is invalid or expired. "
            "Please update it in Settings → LLM Configuration."
        ),
        LLMErrorType.QUOTA_EXCEEDED: (
            "Your API quota has been exceeded. "
            "Please check your billing or upgrade your plan with your provider."
        ),
        LLMErrorType.PROVIDER_OUTAGE: (
            f"{error.provider} is currently experiencing issues. "
            "We'll retry automatically when the service is back online."
        ),
        LLMErrorType.NETWORK_ERROR: (
            "Network connection issue. We'll retry automatically."
        ),
        LLMErrorType.INVALID_REQUEST: (
            "There's a configuration issue with your API key. "
            "Please check your provider settings."
        ),
        LLMErrorType.UNKNOWN: (
            f"An unexpected error occurred with {error.provider}. "
            "Please try again or contact support if the issue persists."
        ),
    }
    
    return messages.get(error.error_type, str(error))


def log_error_for_support(error: LLMError, context: Dict[str, Any]) -> Dict[str, Any]:
    """Format error for logging/support."""
    return {
        "error_type": error.error_type.value,
        "provider": error.provider,
        "message": str(error),
        "retryable": error.retryable,
        "retry_after": error.retry_after,
        "original_error": str(error.original_error) if error.original_error else None,
        **context
    }
