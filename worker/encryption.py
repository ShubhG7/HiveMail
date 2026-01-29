"""Encryption utilities for the worker."""

import base64
import hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from cryptography.hazmat.backends import default_backend
import os

from config import get_settings

settings = get_settings()

SALT_LENGTH = 32
IV_LENGTH = 16
AUTH_TAG_LENGTH = 16


def _get_master_key() -> bytes:
    """Get the master encryption key."""
    return base64.b64decode(settings.encryption_master_key)


def _derive_key(master_key: bytes, salt: bytes) -> bytes:
    """Derive a key from master key and salt using scrypt."""
    kdf = Scrypt(
        salt=salt,
        length=32,
        n=2**14,
        r=8,
        p=1,
        backend=default_backend()
    )
    return kdf.derive(master_key)


def encrypt(plaintext: str) -> str:
    """Encrypt a string using AES-256-GCM."""
    master_key = _get_master_key()
    salt = os.urandom(SALT_LENGTH)
    key = _derive_key(master_key, salt)
    iv = os.urandom(IV_LENGTH)
    
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(iv, plaintext.encode('utf-8'), None)
    
    # Combine: salt + iv + ciphertext (includes auth tag)
    combined = salt + iv + ciphertext
    return base64.b64encode(combined).decode('utf-8')


def decrypt(encrypted_data: str) -> str:
    """Decrypt an encrypted string."""
    master_key = _get_master_key()
    combined = base64.b64decode(encrypted_data)
    
    # Extract components
    salt = combined[:SALT_LENGTH]
    iv = combined[SALT_LENGTH:SALT_LENGTH + IV_LENGTH]
    ciphertext = combined[SALT_LENGTH + IV_LENGTH:]
    
    key = _derive_key(master_key, salt)
    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(iv, ciphertext, None)
    
    return plaintext.decode('utf-8')


def hash_content(content: str) -> str:
    """Hash content for deduplication."""
    return hashlib.sha256(content.encode('utf-8')).hexdigest()
