"""Worker configuration."""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment."""
    
    # Database
    database_url: str
    
    # Encryption
    encryption_master_key: str
    
    # Google OAuth (for refreshing tokens)
    google_client_id: str
    google_client_secret: str
    
    # Worker settings
    worker_batch_size: int = 50
    worker_max_retries: int = 3
    
    # LLM defaults (can be overridden per user)
    default_llm_model: str = "gemini-2.5-flash"
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
